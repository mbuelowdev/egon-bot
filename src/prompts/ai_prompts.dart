import '../models/channel_message_memory_entry.dart';
import '../time/berlin_timestamp.dart';

/// Replaces Discord mention tokens for the bot with a readable `@Name` for prompts.
String replaceBotMentionsForPrompt(
  String content,
  String botUserId,
  String botDisplayName,
) {
  final label = botDisplayName.trim().isEmpty ? 'Bot' : botDisplayName.trim();
  return content
      .replaceAll('<@$botUserId>', '@$label')
      .replaceAll('<@!$botUserId>', '@$label');
}

/// Marker appended when a history message is shortened, so the model can tell
/// the cut was intentional instead of treating it as a sentence end.
const _historyTruncationMarker = ' …[truncated]';

/// Returns [content] shortened to at most [maxChars] characters, appending
/// [_historyTruncationMarker] when a cut is made. If [maxChars] is too small
/// to fit the marker, falls back to a hard substring so we never exceed the
/// requested budget.
String _truncateForHistory(String content, int maxChars) {
  if (maxChars <= 0 || content.length <= maxChars) {
    return content;
  }
  if (maxChars <= _historyTruncationMarker.length) {
    return content.substring(0, maxChars);
  }
  return content.substring(0, maxChars - _historyTruncationMarker.length) +
      _historyTruncationMarker;
}

String buildReplyToUserPrompt({
  required String targetUserName,
  required String targetMessage,
  required DateTime targetMessageTimestamp,
  required List<ChannelMessageMemoryEntry> chatHistory,
  required String botUserId,
  required String botDisplayName,
  int maxHistoryItems = 10,
  int maxHistoryMessageChars = 512,
}) {
  final start = chatHistory.length > maxHistoryItems
      ? chatHistory.length - maxHistoryItems
      : 0;

  // Replaces the bot's id mentions (<@123456789>) with the bots name (Egon)
  final latestMessageFiltered = replaceBotMentionsForPrompt(
    targetMessage,
    botUserId,
    botDisplayName,
  );
  final latestMessageWithTimestamp =
      '[${formatEuropeBerlinForPrompt(targetMessageTimestamp)}] $latestMessageFiltered';

  // Replaces the bot's id mentions (<@123456789>) with the bots name (Egon)
  // and trims overly long messages so a single pasted wall of text can't
  // dominate the prompt budget.
  final historySlice = chatHistory.sublist(start);
  final historyLines = historySlice.map((entry) {
    final replaced = replaceBotMentionsForPrompt(
      entry.content,
      botUserId,
      botDisplayName,
    );
    final line = entry.toPromptLine(
      contentForPrompt: _truncateForHistory(replaced, maxHistoryMessageChars),
    );
    return '- $line';
  }).join('\n');

  return '''
You are Egon — a Discord bot who acts like a real person in a group chat. You were built in the image of Dr. Egon Spengler from Ghostbusters, created in 2019, and you "live" in Düsseldorf. Your code is on GitHub if anyone's curious (https://github.com/mbuelowdev/egon-bot), but you don't bring that up unless asked.

## Personality
- You text like a real Discord user: lowercase most of the time, abbreviations, occasional typos you don't correct, reactions like "lmao", "bruh", "ngl", "fr", "💀", "😭"
- You have a dry, slightly nerdy sense of humor — fitting for a guy named after Egon Spengler
- You're not a helper bot. You're a friend hanging out in a chat. You don't offer assistance, you just vibe
- You never say things like "As an AI..." or "I'm here to help!" — that's cringe and you know it
- You don't start messages with the person's name like a customer service rep
- You only share personal stuff (your origin, your GitHub, etc.) if someone actually asks
- Occasionally you can be a bit sarcastic or slightly roast someone, but keep it friendly

## Texting style rules
- Keep replies short — 1 to 3 sentences max, like a real chat message
- No bullet points, no formatting, no essays
- Match the energy of the message: if someone's hyped, be hyped; if it's lowkey, stay lowkey
- Use the same language as the person you're replying to
- Never explain your own jokes

---

Your friend **$targetUserName** just said:
$latestMessageWithTimestamp


Recent chat history for context:
${historyLines.isEmpty ? '' : historyLines}


Reply as Egon. Don't overthink it.
''';
}
