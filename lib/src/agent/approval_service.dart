import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:nyxx/nyxx.dart';
import 'package:sqlite3/sqlite3.dart';

import '../config.dart';
import '../discord/discord_actions.dart';
import '../services.dart';
import '../storage/database.dart';
import '../tools/tool.dart';

/// Status values stored in `pending_approvals.status`.
abstract final class ApprovalStatus {
  static const pending = 'pending';
  static const approved = 'approved';
  static const rejected = 'rejected';
  static const expired = 'expired';
}

/// Values stored in `pending_approvals.kind`.
abstract final class ApprovalKind {
  static const tool = 'tool';
  static const selfExtensionPlan = 'self_extension_plan';
}

/// A persisted approval request (ARCHITECTURE.md §6.5).
class PendingApproval {
  PendingApproval({
    required this.id,
    required this.createdAt,
    required this.channelId,
    required this.messageId,
    required this.requestedBy,
    required this.toolName,
    required this.args,
    required this.preview,
    required this.status,
    this.kind = ApprovalKind.tool,
  });

  final int id;
  final DateTime createdAt;
  final String channelId;
  final String? messageId;
  final String requestedBy;
  final String toolName;
  final Map<String, Object?> args;
  final String? preview;
  final String status;
  final String kind;

  bool isExpired(Duration ttl, DateTime now) =>
      status == ApprovalStatus.pending && now.difference(createdAt) > ttl;
}

/// Outcome of a button click / programmatic decision.
enum ApprovalDecisionResult {
  /// Call executed (or rejected) and follow-up posted when possible.
  handled,

  /// Clicker is not the owner — answered ephemerally, no state change.
  forbidden,

  /// Row missing / already decided / expired.
  ignored,
}

/// Posts Approve/Reject buttons, persists requests across restarts, and
/// executes the stored tool call once the owner decides (§6.5).
///
/// The tool loop does **not** block on human latency: [requestApproval]
/// returns a pending [ToolResult] immediately so the model can give an
/// interim reply. When the owner later approves, the call runs and a
/// follow-up "Applied ✔" message is posted in the channel.
class ApprovalService {
  ApprovalService({
    required AppDatabase database,
    required Config config,
    required Services Function() services,
    Duration ttl = const Duration(hours: 24),
  })  : _db = database,
        _config = config,
        _services = services,
        _ttl = ttl;

  final AppDatabase _db;
  final Config _config;
  final Services Function() _services;
  final Duration _ttl;

  NyxxGateway? _client;
  StreamSubscription<InteractionCreateEvent<MessageComponentInteraction>>?
      _subscription;

  static const approvePrefix = 'egon:approve:';
  static const rejectPrefix = 'egon:reject:';
  static const extApprovePrefix = 'egon:ext-approve:';
  static const extRejectPrefix = 'egon:ext-reject:';

  /// Inline preview budget inside the approval message (header + fences).
  static const inlinePreviewBudget = 1400;

  void attachClient(NyxxGateway client) {
    _subscription?.cancel();
    _client = client;
    expireStale();
    _subscription = client.onMessageComponentInteraction.listen(
      (event) => unawaited(_onComponent(event.interaction)),
    );
  }

  void detachClient() {
    _subscription?.cancel();
    _subscription = null;
    _client = null;
  }

  /// Marks pending rows past [ttl] as expired. Best-effort disables buttons
  /// on their Discord messages when a client is attached.
  int expireStale({DateTime? now}) {
    final cutoff =
        (now ?? DateTime.now()).toUtc().subtract(_ttl).toIso8601String();
    final stale = _db.db.select(
      "SELECT id, channel_id, message_id FROM pending_approvals "
      "WHERE status = 'pending' AND created_at < ?",
      [cutoff],
    );
    for (final row in stale) {
      final id = row['id'] as int;
      _setStatus(id, ApprovalStatus.expired);
      final channelId = row['channel_id'] as String;
      final messageId = row['message_id'] as String?;
      if (messageId != null) {
        unawaited(
          _disableButtons(
            channelId: channelId,
            messageId: messageId,
            footer: '⏱ Expired',
          ),
        );
      }
    }
    return stale.length;
  }

