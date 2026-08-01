import 'dart:async';
import 'dart:collection';
import 'dart:io';

import '../integrations/windows_monitor_client.dart';
import 'ollama_client.dart';
import 'ollama_models.dart';

/// Which model a call needs (ARCHITECTURE.md §5.1).
enum ModelTier {
  /// The GPU model. Gated: only runs while the shared GPU is free.
  big,

  /// The CPU-only utility model. Never touches VRAM, always available.
  small,
}

class GateQueueFullException implements Exception {
  @override
  String toString() => 'The big-model queue is full. Try again later.';
}

class GateTimeoutException implements Exception {
  @override
  String toString() => 'The request waited too long for a free GPU.';
}

class _BigJob {
  _BigJob({
    required this.messages,
    required this.tools,
    required this.ttl,
    this.format,
    this.originChannelId,
  });

  final List<OllamaChatMessage> messages;
  final List<OllamaTool> tools;
  final Object? format;
  final Duration ttl;
  final String? originChannelId;
  final DateTime enqueuedAt = DateTime.now();
  final Completer<OllamaChatMessage> completer = Completer();

  bool get expired => DateTime.now().difference(enqueuedAt) > ttl;
}

/// GPU-aware gate in front of [OllamaClient]. Nothing else in the codebase
/// calls the client directly.
///
/// `big` jobs go through a single-worker FIFO queue and only dispatch while
/// the Windows monitor reports the GPU as free. `small` jobs run immediately
/// on the CPU-pinned utility model. When the machine's user becomes active,
/// the big model is evicted from VRAM.
class LlmGate {
  LlmGate({
    required OllamaClient ollama,
    required WindowsMonitorClient? monitor,
    required String? utilityModel,
    required double busyThresholdPercent,
    required Duration pollInterval,
    Duration interactiveTtl = const Duration(hours: 6),
    int queueCap = 20,
    Duration monitorDownNotifyAfter = const Duration(minutes: 15),
    void Function(String message)? onMonitorDownNotice,
    DateTime Function()? clock,
  })  : _ollama = ollama,
        _monitor = monitor,
        _utilityModel = utilityModel,
        _busyThresholdPercent = busyThresholdPercent,
        _pollInterval = pollInterval,
        _interactiveTtl = interactiveTtl,
        _queueCap = queueCap,
        _monitorDownNotifyAfter = monitorDownNotifyAfter,
        _onMonitorDownNotice = onMonitorDownNotice,
        _clock = clock ?? DateTime.now;

  final OllamaClient _ollama;
  final WindowsMonitorClient? _monitor;
  final String? _utilityModel;
  final double _busyThresholdPercent;
  final Duration _pollInterval;
  final Duration _interactiveTtl;
  final int _queueCap;
  final Duration _monitorDownNotifyAfter;
  void Function(String message)? _onMonitorDownNotice;
  final DateTime Function() _clock;

  final Queue<_BigJob> _queue = Queue();
  bool _workerRunning = false;
  bool _bigCallInFlight = false;
  bool _unloadRequested = false;

  DateTime? _lastPollAt;
  bool _lastPollFree = true;

  DateTime? _monitorUnreachableSince;
  bool _monitorDownNotified = false;

  Timer? _hygieneTimer;

  bool get hasUtilityTier => _utilityModel != null;

  int get queuedBigJobs => _queue.length;

  /// Concrete Ollama model name used for [tier] (for logs / bot_info).
  String modelName(ModelTier tier) {
    switch (tier) {
      case ModelTier.small:
        return _utilityModel ?? '(utility disabled)';
      case ModelTier.big:
        return _ollama.model;
    }
  }

  /// Alias used in turn logs: `gpt-oss:20b (big)` / `llama3.2:3b (small)`.
  String modelLabel(ModelTier tier) => '${modelName(tier)} (${tier.name})';


  /// True after an unreachable streak that already produced the one-shot notice.
  bool get monitorDownNotified => _monitorDownNotified;

  /// Wire owner-notification after Discord connects (§5.1).
  set onMonitorDownNotice(void Function(String message)? callback) {
    _onMonitorDownNotice = callback;
  }

  /// Starts the periodic VRAM-hygiene check (§5.1): if the user becomes
  /// active while no big call is running, evict the big model immediately.
  void start() {
    _hygieneTimer ??= Timer.periodic(_pollInterval, (_) {
      unawaited(_pollGpuFree(force: true));
    });
  }

  void dispose() {
    _hygieneTimer?.cancel();
    _hygieneTimer = null;
  }

  Future<OllamaChatMessage> chat({
    required ModelTier tier,
    required List<OllamaChatMessage> messages,
    List<OllamaTool> tools = const [],
    Object? format,
    String? originChannelId,
  }) {
    switch (tier) {
      case ModelTier.small:
        return _chatSmall(messages: messages, tools: tools, format: format);
      case ModelTier.big:
        return _enqueueBig(
          messages: messages,
          tools: tools,
          format: format,
          originChannelId: originChannelId,
        );
    }
  }

  /// Unique origin channels of currently queued big jobs (for exit-42 notices).
  Set<String> queuedOriginChannels() {
    final channels = <String>{};
    for (final job in _queue) {
      final id = job.originChannelId;
      if (id != null && id.isNotEmpty) channels.add(id);
    }
    return channels;
  }

