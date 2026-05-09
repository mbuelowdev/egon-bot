import '../time/berlin_timestamp.dart';

class ChannelMessageMemoryEntry {
  ChannelMessageMemoryEntry({
    required this.timestamp,
    required this.userName,
    required this.content,
  });

  final DateTime timestamp;
  final String userName;
  final String content;

  String toPromptLine({String? contentForPrompt}) {
    final text = contentForPrompt ?? content;
    return '[${formatEuropeBerlinForPrompt(timestamp)}] "$userName" said: $text';
  }
}
