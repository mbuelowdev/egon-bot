/// Serializes agent turns per Discord channel so tool side-effects never
/// overlap when a second mention arrives while the first is still running.
class ChannelTurnQueue {
  final Map<String, Future<void>> _tails = {};
  final Set<String> _inflight = {};

  /// True while an agent turn is executing for [channelId].
  bool isBusy(String channelId) => _inflight.contains(channelId);

  /// Runs [turn] after any prior turn for [channelId] finishes.
  Future<void> enqueue(String channelId, Future<void> Function() turn) {
    final previous = _tails[channelId] ?? Future<void>.value();
    late final Future<void> next;
    next = previous.catchError((_) {}).then((_) async {
      _inflight.add(channelId);
      try {
        await turn();
      } finally {
        _inflight.remove(channelId);
      }
    });
    _tails[channelId] = next;
    next.whenComplete(() {
      if (identical(_tails[channelId], next)) {
        _tails.remove(channelId);
      }
    });
    return next;
  }
}
