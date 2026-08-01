import 'dart:convert';
import 'dart:io';

import 'package:googleapis/calendar/v3.dart';
import 'package:googleapis_auth/auth_io.dart';

import '../config.dart';
import '../time/timestamps.dart';

/// Soft failure when OAuth tokens are missing or revoked (§12).
class GoogleCalendarSetupRequired implements Exception {
  GoogleCalendarSetupRequired([
    this.message = 'Google Calendar is not set up. Run: '
        'dart run tool/google_calendar_setup.dart',
  ]);
  final String message;

  @override
  String toString() => message;
}

/// A calendar event normalized for tool results / previews.
class CalendarEventView {
  CalendarEventView({
    required this.id,
    required this.calendarId,
    required this.calendarSummary,
    required this.summary,
    required this.start,
    required this.end,
    this.description,
    this.location,
    this.htmlLink,
    this.allDay = false,
  });

  final String id;
  final String calendarId;
  final String calendarSummary;
  final String summary;
  final DateTime start;
  final DateTime end;
  final String? description;
  final String? location;
  final String? htmlLink;
  final bool allDay;

  Map<String, Object?> toJson(Timestamps timestamps) => {
        'id': id,
        'calendar': calendarSummary,
        'calendar_id': calendarId,
        'summary': summary,
        'start': allDay
            ? start.toIso8601String().substring(0, 10)
            : timestamps.format(start),
        'end': allDay
            ? end.toIso8601String().substring(0, 10)
            : timestamps.format(end),
        'all_day': allDay,
        if (description != null && description!.isNotEmpty)
          'description': description,
        if (location != null && location!.isNotEmpty) 'location': location,
        if (htmlLink != null) 'html_link': htmlLink,
      };
}

/// Google Calendar API wrapper (ARCHITECTURE.md §12).
///
/// Reads across all visible calendars; writes go to the dedicated Egon
/// calendar (or [Config.googleCalendarId] override).
class GoogleCalendarClient {
  GoogleCalendarClient._({
    required this.config,
    required this.timestamps,
    required AutoRefreshingAuthClient? authClient,
    required String? writeCalendarId,
    required this.tokenPath,
    required this.configPath,
  })  : _authClient = authClient,
        _writeCalendarId = writeCalendarId,
        _api = authClient == null ? null : CalendarApi(authClient);

  /// Loads credentials from `$DATA_DIR/google/`. Returns an unavailable client
  /// when token/config files are missing (tools report re-run setup).
  factory GoogleCalendarClient.open({
    required Config config,
    required Timestamps timestamps,
  }) {
    final dir = Directory('${config.dataDir}/google');
    final tokenPath = '${dir.path}/token.json';
    final configPath = '${dir.path}/config.json';

    if (!File(tokenPath).existsSync()) {
      return GoogleCalendarClient._(
        config: config,
        timestamps: timestamps,
        authClient: null,
        writeCalendarId: config.googleCalendarId,
        tokenPath: tokenPath,
        configPath: configPath,
      );
    }

    try {
      final tokenJson = jsonDecode(File(tokenPath).readAsStringSync())
          as Map<String, Object?>;
      final clientId = tokenJson['client_id'] as String?;
      final clientSecret = tokenJson['client_secret'] as String?;
      final refreshToken = tokenJson['refresh_token'] as String?;
      final scopes =
          (tokenJson['scopes'] as List?)?.map((e) => e.toString()).toList() ??
              const [CalendarApi.calendarScope];
      if (clientId == null ||
          clientSecret == null ||
          refreshToken == null ||
          refreshToken.isEmpty) {
        throw const FormatException('token.json incomplete');
      }

      String? writeId = config.googleCalendarId;
      if (writeId == null && File(configPath).existsSync()) {
        final cfg = jsonDecode(File(configPath).readAsStringSync())
            as Map<String, Object?>;
        writeId = cfg['egon_calendar_id'] as String?;
      }

      // auth client created lazily via fromCredentials in ensureReady —
      // we need async for clientViaRefreshToken. Store raw bits instead.
      return GoogleCalendarClient._pending(
        config: config,
        timestamps: timestamps,
        clientId: ClientId(clientId, clientSecret),
        refreshToken: refreshToken,
        scopes: scopes,
        writeCalendarId: writeId,
        tokenPath: tokenPath,
        configPath: configPath,
      );
    } catch (error) {
      stderr.writeln('Failed to load Google Calendar token: $error');
      return GoogleCalendarClient._(
        config: config,
        timestamps: timestamps,
        authClient: null,
        writeCalendarId: config.googleCalendarId,
        tokenPath: tokenPath,
        configPath: configPath,
      );
    }
  }

