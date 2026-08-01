import 'package:egon_bot/src/agent/prompts.dart';
import 'package:test/test.dart';

void main() {
  group('formatMentionsForPrompt', () {
    test('rewrites the bot mention to a plain @label', () {
      expect(
        formatMentionsForPrompt('hey <@99> ping', '99', 'Egon'),
        'hey @Egon ping',
      );
      expect(
        formatMentionsForPrompt('hey <@!99> ping', '99', 'Egon'),
        'hey @Egon ping',
      );
    });

    test('annotates other users as @Name (<@id>)', () {
      expect(
        formatMentionsForPrompt(
          'ask <@42> later <@!99>',
          '99',
          'Egon',
          mentionedUserLabels: {'42': 'Flo', '99': 'Egon'},
        ),
        'ask @Flo (<@42>) later @Egon',
      );
    });

    test('leaves unknown mention tokens unchanged', () {
      expect(
        formatMentionsForPrompt('see <@7>', '99', 'Egon'),
        'see <@7>',
      );
    });
  });

  group('discordUserPromptLabel', () {
    test('prefers global name over username', () {
      expect(
        discordUserPromptLabel(
          id: '1',
          globalName: 'Flo',
          username: 'flo123',
        ),
        'Flo',
      );
    });

    test('falls back to username then id', () {
      expect(
        discordUserPromptLabel(id: '1', globalName: '  ', username: 'flo123'),
        'flo123',
      );
      expect(
        discordUserPromptLabel(id: '1', globalName: null, username: ''),
        '1',
      );
    });
  });
}
