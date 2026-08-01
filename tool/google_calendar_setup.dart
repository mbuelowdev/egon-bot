import 'dart:io';

import 'package:dotenv/dotenv.dart';
import 'package:googleapis/calendar/v3.dart';
import 'package:googleapis_auth/auth_io.dart';
import 'package:egon_bot/src/integrations/google_calendar_client.dart';

/// One-time Google Calendar OAuth setup (ARCHITECTURE.md §12).
///
/// Prerequisites (manual, Google Cloud Console):
/// 1. Create a project
/// 2. Enable the Google Calendar API
/// 3. Create OAuth credentials of type **Desktop app**
/// 4. Put the client id/secret in the environment (or `.env`):
///    `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
/// 5. Optionally set `DATA_DIR` (default `./data` locally, `/data` in Docker)
///
/// This script prints a consent URL, waits for the pasted code, writes
/// `$DATA_DIR/google/token.json` + `config.json`, and creates the "Egon"
/// calendar when missing.
Future<void> main(List<String> args) async {
  final env = DotEnv(includePlatformEnvironment: true);
  if (File('.env').existsSync()) {
    env.load();
  }

  final clientIdValue = env['GOOGLE_CLIENT_ID']?.trim();
  final clientSecret = env['GOOGLE_CLIENT_SECRET']?.trim();
  if (clientIdValue == null ||
      clientIdValue.isEmpty ||
      clientSecret == null ||
      clientSecret.isEmpty) {
    stderr.writeln('''
Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.

Create a Google Cloud project → enable Calendar API → create OAuth Desktop
credentials, then export:

  export GOOGLE_CLIENT_ID=....apps.googleusercontent.com
  export GOOGLE_CLIENT_SECRET=...
  export DATA_DIR=./data   # optional

Then re-run: dart run tool/google_calendar_setup.dart
''');
    exitCode = 64;
    return;
  }

  final dataDir = env['DATA_DIR']?.trim().isNotEmpty == true
      ? env['DATA_DIR']!.trim()
      : './data';
  final googleDir = Directory('$dataDir/google')..createSync(recursive: true);
  final tokenPath = '${googleDir.path}/token.json';
  final configPath = '${googleDir.path}/config.json';

  final clientId = ClientId(clientIdValue, clientSecret);

  stdout.writeln('Opening Google OAuth consent (offline access)...');
  stdout.writeln(
    'If the browser shows a code, paste it below. '
    'Use the Google account whose calendars Egon should see.',
  );

  final authClient = await clientViaUserConsentManual(
    clientId,
    googleCalendarScopes,
    (url) async {
      // Manual flow does not request offline access by default — append it.
      final offlineUrl = url.contains('access_type=')
          ? url
          : '$url&access_type=offline&prompt=consent';
      stdout.writeln('\nOpen this URL in a browser:\n\n$offlineUrl\n');
      stdout.write('Paste the authorization code here: ');
      final code = stdin.readLineSync()?.trim() ?? '';
      if (code.isEmpty) {
        throw StateError('Empty authorization code.');
      }
      return code;
    },
  );

  try {
    writeGoogleTokenFile(
      path: tokenPath,
      clientId: clientId,
      credentials: authClient.credentials,
    );
    stdout.writeln('Wrote $tokenPath');

    final api = CalendarApi(authClient);
    final egonId = await ensureEgonCalendar(api);
    writeGoogleConfigFile(path: configPath, egonCalendarId: egonId);
    stdout.writeln('Egon calendar id: $egonId');
    stdout.writeln('Wrote $configPath');
    stdout.writeln('\nSetup complete. Restart the bot to use calendar tools.');
  } finally {
    authClient.close();
  }
}