  /// Test / explicit construction with a pre-built API (or unavailable).
  factory GoogleCalendarClient.forTesting({
    required Config config,
    required Timestamps timestamps,
    CalendarApi? api,
    String? writeCalendarId,
  }) {
    final client = GoogleCalendarClient._(
      config: config,
      timestamps: timestamps,
      authClient: null,
      writeCalendarId: writeCalendarId ?? 'egon-test',
      tokenPath: '${config.dataDir}/google/token.json',
      configPath: '${config.dataDir}/google/config.json',
    );
    client._api = api;
    client._ready = api != null;
    return client;
  }

  factory GoogleCalendarClient._pending({
    required Config config,
    required Timestamps timestamps,
    required ClientId clientId,
    required String refreshToken,
    required List<String> scopes,
    required String? writeCalendarId,
    required String tokenPath,
    required String configPath,
  }) {
    final client = GoogleCalendarClient._(
      config: config,
      timestamps: timestamps,
      authClient: null,
      writeCalendarId: writeCalendarId,
      tokenPath: tokenPath,
      configPath: configPath,
    );
    client._pendingClientId = clientId;
    client._pendingRefresh = refreshToken;
    client._pendingScopes = scopes;
    return client;
  }

  final Config config;
  final Timestamps timestamps;
  final String tokenPath;
  final String configPath;

  AutoRefreshingAuthClient? _authClient;
  CalendarApi? _api;
  String? _writeCalendarId;
  bool _ready = false;
  bool _initFailed = false;

  ClientId? _pendingClientId;
  String? _pendingRefresh;
  List<String>? _pendingScopes;

  bool get isConfigured =>
      _api != null || (_pendingRefresh != null && !_initFailed);

  String get writeCalendarId {
    final id = _writeCalendarId;
    if (id == null || id.isEmpty) {
      throw GoogleCalendarSetupRequired(
        'Egon calendar id missing. Re-run tool/google_calendar_setup.dart '
        'or set GOOGLE_CALENDAR_ID.',
      );
    }
    return id;
  }

  Future<void> _ensureReady() async {
    if (_ready && _api != null) return;
    if (_initFailed) {
      throw GoogleCalendarSetupRequired();
    }
    final refresh = _pendingRefresh;
    final clientId = _pendingClientId;
    final scopes = _pendingScopes;
    if (refresh == null || clientId == null || scopes == null) {
      throw GoogleCalendarSetupRequired();
    }
    try {
      final auth = await clientViaRefreshToken(clientId, refresh, scopes);
      _authClient = auth;
      _api = CalendarApi(auth);
      _ready = true;
    } catch (error) {
      _initFailed = true;
      stderr.writeln('Google Calendar auth failed: $error');
      throw GoogleCalendarSetupRequired(
        'Google Calendar token rejected. Re-run: '
        'dart run tool/google_calendar_setup.dart ($error)',
      );
    }
  }

  CalendarApi get _calendar {
    final api = _api;
    if (api == null) {
      throw GoogleCalendarSetupRequired();
    }
    return api;
  }

  Future<List<CalendarEventView>> listEvents({
    required DateTime timeMin,
    required DateTime timeMax,
    String? query,
    int maxPerCalendar = 50,
  }) async {
    await _ensureReady();
    final api = _calendar;
    final calendars = await api.calendarList.list();
    final results = <CalendarEventView>[];
    for (final cal in calendars.items ?? const <CalendarListEntry>[]) {
      final calId = cal.id;
      if (calId == null) continue;
      try {
        final events = await api.events.list(
          calId,
          timeMin: timeMin.toUtc(),
          timeMax: timeMax.toUtc(),
          q: query,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: maxPerCalendar,
          timeZone: timestamps.timezoneName,
        );
        for (final event in events.items ?? const <Event>[]) {
          final view = _toView(event, calId, cal.summary ?? calId);
          if (view != null) results.add(view);
        }
      } catch (error) {
        stderr.writeln('Skipping calendar $calId: $error');
      }
    }
    results.sort((a, b) => a.start.compareTo(b.start));
    return results;
  }

  Future<CalendarEventView> createEvent({
    required String summary,
    required DateTime start,
    required DateTime end,
    String? description,
    String? location,
  }) async {
    await _ensureReady();
    final calId = writeCalendarId;
    final event = Event(
      summary: summary,
      description: description,
      location: location,
      start: EventDateTime(
        dateTime: start.toUtc(),
        timeZone: timestamps.timezoneName,
      ),
      end: EventDateTime(
        dateTime: end.toUtc(),
        timeZone: timestamps.timezoneName,
      ),
    );
    final created = await _calendar.events.insert(event, calId);
    final view = _toView(created, calId, 'Egon');
    if (view == null) {
      throw StateError('Created event missing start/end.');
    }
    return view;
  }

