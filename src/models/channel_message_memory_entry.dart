class ChannelMessageMemoryEntry {
  ChannelMessageMemoryEntry({
    required this.timestamp,
    required this.userName,
    required this.content,
  });

  final DateTime timestamp;
  final String userName;
  final String content;

  String toPromptLine() => '[${timestamp.toIso8601String()}] $userName said: $content';
}
