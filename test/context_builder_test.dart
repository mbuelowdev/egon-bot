import 'package:egon_bot/src/agent/context_builder.dart';
import 'package:egon_bot/src/agent/prompts.dart';
import 'package:egon_bot/src/time/timestamps.dart';
import 'package:test/test.dart';

void main() {
  final timestamps = Timestamps('Europe/Berlin');

  group('priorHistoryExcludingCurrent', () {
    test('drops the matching last entry', () {
      final history = [
        ChannelMessage(
          timestamp: DateTime.utc(2026, 8, 1, 12),
          authorId: '1',
          authorName: 'Michael',
          content: 'first',
        ),
        ChannelMessage(
          timestamp: DateTime.utc(2026, 8, 1, 13),
          authorId: '1',
          authorName: 'Michael',
          content: 'follow-up',
        ),
      ];
      final prior = priorHistoryExcludingCurrent(
        history,
        authorId: '1',
        content: 'follow-up',
      );
      expect(prior, hasLength(1));
      expect(prior.single.content, 'first');
    });

    test('keeps history when the last entry differs', () {
      final history = [
        ChannelMessage(
          timestamp: DateTime.utc(2026, 8, 1, 12),
          authorId: '1',
          authorName: 'Michael',
          content: 'only',
        ),
      ];
      expect(
        priorHistoryExcludingCurrent(
          history,
          authorId: '1',
          content: 'other',
        ),
        same(history),
      );
    });
  });

  group('historyAsChatMessages', () {
    test('maps bot replies to assistant and others to user with ids', () {
      final messages = historyAsChatMessages(
        [
          ChannelMessage(
            timestamp: DateTime.utc(2026, 8, 1, 12),
            authorId: '1',
            authorName: 'Michael',
            content: 'Profilbild von Max holen',
          ),
          ChannelMessage(
            timestamp: DateTime.utc(2026, 8, 1, 12, 1),
            authorId: 'bot',
            authorName: botPromptDisplayName,
            content: 'LinkedIn blockiert den Zugriff',
          ),
          ChannelMessage(
            timestamp: DateTime.utc(2026, 8, 1, 12, 2),
            authorId: '1',
            authorName: 'Michael',
            content: 'Dann post das erste Photo',
          ),
        ],
        timestamps: timestamps,
        botAuthorName: botPromptDisplayName,
      );

      expect(messages.map((m) => m.role).toList(), [
        'user',
        'assistant',
        'user',
      ]);
      expect(messages[0].content, contains('id=1'));
      expect(messages[0].content, contains('Profilbild von Max'));
      expect(messages[1].content, 'LinkedIn blockiert den Zugriff');
      expect(messages[2].content, contains('erste Photo'));
    });
  });

  group('conversation context prompts', () {
    test('DM prompt requires history before clarifying questions', () {
      final prompt = buildDmSystemPrompt(
        authorName: 'Michael',
        isOwner: true,
        memoryLines: '(nothing relevant)',
        localNow: 'now',
      );
      expect(prompt, contains('chat history does not resolve it'));
      expect(prompt, contains('Conversation context'));
      expect(prompt, contains('Always answer in English'));
      expect(prompt, isNot(contains('Bisheriger Verlauf')));
    });

    test('group prompt includes conversation context rules', () {
      final prompt = buildGroupSystemPrompt(
        memoryLines: '(nothing relevant)',
        localNow: 'now',
      );
      expect(prompt, contains('Conversation context'));
      expect(prompt, contains('Always answer in English'));
      expect(prompt, isNot(contains('Bisheriger Chatverlauf')));
    });
  });
}