  Future<CalendarEventView> updateEvent({
    required String eventId,
    String? summary,
    DateTime? start,
    DateTime? end,
    String? description,
    String? location,
    bool clearDescription = false,
    bool clearLocation = false,
  }) async {
    await _ensureReady();
    final calId = writeCalendarId;
    final existing = await _calendar.events.get(calId, eventId);
    if (summary != null) existing.summary = summary;
    if (clearDescription) {
      existing.description = null;
    } else if (description != null) {
      existing.description = description;
    }
    if (clearLocation) {
      existing.location = null;
    } else if (location != null) {
      existing.location = location;
    }
    if (start != null) {
      existing.start = EventDateTime(
        dateTime: start.toUtc(),
        timeZone: timestamps.timezoneName,
      );
    }
    if (end != null) {
      existing.end = EventDateTime(
        dateTime: end.toUtc(),
        timeZone: timestamps.timezoneName,
      );
    }
    final updated = await _calendar.events.update(existing, calId, eventId);
    final view = _toView(updated, calId, 'Egon');
    if (view == null) {
      throw StateError('Updated event missing start/end.');
    }
    return view;
  }

  Future<void> deleteEvent(String eventId) async {
    await _ensureReady();
    await _calendar.events.delete(writeCalendarId, eventId);
  }

  Future<CalendarEventView?> getWriteEvent(String eventId) async {
    await _ensureReady();
    try {
      final event = await _calendar.events.get(writeCalendarId, eventId);
      return _toView(event, writeCalendarId, 'Egon');
    } catch (_) {
      return null;
    }
  }

  void close() {
    _authClient?.close();
  }

  static CalendarEventView? _toView(
    Event event,
    String calendarId,
    String calendarSummary,
  ) {
    final id = event.id;
    if (id == null) return null;
    final startRaw = event.start;
    final endRaw = event.end;
    if (startRaw == null || endRaw == null) return null;

    final allDay = startRaw.date != null;
    final start = allDay
        ? DateTime.utc(
            startRaw.date!.year,
            startRaw.date!.month,
            startRaw.date!.day,
          )
        : (startRaw.dateTime ?? startRaw.date)!.toUtc();
    final end = allDay
        ? DateTime.utc(
            endRaw.date!.year,
            endRaw.date!.month,
            endRaw.date!.day,
          )
        : (endRaw.dateTime ?? endRaw.date)!.toUtc();

    return CalendarEventView(
      id: id,
      calendarId: calendarId,
      calendarSummary: calendarSummary,
      summary: event.summary ?? '(no title)',
      start: start,
      end: end,
      description: event.description,
      location: event.location,
      htmlLink: event.htmlLink,
      allDay: allDay,
    );
  }
}

/// Shared OAuth scope for Calendar read/write.
const googleCalendarScopes = [CalendarApi.calendarScope];

/// Persists OAuth credentials after the setup script succeeds.
void writeGoogleTokenFile({
  required String path,
  required ClientId clientId,
  required AccessCredentials credentials,
}) {
  final refresh = credentials.refreshToken;
  if (refresh == null || refresh.isEmpty) {
    throw StateError(
      'No refresh token returned. Revoke prior access at '
      'https://myaccount.google.com/permissions and re-run with consent.',
    );
  }
  File(path).parent.createSync(recursive: true);
  final secret = clientId.secret;
  if (secret == null || secret.isEmpty) {
    throw StateError('Client secret is required for installed-app OAuth.');
  }
  File(path).writeAsStringSync(
    const JsonEncoder.withIndent('  ').convert({
      'client_id': clientId.identifier,
      'client_secret': secret,
      'refresh_token': refresh,
      'scopes': credentials.scopes,
    }),
  );
}

void writeGoogleConfigFile({
  required String path,
  required String egonCalendarId,
}) {
  File(path).parent.createSync(recursive: true);
  File(path).writeAsStringSync(
    const JsonEncoder.withIndent('  ').convert({
      'egon_calendar_id': egonCalendarId,
    }),
  );
}

/// Creates the "Egon" calendar if missing; returns its id.
Future<String> ensureEgonCalendar(CalendarApi api) async {
  final list = await api.calendarList.list();
  for (final cal in list.items ?? const <CalendarListEntry>[]) {
    if ((cal.summary ?? '').trim() == 'Egon' && cal.id != null) {
      return cal.id!;
    }
  }
  final created = await api.calendars.insert(Calendar(summary: 'Egon'));
  final id = created.id;
  if (id == null) {
    throw StateError('Failed to create Egon calendar.');
  }
  return id;
}
