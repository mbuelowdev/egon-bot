import 'package:egon_bot/src/agent/context_builder.dart';
import 'package:egon_bot/src/memory/memory_service.dart';
import 'package:egon_bot/src/storage/database.dart';
import 'package:egon_bot/src/tools/builtin/list_memories_tool.dart';
import 'package:egon_bot/src/tools/builtin/remember_tool.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('MemoryService', () {
    test('FTS recall returns relevant memories most-recent first', () {
      final db = AppDatabase.inMemory();
      final memory = MemoryService(db);

      memory.remember(
        userId: ownerId,
        content: 'Michael likes dark roast coffee',
        source: 'dm',
      );
      final teaId = memory.remember(
        userId: ownerId,
        content: 'Michael prefers green tea in the evening',
        source: 'explicit',
      );
      memory.remember(
        userId: ownerId,
        content: 'The printer is in the basement',
        source: 'agent',
      );

      final hits = memory.search('tea evening');
      expect(hits, isNotEmpty);
      expect(hits.first.id, teaId);
      expect(hits.first.content, contains('green tea'));

      final coffee = memory.search('coffee roast');
      expect(coffee.any((m) => m.content.contains('dark roast')), isTrue);
    });

    test('forget removes a memory from FTS', () {
      final db = AppDatabase.inMemory();
      final memory = MemoryService(db);
      final id = memory.remember(
        userId: ownerId,
        content: 'temporary secret passphrase zebra',
        source: 'explicit',
      );
      expect(memory.search('zebra'), isNotEmpty);
      expect(memory.forget(id), isTrue);
      expect(memory.search('zebra'), isEmpty);
      expect(memory.forget(id), isFalse);
    });

    test('buildFtsQuery strips operators and short tokens', () {
      expect(MemoryService.buildFtsQuery('a OR b'), '');
      expect(
        MemoryService.buildFtsQuery('hello "world" AND coffee'),
        contains('"hello"'),
      );
      expect(
        MemoryService.buildFtsQuery('hello "world" AND coffee'),
        contains('"coffee"'),
      );
      expect(
        MemoryService.buildFtsQuery('hello "world" AND coffee'),
        isNot(contains(' AND ')),
      );
    });

    test('conversation_log prunes to max messages per channel', () {
      final db = AppDatabase.inMemory();
      final history = ChannelHistoryStore(db);
      final total = ChannelHistoryStore.maxMessagesPerChannel + 10;
      for (var i = 0; i < total; i++) {
        history.add(
          '42',
          ChannelMessage(
            timestamp: DateTime.utc(2026, 1, 1).add(Duration(minutes: i)),
            authorId: ownerId,
            authorName: 'Michael',
            content: 'msg $i',
          ),
        );
      }
      final count = db.db
          .select(
            "SELECT COUNT(*) AS c FROM conversation_log WHERE channel_id = '42'",
          )
          .first['c'] as int;
      expect(count, ChannelHistoryStore.maxMessagesPerChannel);

      final recent = history.recent('42', limit: 3);
      expect(recent.map((m) => m.content).toList(), [
        'msg ${total - 3}',
        'msg ${total - 2}',
        'msg ${total - 1}',
      ]);
    });
  });

  group('memory tools', () {
    test('list_memories refuses guild channels', () async {
      final services = testServices(tools: [ListMemoriesTool()]);
      services.memory.remember(
        userId: ownerId,
        content: 'fact',
        source: 'explicit',
      );
      final result = await ListMemoriesTool().execute(
        contextFor(services, owner: true, isDm: false),
        const {},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('DMs'));
    });

    test('remember tool stores an explicit memory', () async {
      final services = testServices(tools: [RememberTool()]);
      final result = await RememberTool().execute(
        contextFor(services, owner: true, isDm: true),
        {'content': 'Allergy: peanuts', 'tags': 'health'},
      );
      expect(result.isError, isFalse);
      final hits = services.memory.search('peanuts');
      expect(hits, hasLength(1));
      expect(hits.first.source, 'explicit');
      expect(hits.first.tags, 'health');
    });
  });
}
