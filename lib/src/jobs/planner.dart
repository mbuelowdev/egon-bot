import 'dart:convert';

import '../llm/llm_gate.dart';
import '../llm/ollama_models.dart';
import 'job_models.dart';

/// JSON schema passed to Ollama `format` for structured plans.
const planJsonSchema = {
  'type': 'object',
  'properties': {
    'title': {
      'type': 'string',
      'description': 'Short label for the job, ≤ 60 chars.',
    },
    'steps': {
      'type': 'array',
      'minItems': 2,
      'maxItems': 10,
      'items': {
        'type': 'string',
        'description': 'One concrete, actionable step.',
      },
    },
  },
  'required': ['title', 'steps'],
};

class PlannedJob {
  PlannedJob({required this.title, required this.steps});

  final String title;
  final List<JobStep> steps;
}

/// Expands free-text instructions into a 2–10 step plan via the big model (§9).
class JobPlanner {
  JobPlanner(this._gate);

  final LlmGate _gate;

  Future<PlannedJob> plan(String instructions) async {
    final reply = await _gate.chat(
      tier: ModelTier.big,
      format: planJsonSchema,
      messages: [
        OllamaChatMessage(
          role: 'system',
          content:
              'You are a planning assistant for a Discord bot. Break the user\'s '
              'request into 2–10 concrete sequential steps. Each step should be '
              'something the bot can do with tools (web_search, image_search, '
              'fetch_url, browse_url, download_and_send, memory, scheduling, '
              'obsidian_*, etc.) or by '
              'writing a channel '
              'digest. Do not invent steps that need unavailable capabilities. '
              'For research / deep-dive jobs, include a late step that writes '
              'the full structured report via obsidian_write_note to a path '
              'under Inbox/Research/ (owner must approve the diff), and keep '
              'the final step as a short channel digest of key findings. '
              'Respond only with JSON matching the schema.',
        ),
        OllamaChatMessage(role: 'user', content: instructions),
      ],
    );
    return parsePlanResponse(reply.content,
        fallbackTitle: _fallbackTitle(instructions));
  }

  /// Pure parser — used by unit tests without a live model.
  static PlannedJob parsePlanResponse(
    String raw, {
    required String fallbackTitle,
  }) {
    final trimmed = raw.trim();
    // Tolerate accidental markdown fences.
    final unfenced = trimmed
        .replaceFirst(RegExp(r'^```(?:json)?\s*', multiLine: true), '')
        .replaceFirst(RegExp(r'```\s*$'), '')
        .trim();

    final decoded = jsonDecode(unfenced);
    if (decoded is! Map) {
      throw FormatException('Plan response is not a JSON object.');
    }
    final map = decoded.cast<String, Object?>();
    final title = ((map['title'] as String?)?.trim().isNotEmpty ?? false)
        ? (map['title'] as String).trim()
        : fallbackTitle;
    final stepsRaw = map['steps'];
    if (stepsRaw is! List || stepsRaw.isEmpty) {
      throw FormatException('Plan response missing steps[].');
    }

    final descriptions = <String>[];
    for (final item in stepsRaw) {
      if (item is String && item.trim().isNotEmpty) {
        descriptions.add(item.trim());
      } else if (item is Map) {
        final d = (item['description'] as String?)?.trim();
        if (d != null && d.isNotEmpty) descriptions.add(d);
      }
    }
    if (descriptions.length < 2) {
      throw FormatException(
          'Plan needs at least 2 steps, got ${descriptions.length}.');
    }
    if (descriptions.length > 10) {
      descriptions.removeRange(10, descriptions.length);
    }

    return PlannedJob(
      title: title.length > 80 ? '${title.substring(0, 77)}...' : title,
      steps: [
        for (var i = 0; i < descriptions.length; i++)
          JobStep(index: i + 1, description: descriptions[i]),
      ],
    );
  }

  static String _fallbackTitle(String instructions) {
    final line = instructions.trim().split(RegExp(r'\s*\n\s*')).first;
    if (line.length <= 60) return line.isEmpty ? 'Untitled job' : line;
    return '${line.substring(0, 57)}...';
  }
}
