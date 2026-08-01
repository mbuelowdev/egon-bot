import '../../contacts/contact.dart';
import '../../discord/discord_search_api.dart';
import '../tool.dart';

const _maxContentChars = 280;
const _maxLimit = 15;
const _maxOffset = 15;
const _maxRangeWithContent = Duration(days: 30);
const _maxRangeWithoutContent = Duration(days: 7);
const _defaultAuthorLookback = Duration(hours: 24);

const _allowedHas = {
  'image',
  'sound',
  'video',
  'file',
  'sticker',
  'embed',
  'link',
  'poll',
  'snapshot',
};

final _snowflakePattern = RegExp(r'^\d{5,30}$');

class SearchDiscordMessagesTool extends Tool {
  SearchDiscordMessagesTool({DateTime Function()? clock})
      : _clock = clock ?? DateTime.now;

  final DateTime Function() _clock;

  @override
  String get name => 'search_discord_messages';

  @override
  String get description =>
      'Searches Discord history in allowed guild channels. Use for questions '
      'like "was habe ich gestern gesagt?", who posted something, or finding '
      'older chat by keyword/time — not the short recent prompt history, and '
      'not the public web (web_search). '
      'author_id: "me" (= caller), a Discord user id, or a contact name with '
      'discord id. after/before: local or ISO timestamps for a time window. '
      'Hard caps: max 15 results, small offset, bounded time range — never a '
      'mass dump. Summarize hits for the user; do not paste every message.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'content': {
            'type': 'string',
            'description':
                'Keyword/phrase filter (max 1024). Optional when author_id, '
                'mentions, or has is set.',
          },
          'channel_id': {
            'type': 'string',
            'description':
                'One allowed channel id. Default: current channel in guild '
                'chats; all allowed channels in DMs.',
          },
          'author_id': {
            'type': 'string',
            'description':
                '"me" for the caller, a Discord snowflake id, or a contact '
                'name that has a discord_user_id. Use for "what did I/X say".',
          },
          'mentions': {
            'type': 'string',
            'description': 'Only messages that mention this Discord user id.',
          },
          'has': {
            'type': 'string',
            'description':
                'image, sound, video, file, sticker, embed, link, poll, or '
                'snapshot. Prefix with - to exclude.',
          },
          'after': {
            'type': 'string',
            'description':
                'Only messages after this time (local BOT_TIMEZONE or ISO-8601). '
                'Example for "yesterday": start of that local day.',
          },
          'before': {
            'type': 'string',
            'description':
                'Only messages before this time (local BOT_TIMEZONE or ISO-8601). '
                'Example for "yesterday": start of today.',
          },
          'sort_by': {
            'type': 'string',
            'description':
                'timestamp (default) or relevance (needs content query).',
          },
          'sort_order': {
            'type': 'string',
            'description': 'desc (default) or asc. Ignored for relevance.',
          },
          'offset': {
            'type': 'integer',
            'description': 'Pagination offset (default 0, hard max 15).',
          },
          'limit': {
            'type': 'integer',
            'description': 'Max results (1-15, default 10). Hard-capped.',
          },
        },
        'required': <String>[],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final content = (args['content'] as String?)?.trim();
    final channelArg = (args['channel_id'] as String?)?.trim();
    final authorRaw = (args['author_id'] as String?)?.trim();
    final mentions = (args['mentions'] as String?)?.trim();
    final hasRaw = (args['has'] as String?)?.trim();
    final afterRaw = (args['after'] as String?)?.trim();
    final beforeRaw = (args['before'] as String?)?.trim();
    final sortBy = (args['sort_by'] as String?)?.trim().toLowerCase();
    final sortOrder = (args['sort_order'] as String?)?.trim().toLowerCase();
    final now = _clock().toUtc();

    final allowed = context.services.config.allowedChannelIds;
    if (allowed.isEmpty) {
      return ToolResult.error(
        'No allowed guild channels are configured; cannot search Discord.',
      );
    }

    final List<String> channelIds;
    if (channelArg != null && channelArg.isNotEmpty) {
      if (!allowed.contains(channelArg)) {
        return ToolResult.error(
          'channel_id "$channelArg" is not in ALLOWED_CHANNEL_IDS.',
        );
      }
      channelIds = [channelArg];
    } else if (!context.isDm && allowed.contains(context.channelId)) {
      channelIds = [context.channelId];
    } else {
      channelIds = allowed.toList()..sort();
    }

    String? has;
    if (hasRaw != null && hasRaw.isNotEmpty) {
      final negated = hasRaw.startsWith('-');
      final value = negated ? hasRaw.substring(1) : hasRaw;
      if (!_allowedHas.contains(value)) {
        return ToolResult.error(
          '"has" must be one of ${_allowedHas.join(", ")} '
          '(optional - prefix to exclude).',
        );
      }
      has = negated ? '-$value' : value;
    }

    final resolvedAuthor = _resolveAuthorId(context, authorRaw);
    if (resolvedAuthor.error != null) {
      return ToolResult.error(resolvedAuthor.error!);
    }
    final authorId = resolvedAuthor.id;

    final hasContent = content != null && content.isNotEmpty;
    final hasAuthor = authorId != null && authorId.isNotEmpty;
    final hasMentions = mentions != null && mentions.isNotEmpty;
    if (!hasContent && !hasAuthor && !hasMentions && has == null) {
      return ToolResult.error(
        'Provide at least one of: content, author_id, mentions, or has. '
        'For "what did I say?", use author_id="me" plus after/before.',
      );
    }

    if (hasContent && content.length > 1024) {
      return ToolResult.error('"content" must be at most 1024 characters.');
    }

    if (sortBy != null &&
        sortBy.isNotEmpty &&
        sortBy != 'timestamp' &&
        sortBy != 'relevance') {
      return ToolResult.error('"sort_by" must be timestamp or relevance.');
    }
    if (sortOrder != null &&
        sortOrder.isNotEmpty &&
        sortOrder != 'asc' &&
        sortOrder != 'desc') {
      return ToolResult.error('"sort_order" must be asc or desc.');
    }

    final timestamps = context.services.timestamps;
    DateTime? afterUtc;
    DateTime? beforeUtc;
    try {
      if (afterRaw != null && afterRaw.isNotEmpty) {
        afterUtc = timestamps.parseToUtc(afterRaw);
      }
      if (beforeRaw != null && beforeRaw.isNotEmpty) {
        beforeUtc = timestamps.parseToUtc(beforeRaw);
      }
    } on FormatException catch (e) {
      return ToolResult.error('Bad after/before timestamp: ${e.message}');
    }

    // Author/mention/has without keywords: require a bounded window so this
    // cannot become "dump everything I ever posted".
    var autoAfter = false;
    if (!hasContent && afterUtc == null) {
      afterUtc = now.subtract(_defaultAuthorLookback);
      autoAfter = true;
    }

    if (afterUtc != null && beforeUtc != null && !beforeUtc.isAfter(afterUtc)) {
      return ToolResult.error('"before" must be after "after".');
    }

    final rangeEnd = beforeUtc ?? now;
    final rangeStart = afterUtc;
    if (rangeStart != null) {
      final span = rangeEnd.difference(rangeStart);
      final maxSpan =
          hasContent ? _maxRangeWithContent : _maxRangeWithoutContent;
      if (span > maxSpan) {
        return ToolResult.error(
          'Time range too large (${span.inDays}d). '
          'Max ${maxSpan.inDays}d'
          '${hasContent ? " with content" : " without content keywords"}. '
          'Narrow after/before — mass history dumps are blocked.',
        );
      }
    }

    final requestedOffset = switch (args['offset']) {
      int n => n,
      num n => n.toInt(),
      _ => 0,
    };
    final requestedLimit = switch (args['limit']) {
      int n => n,
      num n => n.toInt(),
      _ => 10,
    };
    if (requestedOffset < 0 || requestedLimit < 1) {
      return ToolResult.error('offset must be >= 0 and limit >= 1.');
    }
    final offset = requestedOffset.clamp(0, _maxOffset);
    final limit = requestedLimit.clamp(1, _maxLimit);
    final capped = requestedOffset > _maxOffset || requestedLimit > _maxLimit;

    final search = context.services.discordSearch;
    final String guildId;
    try {
      guildId = await search.resolveGuildId(channelIds.first);
    } on StateError catch (e) {
      return ToolResult.error(e.message);
    } catch (e) {
      return ToolResult.error('Could not resolve guild for search: $e');
    }

    final DiscordMessageSearchResult result;
    try {
      result = await search.searchGuildMessages(
        guildId: guildId,
        query: DiscordMessageSearchQuery(
          content: hasContent ? content : null,
          channelIds: channelIds,
          authorIds: hasAuthor ? [authorId] : const [],
          mentions: hasMentions ? [mentions] : const [],
          has: has == null ? const [] : [has],
          minId: afterUtc == null ? null : snowflakeAtOrAfter(afterUtc),
          maxId: beforeUtc == null ? null : snowflakeAtOrAfter(beforeUtc),
          sortBy: (sortBy == null || sortBy.isEmpty) ? null : sortBy,
          sortOrder:
              (sortOrder == null || sortOrder.isEmpty) ? null : sortOrder,
          offset: offset,
          limit: limit,
        ),
      );
    } on StateError catch (e) {
      return ToolResult.error(e.message);
    } catch (e) {
      return ToolResult.error('Discord search failed: $e');
    }

    if (result.indexing) {
      return ToolResult.ok({
        'status': 'indexing',
        'note':
            'Discord is still indexing this guild for search. Try again shortly.',
        'retry_after': result.retryAfterSeconds,
        'total_results': 0,
        'messages': <Object?>[],
      });
    }

    return ToolResult.ok({
      'query': {
        'content': content,
        'channel_ids': channelIds,
        'author_id': authorId,
        'mentions': mentions,
        'has': has,
        'after': afterUtc?.toIso8601String(),
        'before': beforeUtc?.toIso8601String(),
        if (autoAfter) 'after_defaulted': true,
        'sort_by': sortBy ?? 'timestamp',
        'sort_order': sortOrder ?? 'desc',
        'offset': offset,
        'limit': limit,
      },
      'total_results': result.totalResults,
      'returned': result.messages.length,
      'messages': [
        for (final m in result.messages)
          {
            'id': m.id,
            'channel_id': m.channelId,
            'author_id': m.authorId,
            'author_name': m.authorName,
            'content': _truncate(m.content, _maxContentChars),
            'timestamp': m.timestamp,
            'jump_url': m.jumpUrl,
          },
      ],
      'policy':
          'Hard caps: limit≤$_maxLimit, offset≤$_maxOffset, '
          'range≤${_maxRangeWithoutContent.inDays}d without keywords / '
          '${_maxRangeWithContent.inDays}d with keywords. '
          'Summarize for the user; never paste a bulk transcript.',
      if (capped)
        'note_capped':
            'Requested limit/offset was reduced to the hard cap '
            '($_maxLimit / $_maxOffset). Mass dumps are blocked.',
      if (result.messages.isEmpty)
        'note': 'No matching messages. Say so naturally in the chat language.',
      if (result.totalResults > result.messages.length)
        'note_more':
            'More matches exist (total_results). Ask the user to narrow '
            'keywords/time; do not keep paging for a dump.',
    });
  }

  _AuthorResolution _resolveAuthorId(ToolContext context, String? raw) {
    if (raw == null || raw.isEmpty) {
      return const _AuthorResolution(null);
    }
    final lower = raw.toLowerCase();
    if (lower == 'me' || lower == 'ich' || lower == 'self') {
      return _AuthorResolution(context.userId);
    }
    if (_snowflakePattern.hasMatch(raw)) {
      return _AuthorResolution(raw);
    }

    final resolution = context.services.contacts.resolve(raw);
    switch (resolution) {
      case ContactResolved(:final contact):
        final id = contact.discordUserId?.trim();
        if (id == null || id.isEmpty) {
          return _AuthorResolution.error(
            'Contact "${contact.name}" has no discord_user_id.',
          );
        }
        return _AuthorResolution(id);
      case ContactAmbiguous(:final matches):
        final names = matches.map((c) => c.name).join(', ');
        return _AuthorResolution.error(
          'author_id "$raw" is ambiguous ($names). Use a Discord id.',
        );
      case ContactNotFound():
        return _AuthorResolution.error(
          'author_id must be "me", a Discord user id, or a known contact '
          'with discord_user_id — not "$raw".',
        );
    }
  }

  String _truncate(String input, int maxChars) {
    if (input.length <= maxChars) return input;
    return '${input.substring(0, maxChars - 1)}…';
  }
}

class _AuthorResolution {
  const _AuthorResolution(this.id) : error = null;
  const _AuthorResolution.error(this.error) : id = null;

  final String? id;
  final String? error;
}
