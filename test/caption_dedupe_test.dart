import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('ToolContext caption dedupe', () {
    test('suppresses final reply that only repeats a posted caption', () {
      final context = contextFor(testServices(tools: const []), owner: true);
      context.notePostedCaption('here is that cat meme');

      expect(
        context.replyWithoutDuplicateCaption('Here is that cat meme'),
        isEmpty,
      );
      expect(
        context.replyWithoutDuplicateCaption('something else'),
        'something else',
      );
    });

    test('ignores blank captions and empty replies', () {
      final context = contextFor(testServices(tools: const []), owner: true);
      context.notePostedCaption('  ');
      context.notePostedCaption(null);

      expect(context.postedCaptions, isEmpty);
      expect(context.replyWithoutDuplicateCaption('hi'), 'hi');
      expect(context.replyWithoutDuplicateCaption('  '), isEmpty);
    });
  });
}
