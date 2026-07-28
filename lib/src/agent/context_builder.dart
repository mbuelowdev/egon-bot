import '../time/timestamps.dart';

/// One remembered message in a channel's rolling history.
class ChannelMessage {
  ChannelMessage({
    required this.timestamp,
    required this.authorId,
    required this.authorName,
    required this.content,
  });

  final DateTime timestamp;
  final String authorId;
  final String authorName;
  final String content;
}

/// In-memory rolling per-channel history (persistent `conversation_log`
/// arrives in Phase 2).
class ChannelHistoryStore {
  static const maxMessagesPerChannel = 200;

  final Map<String, List<ChannelMessage>> _byChannel = {};

  void add(String channelId, ChannelMessage message) {
    final list = _byChannel.putIfAbsent(channelId, () => []);
    list.add(message);
    if (list.length > maxMessagesPerChannel) {
      list.removeRange(0, list.length - maxMessagesPerChannel);
    }
  }

  List<ChannelMessage> recent(String channelId, {int limit = 25}) {
    final list = _byChannel[channelId] ?? const [];
    final start = list.length > limit ? list.length - limit : 0;
    return List.unmodifiable(list.sublist(start));
  }
}

const _truncationMarker = ' …[truncated]';

String _truncate(String content, int maxChars) {
  if (content.length <= maxChars) return content;
  if (maxChars <= _truncationMarker.length) {
    return content.substring(0, maxChars);
  }
  return content.substring(0, maxChars - _truncationMarker.length) +
      _truncationMarker;
}

/// Renders history entries as readable prompt lines, oldest first.
String renderHistoryLines(
  List<ChannelMessage> history, {
  required Timestamps timestamps,
  int maxMessageChars = 500,
}) {
  if (history.isEmpty) return '(no messages yet)';
  return history
      .map(
        (m) => '- [${timestamps.format(m.timestamp)}] "${m.authorName}" said: '
            '${_truncate(m.content, maxMessageChars)}',
      )
      .join('\n');
}
