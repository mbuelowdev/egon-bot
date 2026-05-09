import '../models/channel_message_memory_entry.dart';

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

String buildReplyToUserPrompt({
  required String targetUserName,
  required String targetMessage,
  required List<ChannelMessageMemoryEntry> chatHistory,
  required String botUserId,
  required String botDisplayName,
  int maxHistoryItems = 30,
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

  // Replaces the bot's id mentions (<@123456789>) with the bots name (Egon)
  final historySlice = chatHistory.sublist(start);
  final historyLines = historySlice.map((entry) {
    final line = entry.toPromptLine(
      contentForPrompt: replaceBotMentionsForPrompt(
        entry.content,
        botUserId,
        botDisplayName,
      ),
    );
    return '- $line';
  }).join('\n');

  return '''
You are a casually-talking friend and discord bot.

A friend of yours asked a question. Reply as if you know them since forever. Reply in their language.

Your friends name is "$targetUserName". He/She/They said to you:
```
$latestMessageFiltered
```

Previously in the chat:
```
${historyLines.isEmpty ? '' : historyLines}
```
''';
}
