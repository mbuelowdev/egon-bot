import 'dart:convert';

/// Values stored in `jobs.status` (ARCHITECTURE.md §9).
abstract final class JobStatus {
  static const queued = 'queued';
  static const planning = 'planning';
  static const running = 'running';
  static const waitingUser = 'waiting_user';
  static const done = 'done';
  static const failed = 'failed';
  static const cancelled = 'cancelled';

  static const active = {planning, running};
  static const open = {queued, planning, running, waitingUser};
}

/// One step inside [Job.plan].
class JobStep {
  JobStep({
    required this.index,
    required this.description,
    this.status = 'pending',
    this.summary,
  });

  final int index;
  final String description;
  String status; // pending|running|done|skipped
  String? summary;

  Map<String, Object?> toJson() => {
        'step': index,
        'description': description,
        'status': status,
        if (summary != null) 'summary': summary,
      };

  factory JobStep.fromJson(Map<String, Object?> json) => JobStep(
        index: (json['step'] as num?)?.toInt() ?? 0,
        description: (json['description'] as String?) ?? '',
        status: (json['status'] as String?) ?? 'pending',
        summary: json['summary'] as String?,
      );
}

/// One row from the `jobs` table.
class Job {
  Job({
    required this.id,
    required this.createdAt,
    required this.createdBy,
    required this.channelId,
    required this.title,
    required this.instructions,
    required this.plan,
    required this.currentStep,
    required this.status,
    required this.question,
    required this.progressLog,
    required this.result,
    required this.priority,
    required this.updatedAt,
  });

  final int id;
  final DateTime createdAt;
  final String createdBy;
  final String channelId;
  final String title;
  final String instructions;
  final List<JobStep> plan;
  final int? currentStep;
  final String status;
  final String? question;
  final String? progressLog;
  final String? result;
  final int priority;
  final DateTime updatedAt;

  String encodePlan() => jsonEncode([for (final s in plan) s.toJson()]);

  static List<JobStep> decodePlan(String? raw) {
    if (raw == null || raw.isEmpty) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return [
        for (final item in decoded)
          if (item is Map) JobStep.fromJson(item.cast<String, Object?>()),
      ];
    } catch (_) {
      return const [];
    }
  }
}
