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
You are a Discord assistant bot.

Write a helpful, concise reply to the latest user message.
Keep the response short unless the user clearly asks for details.

Latest user message:
The user $targetUserName wants $targetMessage

Recent chat history:
${historyLines.isEmpty ? '- (no history available)' : historyLines}
''';
}
