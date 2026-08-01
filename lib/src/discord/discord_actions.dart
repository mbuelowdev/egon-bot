import 'package:nyxx/nyxx.dart';

const discordMessageLimit = 2000;

/// Splits [text] into Discord-sized chunks, preferring line boundaries.
List<String> splitForDiscord(String text, {int limit = discordMessageLimit}) {
  if (text.length <= limit) return [text];

  final chunks = <String>[];
  var remaining = text;
  while (remaining.length > limit) {
    var cut = remaining.lastIndexOf('\n', limit);
    if (cut <= 0) {
      cut = remaining.lastIndexOf(' ', limit);
    }
    if (cut <= 0) {
      cut = limit;
    }
    chunks.add(remaining.substring(0, cut).trimRight());
    remaining = remaining.substring(cut).trimLeft();
  }
  if (remaining.isNotEmpty) {
    chunks.add(remaining);
  }
  return chunks;
}

/// Sends [text] to [channel], split into multiple messages when needed.
Future<void> sendLongMessage(PartialTextChannel channel, String text) async {
  for (final chunk in splitForDiscord(text)) {
    await channel.sendMessage(MessageBuilder(content: chunk));
  }
}