  /// Cheap, cached view of the gate state used to pick the tier for a turn.
  Future<bool> isGpuFree() async {
    final last = _lastPollAt;
    if (last != null && _clock().difference(last) < _pollInterval) {
      return _lastPollFree;
    }
    return _pollGpuFree(force: true);
  }

  Future<OllamaChatMessage> _chatSmall({
    required List<OllamaChatMessage> messages,
    required List<OllamaTool> tools,
    Object? format,
  }) async {
    final model = _utilityModel;
    if (model == null) {
      throw StateError('Utility tier is disabled (OLLAMA_UTILITY_MODEL).');
    }
    return _withOneRetry(
      () => _ollama.chatCompletion(
        messages: messages,
        tools: tools,
        modelOverride: model,
        // Never let the utility model claim VRAM (§5.1).
        options: const {'num_gpu': 0},
        format: format,
      ),
    );
  }

  Future<OllamaChatMessage> _enqueueBig({
    required List<OllamaChatMessage> messages,
    required List<OllamaTool> tools,
    Object? format,
    String? originChannelId,
  }) {
    if (_queue.length >= _queueCap) {
      throw GateQueueFullException();
    }
    final job = _BigJob(
      messages: messages,
      tools: tools,
      ttl: _interactiveTtl,
      format: format,
      originChannelId: originChannelId,
    );
    _queue.add(job);
    if (!_workerRunning) {
      _workerRunning = true;
      unawaited(_runWorker());
    }
    return job.completer.future;
  }

  Future<void> _runWorker() async {
    try {
      while (_queue.isNotEmpty) {
        final job = _queue.first;

        if (job.expired) {
          _queue.removeFirst();
          job.completer.completeError(GateTimeoutException());
          continue;
        }

        if (!await _pollGpuFree(force: true)) {
          await Future<void>.delayed(_pollInterval);
          continue;
        }

        _queue.removeFirst();
        _bigCallInFlight = true;
        try {
          final reply = await _withOneRetry(
            () => _ollama.chatCompletion(
              messages: job.messages,
              tools: job.tools,
              format: job.format,
            ),
          );
          job.completer.complete(reply);
        } catch (error, stackTrace) {
          job.completer.completeError(error, stackTrace);
        } finally {
          _bigCallInFlight = false;
        }
      }
    } finally {
      _workerRunning = false;
      // Jobs may have been enqueued while we were finishing up.
      if (_queue.isNotEmpty) {
        _workerRunning = true;
        unawaited(_runWorker());
      }
    }
  }

  /// One retry on transport errors (§5); model/HTTP errors surface directly.
  Future<OllamaChatMessage> _withOneRetry(
    Future<OllamaChatMessage> Function() call,
  ) async {
    try {
      return await call();
    } on SocketException {
      await Future<void>.delayed(const Duration(seconds: 2));
      return call();
    } on TimeoutException {
      await Future<void>.delayed(const Duration(seconds: 2));
      return call();
    }
  }

  /// Polls the monitor. Policy (§5.1): user active OR 5-min-avg GPU load
  /// above threshold → busy. Monitor unreachable → treat as free (prefer the
  /// big model). No monitor configured → always free (local development).
  Future<bool> _pollGpuFree({required bool force}) async {
    final monitor = _monitor;
    bool free;
    var userActive = false;
    var unreachable = false;
    if (monitor == null) {
      free = true;
    } else {
      try {
        userActive = await monitor.isUserActive();
        if (userActive) {
          free = false;
        } else {
          final usage = await monitor.getResourceUsage();
          final gpu = usage['gpuUsagePercent'];
          final avg = gpu is Map ? (gpu['avg5m'] as num?)?.toDouble() : null;
          free = avg == null || avg <= _busyThresholdPercent;
        }
      } catch (error) {
        stderr.writeln(
          'GPU monitor unreachable, treating as free (big model): $error',
        );
        free = true;
        unreachable = true;
      }
    }

    _lastPollAt = _clock();
    _lastPollFree = free;
    _updateMonitorDownState(unreachable: unreachable);

    if (userActive && !_bigCallInFlight && !_unloadRequested) {
      _unloadRequested = true;
      unawaited(_evictBigModel());
    }
    if (free) {
      _unloadRequested = false;
    }
    return free;
  }

  void _updateMonitorDownState({required bool unreachable}) {
    if (!unreachable) {
      _monitorUnreachableSince = null;
      _monitorDownNotified = false;
      return;
    }
    _monitorUnreachableSince ??= _clock();
    if (_monitorDownNotified) return;
    final since = _monitorUnreachableSince!;
    if (_clock().difference(since) < _monitorDownNotifyAfter) return;
    _monitorDownNotified = true;
    final message = 'monitor down, treating GPU as free';
    stderr.writeln('GPU gate: $message');
    _onMonitorDownNotice?.call(message);
  }

  /// VRAM hygiene: evict the big model the moment the user starts using the
  /// machine, instead of letting Ollama's keep-alive hold it (§5.1).
  Future<void> _evictBigModel() async {
    try {
      final loaded = await _ollama.loadedModels();
      if (loaded.contains(_ollama.model)) {
        await _ollama.requestUnload(_ollama.model);
        stderr.writeln('Evicted ${_ollama.model} from VRAM (user active).');
      }
    } catch (error) {
      stderr.writeln('VRAM eviction failed (best effort): $error');
    }
  }
}
