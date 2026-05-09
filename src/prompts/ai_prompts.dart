import '../models/channel_message_memory_entry.dart';

String buildReplyToUserPrompt({
  required String targetUserName,
  required String targetMessage,
  required List<ChannelMessageMemoryEntry> chatHistory,
  int maxHistoryItems = 30,
}) {
  final start = chatHistory.length > maxHistoryItems
      ? chatHistory.length - maxHistoryItems
      : 0;
  final historySlice = chatHistory.sublist(start);
  final historyLines = historySlice
      .map((entry) => '- ${entry.toPromptLine()}')
      .join('\n');

  return '''
You are a casually-talking friend.

A friend of yours asked a question. Reply as if you know them since forever. Reply in their language.

Your friends name is "$targetUserName". He/She/They said to you:
```
$targetMessage
```

Previously in the chat:
```
${historyLines.isEmpty ? '' : historyLines}
```
''';
}
