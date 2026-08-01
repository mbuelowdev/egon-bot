import 'package:egon_bot/src/discord/discord_search_api.dart';
import 'package:egon_bot/src/tools/builtin/search_discord_messages_tool.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('snowflakeAtOrAfter', () {
    test('encodes Discord epoch boundary', () {
      final id = snowflakeAtOrAfter(
        DateTime.fromMillisecondsSinceEpoch(discordEpochMs, isUtc: true),
      );
      expect(id, '0');
    });

    test('grows with later timestamps', () {
      final a = BigInt.parse(snowflakeAtOrAfter(DateTime.utc(2020, 1, 1)));
      final b = BigInt.parse(snowflakeAtOrAfter(DateTime.utc(2024, 1, 1)));
      expect(b > a, isTrue);
    });
  });

  group('DiscordSearchApi.parseSearchResponse', () {
    test('flattens hit groups and builds jump urls', () {
      final result = DiscordSearchApi.parseSearchResponse(
        {
          'total_results': 2,
          'messages': [
            [
              {
                'id': '111',
                'channel_id': '42',
                'content': 'hello world',
                'timestamp': '2026-01-01T12:00:00.000Z',
                'hit': true,
                'author': {
                  'id': '9',
                  'username': 'alice',
                  'global_name': 'Alice',
                },
              },
            ],
            [
              {
                'id': '222',
                'channel_id': '42',
                'content': 'second',
                'timestamp': '2026-01-02T12:00:00.000Z',
                'author': {'id': '8', 'username': 'bob'},
              },
            ],
          ],
        },
        guildId: '99',
      );

      expect(result.totalResults, 2);
      expect(result.messages, hasLength(2));
      expect(result.messages.first.authorName, 'Alice');
      expect(result.messages.first.jumpUrl,
          'https://discord.com/channels/99/42/111');
      expect(result.messages[1].authorName, 'bob');
    });
  });

  group('search_discord_messages tool', () {
    test('searches current allowed channel by default', () async {
      DiscordMessageSearchQuery? seenQuery;
      String? seenGuild;
      final tool = SearchDiscordMessagesTool();
      final api = DiscordSearchApi(
        searchImpl: ({required guildId, required query}) async {
          seenGuild = guildId;
          seenQuery = query;
          return DiscordMessageSearchResult(
            totalResults: 1,
            messages: [
              DiscordSearchHit(
                id: '111',
                channelId: '42',
                authorId: '9',
                authorName: 'Alice',
                content: 'pizza night',
                timestamp: '2026-01-01T12:00:00.000Z',
                jumpUrl: 'https://discord.com/channels/99/42/111',
              ),
            ],
          );
        },
      );
      final services = testServices(
        tools: [tool],
        discordSearch: _FakeDiscordSearch(api),
      );
      final result = await tool.execute(
        contextFor(services, owner: false),
        {'content': 'pizza'},
      );

      expect(result.isError, isFalse);
      expect(seenGuild, '99');
      expect(seenQuery?.content, 'pizza');
      expect(seenQuery?.channelIds, ['42']);
      expect(result.json['total_results'], 1);
      final messages = result.json['messages'] as List;
      expect(messages, hasLength(1));
      expect((messages.first as Map)['content'], 'pizza night');
    });

    test('resolves author_id me and defaults a 24h window', () async {
      DiscordMessageSearchQuery? seen;
      final now = DateTime.utc(2026, 8, 1, 14, 0);
      final tool = SearchDiscordMessagesTool(clock: () => now);
      final api = DiscordSearchApi(
        searchImpl: ({required guildId, required query}) async {
          seen = query;
          return DiscordMessageSearchResult(
            totalResults: 0,
            messages: const [],
          );
        },
      );
      final services = testServices(
        tools: [tool],
        discordSearch: _FakeDiscordSearch(api),
      );
      final result = await tool.execute(
        contextFor(services, owner: false),
        {'author_id': 'me'},
      );

      expect(result.isError, isFalse);
      expect(seen?.authorIds, [strangerId]);
      expect(seen?.minId, isNotNull);
      expect(
        seen?.minId,
        snowflakeAtOrAfter(now.subtract(const Duration(hours: 24))),
      );
      expect(result.json['query'], containsPair('after_defaulted', true));
    });

    test('filters by after/before for yesterday-style queries', () async {
      DiscordMessageSearchQuery? seen;
      final tool = SearchDiscordMessagesTool(
        clock: () => DateTime.utc(2026, 8, 1, 12),
      );
      final api = DiscordSearchApi(
        searchImpl: ({required guildId, required query}) async {
          seen = query;
          return DiscordMessageSearchResult(
            totalResults: 0,
            messages: const [],
          );
        },
      );
      final services = testServices(
        tools: [tool],
        discordSearch: _FakeDiscordSearch(api),
      );
      final result = await tool.execute(
        contextFor(services, owner: true),
        {
          'author_id': 'me',
          'after': '2026-07-31 00:00:00',
          'before': '2026-08-01 00:00:00',
        },
      );

      expect(result.isError, isFalse);
      expect(seen?.authorIds, [ownerId]);
      expect(seen?.minId, isNotNull);
      expect(seen?.maxId, isNotNull);
      final min = BigInt.parse(seen!.minId!);
      final max = BigInt.parse(seen!.maxId!);
      expect(max > min, isTrue);
    });

    test('rejects oversized time ranges without keywords', () async {
      final tool = SearchDiscordMessagesTool();
      final services = testServices(
        tools: [tool],
        discordSearch: _FakeDiscordSearch(DiscordSearchApi()),
      );
      final result = await tool.execute(
        contextFor(services, owner: true),
        {
          'author_id': 'me',
          'after': '2026-01-01 00:00:00',
          'before': '2026-03-01 00:00:00',
        },
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('Time range too large'));
    });

    test('hard-caps absurd limit/offset requests', () async {
      DiscordMessageSearchQuery? seen;
      final tool = SearchDiscordMessagesTool();
      final api = DiscordSearchApi(
        searchImpl: ({required guildId, required query}) async {
          seen = query;
          return DiscordMessageSearchResult(
            totalResults: 999999,
            messages: const [],
          );
        },
      );
      final services = testServices(
        tools: [tool],
        discordSearch: _FakeDiscordSearch(api),
      );
      final result = await tool.execute(
        contextFor(services, owner: true),
        {
          'author_id': 'me',
          'after': '2026-08-01 00:00:00',
          'before': '2026-08-01 12:00:00',
          'limit': 100000000,
          'offset': 100000000,
        },
      );

      expect(result.isError, isFalse);
      expect(seen?.limit, 15);
      expect(seen?.offset, 15);
      expect(result.json['note_capped'], isNotNull);
      expect(result.json['policy'], contains('Hard caps'));
    });

    test('rejects channel outside ALLOWED_CHANNEL_IDS', () async {
      final tool = SearchDiscordMessagesTool();
      final services = testServices(
        tools: [tool],
        discordSearch: _FakeDiscordSearch(DiscordSearchApi()),
      );
      final result = await tool.execute(
        contextFor(services, owner: true),
        {'content': 'x', 'channel_id': '999'},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('ALLOWED_CHANNEL_IDS'));
    });

    test('requires at least one filter', () async {
      final tool = SearchDiscordMessagesTool();
      final services = testServices(
        tools: [tool],
        discordSearch: _FakeDiscordSearch(DiscordSearchApi()),
      );
      final result = await tool.execute(
        contextFor(services, owner: true),
        {},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('content'));
    });

    test('reports indexing status', () async {
      final tool = SearchDiscordMessagesTool();
      final api = DiscordSearchApi(
        searchImpl: ({required guildId, required query}) async =>
            DiscordMessageSearchResult(
              totalResults: 0,
              messages: const [],
              indexing: true,
              retryAfterSeconds: 2,
            ),
      );
      final services = testServices(
        tools: [tool],
        discordSearch: _FakeDiscordSearch(api),
      );
      final result = await tool.execute(
        contextFor(services, owner: true),
        {'content': 'later'},
      );
      expect(result.isError, isFalse);
      expect(result.json['status'], 'indexing');
      expect(result.json['retry_after'], 2);
    });

    test('resolves author via contact discord_user_id', () async {
      DiscordMessageSearchQuery? seen;
      final tool = SearchDiscordMessagesTool(
        clock: () => DateTime.utc(2026, 8, 1, 12),
      );
      final api = DiscordSearchApi(
        searchImpl: ({required guildId, required query}) async {
          seen = query;
          return DiscordMessageSearchResult(
            totalResults: 0,
            messages: const [],
          );
        },
      );
      final services = testServices(
        tools: [tool],
        discordSearch: _FakeDiscordSearch(api),
      );
      services.contacts.add(name: 'Jan', discordUserId: '555');
      final result = await tool.execute(
        contextFor(services, owner: true),
        {
          'author_id': 'Jan',
          'after': '2026-08-01 00:00:00',
          'before': '2026-08-01 12:00:00',
        },
      );
      expect(result.isError, isFalse);
      expect(seen?.authorIds, ['555']);
    });
  });
}

/// Test double that resolves a fixed guild without a live Nyxx client.
class _FakeDiscordSearch extends DiscordSearchApi {
  _FakeDiscordSearch(DiscordSearchApi inner)
      : super(searchImpl: ({required guildId, required query}) {
          return inner.searchGuildMessages(guildId: guildId, query: query);
        });

  @override
  Future<String> resolveGuildId(String channelId) async => '99';
}