  PendingApproval? byId(int id) {
    final rows = _db.db.select(
      'SELECT id, created_at, channel_id, message_id, requested_by, tool_name, '
      'args_json, preview, status, kind FROM pending_approvals WHERE id = ?',
      [id],
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  /// Marks a single pending approval expired (e.g. plan superseded by revision).
  void expireById(int id) {
    final pending = byId(id);
    if (pending == null || pending.status != ApprovalStatus.pending) return;
    _setStatus(id, ApprovalStatus.expired);
    if (pending.messageId != null) {
      unawaited(
        _disableButtons(
          channelId: pending.channelId,
          messageId: pending.messageId!,
          footer: '⏱ Superseded',
          approveCustomId: pending.kind == ApprovalKind.selfExtensionPlan
              ? 'egon:done:ext-approve'
              : 'egon:done:approve',
          rejectCustomId: pending.kind == ApprovalKind.selfExtensionPlan
              ? 'egon:done:ext-reject'
              : 'egon:done:reject',
        ),
      );
    }
  }

  /// Creates the DB row, posts the Discord request (when a client is
  /// attached), and returns a pending result for the model.
  Future<ToolResult> requestApproval({
    required ToolContext context,
    required String toolName,
    required Map<String, Object?> args,
    required String preview,
  }) async {
    expireStale();

    final createdAt = DateTime.now().toUtc();
    _db.db.execute(
      'INSERT INTO pending_approvals (created_at, channel_id, message_id, '
      'requested_by, tool_name, args_json, preview, status, kind) '
      'VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)',
      [
        createdAt.toIso8601String(),
        context.channelId,
        context.userId,
        toolName,
        jsonEncode(args),
        preview,
        ApprovalStatus.pending,
        ApprovalKind.tool,
      ],
    );
    final id = _db.db.lastInsertRowId;

    try {
      await _postApprovalMessage(
        id: id,
        channelId: context.channelId,
        requestedBy: context.userId,
        toolName: toolName,
        preview: preview,
        approvePrefix: approvePrefix,
        rejectPrefix: rejectPrefix,
        headerKind: 'Tool',
      );
    } catch (error, stackTrace) {
      stderr.writeln('Failed to post approval $id: $error\n$stackTrace');
      _setStatus(id, ApprovalStatus.expired);
      return ToolResult.error(
        'Could not post the approval request to Discord: $error',
      );
    }

    return ToolResult.ok({
      'status': 'pending_approval',
      'approval_id': id,
      'message': 'Approval request posted in this channel. Tell the user you '
          'prepared the change and are waiting for Michael\'s OK. Do not '
          'claim it was applied yet.',
    });
  }

  /// Posts Approve/Reject for a Cursor self-extension plan. Returns the
  /// approval row id (may be used without a tool-loop [ToolResult]).
  Future<int> requestSelfExtensionPlanApproval({
    required String channelId,
    required String requestedBy,
    required int extensionId,
    required String preview,
  }) async {
    expireStale();

    final createdAt = DateTime.now().toUtc();
    _db.db.execute(
      'INSERT INTO pending_approvals (created_at, channel_id, message_id, '
      'requested_by, tool_name, args_json, preview, status, kind) '
      'VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)',
      [
        createdAt.toIso8601String(),
        channelId,
        requestedBy,
        'extend_self',
        jsonEncode({'extension_id': extensionId}),
        preview,
        ApprovalStatus.pending,
        ApprovalKind.selfExtensionPlan,
      ],
    );
    final id = _db.db.lastInsertRowId;

    try {
      await _postApprovalMessage(
        id: id,
        channelId: channelId,
        requestedBy: requestedBy,
        toolName: 'extend_self #$extensionId',
        preview: preview,
        approvePrefix: extApprovePrefix,
        rejectPrefix: extRejectPrefix,
        headerKind: 'Self-extension plan',
      );
    } catch (error, stackTrace) {
      stderr.writeln(
        'Failed to post self-extension approval $id: $error\n$stackTrace',
      );
      _setStatus(id, ApprovalStatus.expired);
      rethrow;
    }
    return id;
  }

  /// Programmatic decision used by tests and by the button handler.
  ///
  /// Returns [ApprovalDecisionResult.forbidden] when [actorId] is not the
  /// owner (no state change). On approve of a tool call, executes the stored
  /// tool; on approve of a self-extension plan, starts Cursor implement.
  Future<ApprovalDecisionResult> decide({
    required int id,
    required bool approved,
    required String actorId,
  }) async {
    if (actorId != _config.ownerUserId) {
      return ApprovalDecisionResult.forbidden;
    }

    final pending = byId(id);
    if (pending == null || pending.status != ApprovalStatus.pending) {
      return ApprovalDecisionResult.ignored;
    }
    if (pending.isExpired(_ttl, DateTime.now().toUtc())) {
      _setStatus(id, ApprovalStatus.expired);
      if (pending.messageId != null) {
        await _disableButtons(
          channelId: pending.channelId,
          messageId: pending.messageId!,
          footer: '⏱ Expired',
          approveCustomId: pending.kind == ApprovalKind.selfExtensionPlan
              ? 'egon:done:ext-approve'
              : 'egon:done:approve',
          rejectCustomId: pending.kind == ApprovalKind.selfExtensionPlan
              ? 'egon:done:ext-reject'
              : 'egon:done:reject',
        );
      }
      return ApprovalDecisionResult.ignored;
    }

    _setStatus(
      id,
      approved ? ApprovalStatus.approved : ApprovalStatus.rejected,
    );

    if (pending.messageId != null) {
      await _disableButtons(
        channelId: pending.channelId,
        messageId: pending.messageId!,
        footer: approved ? '✅ Approved' : '❌ Rejected',
        approveCustomId: pending.kind == ApprovalKind.selfExtensionPlan
            ? 'egon:done:ext-approve'
            : 'egon:done:approve',
        rejectCustomId: pending.kind == ApprovalKind.selfExtensionPlan
            ? 'egon:done:ext-reject'
            : 'egon:done:reject',
      );
    }

    if (pending.kind == ApprovalKind.selfExtensionPlan) {
      final extensionId = _extensionIdFromArgs(pending.args);
      if (extensionId == null) {
        await _postFollowUp(
          pending.channelId,
          'Approved, but the self-extension id was missing from the request.',
        );
        return ApprovalDecisionResult.handled;
      }
      if (!approved) {
        await _services().selfExtensionRunner.rejectPlan(extensionId);
        return ApprovalDecisionResult.handled;
      }
      await _services().selfExtensionRunner.approvePlan(extensionId);
      return ApprovalDecisionResult.handled;
    }

    if (!approved) {
      await _postFollowUp(
        pending.channelId,
        'Rejected — `${pending.toolName}` will not run '
        '(requested by <@${pending.requestedBy}>).',
      );
      return ApprovalDecisionResult.handled;
    }

    final services = _services();
    final tool = services.registry.byName(pending.toolName);
    if (tool == null) {
      await _postFollowUp(
        pending.channelId,
        'Approved, but tool `${pending.toolName}` is no longer registered.',
      );
      return ApprovalDecisionResult.handled;
    }

    final context = ToolContext(
      channelId: pending.channelId,
      userId: pending.requestedBy,
      isOwner: pending.requestedBy == _config.ownerUserId,
      isDm: false,
      services: services,
    );

    final result = await services.registry.executeApproved(
      tool: tool,
      context: context,
      args: pending.args,
    );

    final summary = result.isError
        ? 'failed: ${result.json['error']}'
        : jsonEncode(result.json);
    final clipped =
        summary.length > 500 ? '${summary.substring(0, 497)}...' : summary;
    await _postFollowUp(
      pending.channelId,
      'Applied ✔ — `${pending.toolName}`: $clipped',
    );
    services.exitIfRestartRequested();
    return ApprovalDecisionResult.handled;
  }

  int? _extensionIdFromArgs(Map<String, Object?> args) {
    final raw = args['extension_id'];
    return switch (raw) {
      int n => n,
      num n => n.toInt(),
      String s => int.tryParse(s),
      _ => null,
    };
  }

  Future<void> _onComponent(MessageComponentInteraction interaction) async {
    final customId = interaction.data.customId;
    final bool approved;
    final int id;
    if (customId.startsWith(approvePrefix)) {
      approved = true;
      id = int.tryParse(customId.substring(approvePrefix.length)) ?? -1;
    } else if (customId.startsWith(rejectPrefix)) {
      approved = false;
      id = int.tryParse(customId.substring(rejectPrefix.length)) ?? -1;
    } else if (customId.startsWith(extApprovePrefix)) {
      approved = true;
      id = int.tryParse(customId.substring(extApprovePrefix.length)) ?? -1;
    } else if (customId.startsWith(extRejectPrefix)) {
      approved = false;
      id = int.tryParse(customId.substring(extRejectPrefix.length)) ?? -1;
    } else {
      return;
    }
    if (id < 0) return;

    final actorId = interaction.user?.id.toString() ??
        interaction.member?.user?.id.toString() ??
        interaction.member?.id.toString();
    if (actorId == null) return;

    final outcome = await decide(
      id: id,
      approved: approved,
      actorId: actorId,
    );

    switch (outcome) {
      case ApprovalDecisionResult.forbidden:
        await interaction.respond(
          MessageBuilder(
            content: 'Only Michael can approve this.',
            flags: MessageFlags.ephemeral,
          ),
        );
      case ApprovalDecisionResult.handled:
      case ApprovalDecisionResult.ignored:
        try {
          // updateMessage: true acknowledges without a visible follow-up;
          // decide() already edited the approval message.
          await interaction.acknowledge(updateMessage: true);
        } catch (_) {
          // Already acknowledged / token expired — ignore.
        }
    }
  }

  Future<void> _postApprovalMessage({
    required int id,
    required String channelId,
    required String requestedBy,
    required String toolName,
    required String preview,
    required String approvePrefix,
    required String rejectPrefix,
    required String headerKind,
  }) async {
    final client = _client;
    if (client == null) {
      // Unit tests / headless: leave message_id null; decide() still works.
      return;
    }

    final channel =
        client.channels[Snowflake.parse(channelId)] as PartialTextChannel;

    final inline = preview.length <= inlinePreviewBudget
        ? preview
        : '${preview.substring(0, inlinePreviewBudget)}\n…[truncated — full '
            'preview attached]';

    final header = '<@${_config.ownerUserId}> — approval needed\n'
        'Requested by <@$requestedBy>\n'
        '$headerKind: `$toolName`\n'
        '```\n$inline\n```';

    final builder = MessageBuilder(
      content: header.length <= discordMessageLimit
          ? header
          : header.substring(0, discordMessageLimit),
      components: [
        ActionRowBuilder(
          components: [
            ButtonBuilder.success(
              label: 'Approve',
              customId: '$approvePrefix$id',
            ),
            ButtonBuilder.danger(
              label: 'Reject',
              customId: '$rejectPrefix$id',
            ),
          ],
        ),
      ],
    );

    if (preview.length > inlinePreviewBudget) {
      builder.attachments = [
        AttachmentBuilder(
          data: utf8.encode(preview),
          fileName: 'preview-$id.txt',
        ),
      ];
    }

    final message = await channel.sendMessage(builder);
    _db.db.execute(
      'UPDATE pending_approvals SET message_id = ? WHERE id = ?',
      [message.id.toString(), id],
    );
  }

  Future<void> _disableButtons({
    required String channelId,
    required String messageId,
    required String footer,
    String approveCustomId = 'egon:done:approve',
    String rejectCustomId = 'egon:done:reject',
  }) async {
    final client = _client;
    if (client == null) return;
    try {
      final channel =
          client.channels[Snowflake.parse(channelId)] as PartialTextChannel;
      final message = await channel.messages.fetch(Snowflake.parse(messageId));
      final content = message.content;
      final updated =
          content.contains(footer) ? content : '$content\n\n$footer';
      await message.update(
        MessageUpdateBuilder(
          content: updated.length <= discordMessageLimit
              ? updated
              : updated.substring(0, discordMessageLimit),
          components: [
            ActionRowBuilder(
              components: [
                ButtonBuilder.success(
                  label: 'Approve',
                  customId: approveCustomId,
                  isDisabled: true,
                ),
                ButtonBuilder.danger(
                  label: 'Reject',
                  customId: rejectCustomId,
                  isDisabled: true,
                ),
              ],
            ),
          ],
        ),
      );
    } catch (error) {
      stderr.writeln(
        'Could not disable approval buttons on $messageId: $error',
      );
    }
  }

  Future<void> _postFollowUp(String channelId, String text) async {
    final client = _client;
    if (client == null) return;
    try {
      final channel =
          client.channels[Snowflake.parse(channelId)] as PartialTextChannel;
      await sendLongMessage(channel, text);
    } catch (error) {
      stderr.writeln('Approval follow-up failed in $channelId: $error');
    }
  }

  void _setStatus(int id, String status) {
    _db.db.execute(
      'UPDATE pending_approvals SET status = ? WHERE id = ?',
      [status, id],
    );
  }

  PendingApproval _fromRow(Row row) {
    final rawArgs = row['args_json'] as String;
    Map<String, Object?> args;
    try {
      final decoded = jsonDecode(rawArgs);
      args = decoded is Map
          ? decoded.cast<String, Object?>()
          : <String, Object?>{};
    } catch (_) {
      args = <String, Object?>{};
    }
    String kind;
    try {
      kind = row['kind'] as String? ?? ApprovalKind.tool;
    } catch (_) {
      kind = ApprovalKind.tool;
    }
    return PendingApproval(
      id: row['id'] as int,
      createdAt: DateTime.parse(row['created_at'] as String),
      channelId: row['channel_id'] as String,
      messageId: row['message_id'] as String?,
      requestedBy: row['requested_by'] as String,
      toolName: row['tool_name'] as String,
      args: args,
      preview: row['preview'] as String?,
      status: row['status'] as String,
      kind: kind,
    );
  }
}
