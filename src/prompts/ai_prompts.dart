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

/// Builds the `system` role message for the chat-format Ollama call.
///
/// Contains Egon's persona, texting rules, the tool-usage instruction, and
/// the recent chat history rendered as readable lines. The latest message is
/// not included here — it is sent as a separate `user` message produced by
/// [buildUserMessageForChat].
String buildSystemPromptForChat({
  required List<ChannelMessageMemoryEntry> chatHistory,
  required String botUserId,
  required String botDisplayName,
  int maxHistoryItems = 10,
  int maxHistoryMessageChars = 500,
}) {
  final start = chatHistory.length > maxHistoryItems
      ? chatHistory.length - maxHistoryItems
      : 0;
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

## Tools
- If a question needs current facts you can't answer from general knowledge (news, current dates, prices, sports scores, weather, recent releases, etc.), call the web_search tool with a concise query in the user's language.
- Otherwise just chat — don't search for opinions, jokes, or things you can answer yourself.
- Never mention the search tool to the user. Just use what you found and reply naturally.

## Recent chat history for context
${historyLines.isEmpty ? '(no recent messages)' : historyLines}
''';
}

/// Builds the `user` role content for the chat-format Ollama call. The author's
/// display name and message timestamp are prepended so the model knows who it
/// is replying to without us having to rely on Ollama's optional `name` field.
String buildUserMessageForChat({
  required String targetUserName,
  required String targetMessage,
  required DateTime targetMessageTimestamp,
  required String botUserId,
  required String botDisplayName,
}) {
  final filtered = replaceBotMentionsForPrompt(
    targetMessage,
    botUserId,
    botDisplayName,
  );
  return '[${formatEuropeBerlinForPrompt(targetMessageTimestamp)}] $targetUserName: $filtered';
}

/// Legacy single-string prompt builder retained for callers that still use
/// `/api/generate`. New code should call [buildSystemPromptForChat] and
/// [buildUserMessageForChat] directly and send chat-format messages.
String buildReplyToUserPrompt({
  required String targetUserName,
  required String targetMessage,
  required DateTime targetMessageTimestamp,
  required List<ChannelMessageMemoryEntry> chatHistory,
  required String botUserId,
  required String botDisplayName,
  int maxHistoryItems = 10,
  int maxHistoryMessageChars = 500,
}) {
  final system = buildSystemPromptForChat(
    chatHistory: chatHistory,
    botUserId: botUserId,
    botDisplayName: botDisplayName,
    maxHistoryItems: maxHistoryItems,
    maxHistoryMessageChars: maxHistoryMessageChars,
  );
  final user = buildUserMessageForChat(
    targetUserName: targetUserName,
    targetMessage: targetMessage,
    targetMessageTimestamp: targetMessageTimestamp,
    botUserId: botUserId,
    botDisplayName: botDisplayName,
  );
  return '$system\n\n---\n\nYour friend $targetUserName just said:\n$user\n\nReply as Egon. Don\'t overthink it.\n';
}
