import 'dart:io';

import 'package:nyxx/nyxx.dart';

/// Discord epoch (2015-01-01T00:00:00.000Z) used in snowflake timestamps.
const discordEpochMs = 1420070400000;

/// Lowest snowflake whose embedded timestamp is >= [instant] (UTC).
String snowflakeAtOrAfter(DateTime instant) {
  final ms = instant.toUtc().millisecondsSinceEpoch;
  final value = (ms - discordEpochMs) << 22;
  return value < 0 ? '0' : value.toString();
}

/// One hit from Discord's guild message search.
class DiscordSearchHit {
  DiscordSearchHit({
    required this.id,
    required this.channelId,
    required this.authorId,
    required this.authorName,
    required this.content,
    required this.timestamp,
    required this.jumpUrl,
  });

  final String id;
  final String channelId;
  final String authorId;
  final String authorName;
  final String content;
  final String timestamp;
  final String jumpUrl;

  Map<String, Object?> toJson() => {
        'id': id,
        'channel_id': channelId,
        'author_id': authorId,
        'author_name': authorName,
        'content': content,
        'timestamp': timestamp,
        'jump_url': jumpUrl,
      };
}

/// Parsed [GET /guilds/{guild.id}/messages/search] response.
class DiscordMessageSearchResult {
  DiscordMessageSearchResult({
    required this.totalResults,
    required this.messages,
    this.indexing = false,
    this.retryAfterSeconds,
  });

  final int totalResults;
  final List<DiscordSearchHit> messages;

  /// True when Discord returned HTTP 202 / code 110000 (index not ready).
  final bool indexing;
  final double? retryAfterSeconds;

  Map<String, Object?> toJson() => {
        'total_results': totalResults,
        'messages': [for (final m in messages) m.toJson()],
        if (indexing) 'indexing': true,
        if (retryAfterSeconds != null) 'retry_after': retryAfterSeconds,
      };
}

/// Query params for Discord guild message search.
class DiscordMessageSearchQuery {
  DiscordMessageSearchQuery({
    this.content,
    this.channelIds = const [],
    this.authorIds = const [],
    this.mentions = const [],
    this.has = const [],
    this.minId,
    this.maxId,
    this.sortBy,
    this.sortOrder,
    this.offset = 0,
    this.limit = 25,
    this.includeNsfw = false,
  });

  final String? content;
  final List<String> channelIds;
  final List<String> authorIds;
  final List<String> mentions;
  final List<String> has;
  final String? minId;
  final String? maxId;
  final String? sortBy;
  final String? sortOrder;
  final int offset;
  final int limit;
  final bool includeNsfw;
}

typedef DiscordGuildSearchFn = Future<DiscordMessageSearchResult> Function({
  required String guildId,
  required DiscordMessageSearchQuery query,
});

/// Thin facade over Discord's Search Guild Messages endpoint.
///
/// Tools must not import nyxx; they call this via [Services].
class DiscordSearchApi {
  DiscordSearchApi({
    DiscordGuildSearchFn? searchImpl,
    this.maxIndexRetries = 3,
    Duration? Function(double retryAfterSeconds)? retryDelay,
  })  : _searchImpl = searchImpl,
        _retryDelay = retryDelay ??
            ((seconds) {
              final ms = (seconds <= 0 ? 1.0 : seconds) * 1000;
              return Duration(milliseconds: ms.ceil());
            });

  final DiscordGuildSearchFn? _searchImpl;
  final int maxIndexRetries;
  final Duration? Function(double retryAfterSeconds) _retryDelay;

  NyxxGateway? _client;

  void attachClient(NyxxGateway client) => _client = client;

  void detachClient() => _client = null;

  /// Resolve the guild id for a channel the bot can see.
  Future<String> resolveGuildId(String channelId) async {
    final client = _client;
    if (client == null) {
      throw StateError('Discord client not attached.');
    }
    final channel = await client.channels.get(Snowflake.parse(channelId));
    if (channel is! GuildChannel) {
      throw StateError(
        'Channel $channelId is not a guild channel (search needs a guild).',
      );
    }
    return channel.guildId.toString();
  }

  /// Search messages in [guildId], retrying when the guild index is not ready.
  Future<DiscordMessageSearchResult> searchGuildMessages({
    required String guildId,
    required DiscordMessageSearchQuery query,
  }) async {
    final impl = _searchImpl;
    if (impl != null) {
      return impl(guildId: guildId, query: query);
    }

    final client = _client;
    if (client == null) {
      throw StateError('Discord client not attached.');
    }

    var attempt = 0;
    while (true) {
      attempt++;
      final raw = await _requestSearch(client, guildId, query);
      if (!raw.indexing) return raw;
      if (attempt > maxIndexRetries) {
        return raw;
      }
      final delay = _retryDelay(raw.retryAfterSeconds ?? 1);
      if (delay == null) return raw;
      await Future<void>.delayed(delay);
    }
  }

