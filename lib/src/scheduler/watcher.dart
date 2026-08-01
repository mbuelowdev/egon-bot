import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

import '../llm/llm_gate.dart';
import '../llm/ollama_models.dart';
import '../services.dart';
import '../web/fetch_api.dart';
import 'task_store.dart';
import 'watch_spec.dart';

/// Outcome of one watcher tick (§8).
class WatchRunResult {
  WatchRunResult({
    required this.state,
    required this.done,
    this.alert,
    this.ownerWarning,
  });

  final WatchState state;
  final bool done;
  final String? alert;
  final String? ownerWarning;
}

/// Executes a single `watch` task: fetch → diff → utility condition → alert.
class Watcher {
  Watcher(this.services);

  final Services services;

  static const conditionSchema = {
    'type': 'object',
    'properties': {
      'triggered': {'type': 'boolean'},
      'evidence': {'type': 'string'},
    },
    'required': ['triggered'],
  };

  Future<WatchRunResult> run(ScheduledTask task) async {
    final spec = WatchSpec.decode(task.payload);
    final previous = WatchState.decode(task.stateJson);

    FetchedPage page;
    try {
      page = await services.fetchApi.fetch(spec.url);
    } catch (error) {
      final failures = previous.consecutiveFailures + 1;
      final state = WatchState(
        hash: previous.hash,
        snippet: previous.snippet,
        consecutiveFailures: failures,
        lastCheckedAt: DateTime.now().toUtc(),
      );
      String? warning;
      if (failures >= 3 && failures % 3 == 0) {
        warning =
            'Watcher #${task.id} failed $failures times in a row fetching '
            '${spec.url}: $error';
      }
      stdout.writeln('Watcher #${task.id} fetch failed: $error');
      return WatchRunResult(state: state, done: false, ownerWarning: warning);
    }

    final hash = sha256.convert(utf8.encode(page.text)).toString();
    final snippet = _snippet(page.text);
    final state = WatchState(
      hash: hash,
      snippet: snippet,
      consecutiveFailures: 0,
      lastCheckedAt: DateTime.now().toUtc(),
    );

    // First successful snapshot — just store it.
    if (previous.hash == null) {
      return WatchRunResult(state: state, done: false);
    }
    // Unchanged — nothing to do.
    if (previous.hash == hash) {
      return WatchRunResult(state: state, done: false);
    }

    final decision = await _evaluateCondition(
      condition: spec.condition,
      oldText: previous.snippet ?? '',
      newText: snippet,
      url: spec.url,
    );

    if (!decision.triggered) {
      return WatchRunResult(state: state, done: false);
    }

    final evidence = (decision.evidence ?? snippet).trim();
    final quote =
        evidence.length > 400 ? '${evidence.substring(0, 397)}...' : evidence;
    final alert = 'Watcher triggered for ${spec.url}\n'
        'Condition: ${spec.condition}\n'
        'Evidence: "$quote"';

    return WatchRunResult(
      state: state,
      done: spec.untilTriggered,
      alert: alert,
    );
  }

  Future<({bool triggered, String? evidence})> _evaluateCondition({
    required String condition,
    required String oldText,
    required String newText,
    required String url,
  }) async {
    if (!services.llmGate.hasUtilityTier) {
      return _keywordFallback(condition, newText);
    }
    try {
      final reply = await services.llmGate.chat(
        tier: ModelTier.small,
        format: conditionSchema,
        messages: [
          OllamaChatMessage(
            role: 'system',
            content:
                'You evaluate whether a watch condition became true after a '
                'web page changed. Reply only with JSON '
                '{"triggered": bool, "evidence": "short quote from NEW text"}. '
                'triggered=true only when the NEW text clearly satisfies the '
                'condition. Prefer precision over recall.',
          ),
          OllamaChatMessage(
            role: 'user',
            content: 'URL: $url\n'
                'Condition: $condition\n\n'
                '## OLD text\n$oldText\n\n'
                '## NEW text\n$newText',
          ),
        ],
      );
      return _parseDecision(reply.content);
    } catch (error) {
      stderr.writeln('Watcher condition model failed: $error');
      return _keywordFallback(condition, newText);
    }
  }

  static ({bool triggered, String? evidence}) _parseDecision(String raw) {
    try {
      final trimmed = raw.trim();
      final unfenced = trimmed
          .replaceFirst(RegExp(r'^```(?:json)?\s*', multiLine: true), '')
          .replaceFirst(RegExp(r'```\s*$'), '')
          .trim();
      final decoded = jsonDecode(unfenced);
      if (decoded is! Map) {
        return (triggered: false, evidence: null);
      }
      final map = decoded.cast<String, Object?>();
      final triggered = map['triggered'] == true;
      final evidence = map['evidence']?.toString();
      return (triggered: triggered, evidence: evidence);
    } catch (_) {
      return (triggered: false, evidence: null);
    }
  }

  static ({bool triggered, String? evidence}) _keywordFallback(
    String condition,
    String newText,
  ) {
    final words = condition
        .toLowerCase()
        .split(RegExp(r'[^a-z0-9äöüß]+'))
        .where((w) => w.length >= 4)
        .where(
          (w) => !const {
            'when',
            'that',
            'this',
            'with',
            'from',
            'have',
            'been',
            'will',
            'does',
            'live',
            'goes',
            'tell',
            'page',
            'site',
          }.contains(w),
        )
        .toList();
    final lower = newText.toLowerCase();
    for (final w in words) {
      if (lower.contains(w)) {
        final idx = lower.indexOf(w);
        final start = idx > 40 ? idx - 40 : 0;
        final end = (idx + w.length + 80) > newText.length
            ? newText.length
            : idx + w.length + 80;
        return (triggered: true, evidence: newText.substring(start, end));
      }
    }
    // Content changed but no keyword hit — do not false-trigger.
    return (triggered: false, evidence: null);
  }

  static String _snippet(String text, {int max = 1500}) {
    final t = text.trim();
    if (t.length <= max) return t;
    return '${t.substring(0, max - 1)}…';
  }
}
