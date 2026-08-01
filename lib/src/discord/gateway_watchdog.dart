import 'dart:async';
import 'dart:io';

/// Detects zombie Discord gateway connections (§3 Layer 3).
///
/// Call [touch] on every received gateway event / heartbeat ACK. If silence
/// exceeds [silenceTimeout], invokes [onSilence] (default: `exit(1)`).
class GatewayWatchdog {
  GatewayWatchdog({
    this.silenceTimeout = const Duration(minutes: 10),
    this.checkInterval = const Duration(seconds: 30),
    void Function()? onSilence,
    DateTime Function()? clock,
  })  : _onSilence = onSilence ?? _defaultExit,
        _clock = clock ?? DateTime.now;

  final Duration silenceTimeout;
  final Duration checkInterval;
  final void Function() _onSilence;
  final DateTime Function() _clock;

  DateTime _lastTouch = DateTime.now();
  Timer? _timer;
  bool _fired = false;

  DateTime get lastTouch => _lastTouch;

  void touch() {
    _lastTouch = _clock();
  }

  void start() {
    touch();
    _timer?.cancel();
    _timer = Timer.periodic(checkInterval, (_) => _check());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  void _check() {
    if (_fired) return;
    final silentFor = _clock().difference(_lastTouch);
    if (silentFor < silenceTimeout) return;
    _fired = true;
    stderr.writeln(
      'Gateway watchdog: no events for ${silentFor.inMinutes} min — exiting.',
    );
    stop();
    _onSilence();
  }

  static void _defaultExit() => exit(1);
}