  Future<DiscordMessageSearchResult> _requestSearch(
    NyxxGateway client,
    String guildId,
    DiscordMessageSearchQuery query,
  ) async {
    final route = HttpRoute()
      ..add(HttpRoutePart('guilds', [HttpRouteParam(guildId, isMajor: true)]))
      ..add(HttpRoutePart('messages'))
      ..add(HttpRoutePart('search'));

    final scalars = <String, String>{
      if (query.content != null && query.content!.isNotEmpty)
        'content': query.content!,
      if (query.minId != null && query.minId!.isNotEmpty)
        'min_id': query.minId!,
      if (query.maxId != null && query.maxId!.isNotEmpty)
        'max_id': query.maxId!,
      if (query.sortBy != null && query.sortBy!.isNotEmpty)
        'sort_by': query.sortBy!,
      if (query.sortOrder != null && query.sortOrder!.isNotEmpty)
        'sort_order': query.sortOrder!,
      'offset': '${query.offset}',
      'limit': '${query.limit}',
      'include_nsfw': '${query.includeNsfw}',
    };

    final arrays = <String, List<String>>{
      if (query.channelIds.isNotEmpty) 'channel_id': query.channelIds,
      if (query.authorIds.isNotEmpty) 'author_id': query.authorIds,
      if (query.mentions.isNotEmpty) 'mentions': query.mentions,
      if (query.has.isNotEmpty) 'has': query.has,
    };

    final request = BasicRequest(
      route,
      queryParameters: scalars,
      arrayQueryParameters: arrays,
    );

    final response = await client.httpHandler.execute(request);
    if (!response.hasJsonBody || response.jsonBody is! Map) {
      final detail = response.textBody ?? 'status ${response.statusCode}';
      throw HttpException('Discord search failed: $detail');
    }

    final body = Map<String, Object?>.from(response.jsonBody as Map);

    // Index-not-ready: HTTP 202 with Discord error code 110000.
    final code = body['code'];
    if (response.statusCode == 202 || code == 110000) {
      final retry = body['retry_after'];
      return DiscordMessageSearchResult(
        totalResults: 0,
        messages: const [],
        indexing: true,
        retryAfterSeconds: switch (retry) {
          num n => n.toDouble(),
          _ => 1,
        },
      );
    }

    if (response is HttpResponseError) {
      throw HttpException(
        'Discord search failed (${response.errorCode}): ${response.message}',
      );
    }

    return parseSearchResponse(body, guildId: guildId);
  }

  /// Parse a successful Discord search JSON body into hits.
  static DiscordMessageSearchResult parseSearchResponse(
    Map<String, Object?> body, {
    required String guildId,
  }) {
    final total = switch (body['total_results']) {
      int n => n,
      num n => n.toInt(),
      _ => 0,
    };

    final hits = <DiscordSearchHit>[];
    final groups = body['messages'];
    if (groups is List) {
      for (final group in groups) {
        if (group is! List || group.isEmpty) continue;
        // Surrounding context is no longer returned; take the first message
        // in each group (the hit). Prefer an explicit hit flag when present.
        Map<String, Object?>? chosen;
        for (final item in group) {
          if (item is! Map) continue;
          final map = Map<String, Object?>.from(item);
          if (map['hit'] == true) {
            chosen = map;
            break;
          }
          chosen ??= map;
        }
        if (chosen == null) continue;
        final hit = _hitFromMessage(chosen, guildId: guildId);
        if (hit != null) hits.add(hit);
      }
    }

    return DiscordMessageSearchResult(
      totalResults: total,
      messages: hits,
    );
  }

  static DiscordSearchHit? _hitFromMessage(
    Map<String, Object?> raw, {
    required String guildId,
  }) {
    final id = raw['id']?.toString();
    final channelId = raw['channel_id']?.toString();
    if (id == null || channelId == null) return null;

    final authorRaw = raw['author'];
    var authorId = '';
    var authorName = 'unknown';
    if (authorRaw is Map) {
      final author = Map<String, Object?>.from(authorRaw);
      authorId = author['id']?.toString() ?? '';
      final global = author['global_name']?.toString();
      final username = author['username']?.toString();
      authorName = (global != null && global.isNotEmpty)
          ? global
          : (username ?? 'unknown');
    }

    final content = raw['content']?.toString() ?? '';
    final timestamp = raw['timestamp']?.toString() ?? '';

    return DiscordSearchHit(
      id: id,
      channelId: channelId,
      authorId: authorId,
      authorName: authorName,
      content: content,
      timestamp: timestamp,
      jumpUrl: 'https://discord.com/channels/$guildId/$channelId/$id',
    );
  }
}
