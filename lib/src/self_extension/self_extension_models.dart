/// Status values for Cursor-backed self-extension rows.
abstract final class SelfExtensionStatus {
  static const planning = 'planning';
  static const awaitingPlanApproval = 'awaiting_plan_approval';
  static const revisingPlan = 'revising_plan';
  static const implementing = 'implementing';
  static const awaitingMerge = 'awaiting_merge';
  static const done = 'done';
  static const failed = 'failed';
  static const cancelled = 'cancelled';

  static const open = {
    planning,
    awaitingPlanApproval,
    revisingPlan,
    implementing,
    awaitingMerge,
  };

  static const terminal = {done, failed, cancelled};
}

class SelfExtension {
  SelfExtension({
    required this.id,
    required this.createdAt,
    required this.updatedAt,
    required this.createdBy,
    required this.channelId,
    required this.description,
    required this.status,
    this.title,
    this.planMessageId,
    this.cursorAgentId,
    this.cursorRunId,
    this.planMarkdown,
    this.planJson,
    this.revisionNotes,
    this.prUrl,
    this.targetVersion,
    this.error,
    this.approvalId,
  });

  final int id;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String createdBy;
  final String channelId;
  final String description;
  final String status;
  final String? title;
  final String? planMessageId;
  final String? cursorAgentId;
  final String? cursorRunId;
  final String? planMarkdown;
  final String? planJson;
  final String? revisionNotes;
  final String? prUrl;
  final String? targetVersion;
  final String? error;
  final int? approvalId;

  bool get isOpen => SelfExtensionStatus.open.contains(status);

  Map<String, Object?> toOverviewJson() => {
        'id': id,
        'status': status,
        'title': title,
        'description': description,
        'pr_url': prUrl,
        'target_version': targetVersion,
        'cursor_agent_id': cursorAgentId,
        'channel_id': channelId,
        'error': error,
      };
}
