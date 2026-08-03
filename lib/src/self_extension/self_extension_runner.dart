import 'dart:async';
import 'dart:io';

import 'package:nyxx/nyxx.dart';

import '../discord/discord_actions.dart';
import '../integrations/cursor_agents_client.dart';
import '../package_meta.dart';
import '../services.dart';
import 'extension_prompts.dart';
import 'plan_parser.dart';
import 'self_extension_models.dart';
import 'self_extension_store.dart';
import 'version_bump.dart';

/// Orchestrates Cursor Cloud Agents for durable self-extension (§6.4).
class SelfExtensionRunner {
  SelfExtensionRunner({
    required this.services,
    required this.store,
    CursorAgentsClient? client,
    PackageMeta? packageMeta,
    Duration? pollInterval,
  })  : _client = client,
        _packageMeta = packageMeta ?? PackageMeta(),
        _pollInterval = pollInterval ?? const Duration(seconds: 5);

  final Services services;
  final SelfExtensionStore store;
  final CursorAgentsClient? _client;
  final PackageMeta _packageMeta;
  final Duration _pollInterval;

  NyxxGateway? _clientDiscord;
  Timer? _pollTimer;
  bool _polling = false;

  CursorAgentsClient? get cursorClient {
    final existing = _client;
    if (existing != null) return existing;
    final key = services.config.cursorApiKey;
    if (key == null || key.isEmpty) return null;
    return CursorAgentsClient(apiKey: key);
  }

  void attachClient(NyxxGateway client) {
    _clientDiscord = client;
  }

  void detachClient() {
    _clientDiscord = null;
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  /// Boot / reconnect: detect shipped versions, resume polling.
  Future<void> recover() async {
    await checkShipped();
    _schedulePoll(immediate: true);
  }

  /// Starts a new self-extension (plan phase). Throws/returns error via result.
  Future<SelfExtensionStartResult> start({
    required String createdBy,
    required String channelId,
    required String description,
    String? title,
  }) async {
    if (!services.config.cursorConfigured) {
      return SelfExtensionStartResult.error(
        'Cursor Cloud Agents are not configured '
        '(set CURSOR_API_KEY).',
      );
    }
    final open = store.openExtension();
    if (open != null) {
      return SelfExtensionStartResult.error(
        'A self-extension is already in progress '
        '(#${open.id}, status=${open.status}). '
        'Cancel it or wait until it finishes.',
      );
    }

    final row = store.create(
      createdBy: createdBy,
      channelId: channelId,
      description: description,
      title: title,
    );

    unawaited(_beginPlanning(row.id));
    return SelfExtensionStartResult.ok(row);
  }

  Future<void> _beginPlanning(int id) async {
    final ext = store.byId(id);
    if (ext == null) return;
    final client = cursorClient;
    if (client == null) {
      await _fail(id, 'Cursor client unavailable');
      return;
    }

    try {
      await _post(
        ext.channelId,
        'Starting Cursor plan for self-extension **#${ext.id}** — '
        'I\'ll post the plan here for your OK.',
      );
      final created = await client.createAgent(
        promptText: buildPlanPrompt(
          description: ext.description,
          title: ext.title,
        ),
        repoUrl: services.config.cursorRepoUrl,
        startingRef: services.config.cursorStartingRef,
        autoCreatePr: true,
        mode: 'plan',
        name: ext.title ?? 'egon-extend-${ext.id}',
        modelId: services.config.cursorModel,
      );
      store.update(
        id: id,
        status: SelfExtensionStatus.planning,
        cursorAgentId: created.agent.id,
        cursorRunId: created.run.id,
        clearError: true,
      );
      _schedulePoll(immediate: true);
    } catch (error, stackTrace) {
      stderr.writeln(
          'Self-extension #$id plan start failed: $error\n$stackTrace');
      await _fail(id, '$error');
    }
  }

  /// Owner approved the plan — kick off implement run.
  Future<void> approvePlan(int extensionId) async {
    final ext = store.byId(extensionId);
    if (ext == null || ext.status != SelfExtensionStatus.awaitingPlanApproval) {
      return;
    }
    final client = cursorClient;
    final agentId = ext.cursorAgentId;
    if (client == null || agentId == null) {
      await _fail(extensionId, 'Cursor agent missing for execute');
      return;
    }

    final target = nextDeploymentVersion(meta: _packageMeta);
    final planText = ext.planMarkdown ?? ext.description;

    try {
      store.update(
        id: extensionId,
        status: SelfExtensionStatus.implementing,
        targetVersion: target,
        clearError: true,
        clearApprovalId: true,
      );
      await _post(
        ext.channelId,
        'Plan approved for **#${extensionId}**. Cursor is implementing '
        '(will bump `deployment.json` to `$target` and open a PR).',
      );
      final run = await client.createRun(
        agentId: agentId,
        promptText: buildExecutePrompt(
          approvedPlan: planText,
          targetVersion: target,
        ),
        mode: 'agent',
      );
      store.update(id: extensionId, cursorRunId: run.id);
      _schedulePoll(immediate: true);
    } catch (error, stackTrace) {
      stderr.writeln(
        'Self-extension #$extensionId execute failed: $error\n$stackTrace',
      );
      await _fail(extensionId, '$error');
    }
  }

  /// Owner rejected the plan.
  Future<void> rejectPlan(int extensionId) async {
    final ext = store.byId(extensionId);
    if (ext == null || !ext.isOpen) return;
    await _cancelCursor(ext);
    store.update(
      id: extensionId,
      status: SelfExtensionStatus.cancelled,
      clearApprovalId: true,
    );
    await _post(
      ext.channelId,
      'Self-extension **#${extensionId}** cancelled — plan rejected.',
    );
  }

  /// Owner sent revision notes while awaiting plan approval.
  Future<void> requestPlanRevision({
    required int extensionId,
    required String notes,
  }) async {
    final ext = store.byId(extensionId);
    if (ext == null || ext.status != SelfExtensionStatus.awaitingPlanApproval) {
      return;
    }
    final client = cursorClient;
    final agentId = ext.cursorAgentId;
    if (client == null || agentId == null) {
      await _fail(extensionId, 'Cursor agent missing for revision');
      return;
    }

    // Expire the pending plan approval so old buttons stop mattering.
    if (ext.approvalId != null) {
      services.approvals.expireById(ext.approvalId!);
    }

    try {
      store.update(
        id: extensionId,
        status: SelfExtensionStatus.revisingPlan,
        revisionNotes: notes,
        clearApprovalId: true,
        clearError: true,
      );
      await _post(
        ext.channelId,
        'Got it — revising the plan for **#${extensionId}** with your notes.',
      );
      final run = await client.createRun(
        agentId: agentId,
        promptText: buildRevisePlanPrompt(
          revisionNotes: notes,
          previousPlan: ext.planMarkdown ?? '',
        ),
        mode: 'plan',
      );
      store.update(id: extensionId, cursorRunId: run.id);
      _schedulePoll(immediate: true);
    } catch (error, stackTrace) {
      stderr.writeln(
        'Self-extension #$extensionId revise failed: $error\n$stackTrace',
      );
      await _fail(extensionId, '$error');
    }
  }

  /// Cancel an open self-extension (tool / busy intent).
  Future<bool> requestCancel(int extensionId) async {
    final ext = store.byId(extensionId);
    if (ext == null || !ext.isOpen) return false;
    await _cancelCursor(ext);
    if (ext.approvalId != null) {
      services.approvals.expireById(ext.approvalId!);
    }
    store.update(
      id: extensionId,
      status: SelfExtensionStatus.cancelled,
      clearApprovalId: true,
    );
    await _post(
      ext.channelId,
      'Self-extension **#${extensionId}** cancelled.',
    );
    return true;
  }

  /// Mark awaiting_merge rows done when deployment version matches.
  Future<void> checkShipped() async {
    final current = _packageMeta.deploymentVersion();
    if (current == null) return;
    for (final ext in store.listOpen()) {
      if (ext.status != SelfExtensionStatus.awaitingMerge) continue;
      if (ext.targetVersion == null || ext.targetVersion != current) continue;
      store.update(id: ext.id, status: SelfExtensionStatus.done);
      await _post(
        ext.channelId,
        'Back online — self-extension **#${ext.id}** is live at `v$current`.',
      );
    }
  }

  void _schedulePoll({bool immediate = false}) {
    _pollTimer?.cancel();
    if (immediate) {
      unawaited(_pollOnce());
      return;
    }
    _pollTimer = Timer(_pollInterval, () => unawaited(_pollOnce()));
  }

  Future<void> _pollOnce() async {
    if (_polling) return;
    _polling = true;
    try {
      await checkShipped();
      final open = store.listOpen();
      var needsMore = false;
      for (final ext in open) {
        final kept = await _pollExtension(ext);
        if (kept) needsMore = true;
      }
      if (needsMore) {
        _pollTimer?.cancel();
        _pollTimer = Timer(_pollInterval, () => unawaited(_pollOnce()));
      }
    } finally {
      _polling = false;
    }
  }

  /// Returns true if this extension still needs polling.
  Future<bool> _pollExtension(SelfExtension ext) async {
    if (ext.status == SelfExtensionStatus.awaitingPlanApproval) {
      return false;
    }
    if (ext.status == SelfExtensionStatus.awaitingMerge) {
      return true; // wait for deploy version match
    }

    final client = cursorClient;
    final agentId = ext.cursorAgentId;
    final runId = ext.cursorRunId;
    if (client == null || agentId == null || runId == null) {
      return false;
    }

    try {
      final run = await client.getRun(agentId: agentId, runId: runId);
      if (!run.isTerminal) return true;

      if (run.status == CursorRunStatus.error ||
          run.status == CursorRunStatus.expired) {
        await _fail(
          ext.id,
          run.result?.trim().isNotEmpty == true
              ? run.result!.trim()
              : 'Cursor run ${run.status}',
        );
        return false;
      }
      if (run.status == CursorRunStatus.cancelled) {
        store.update(id: ext.id, status: SelfExtensionStatus.cancelled);
        await _post(
          ext.channelId,
          'Self-extension **#${ext.id}** Cursor run was cancelled.',
        );
        return false;
      }

      // FINISHED
      if (ext.status == SelfExtensionStatus.planning ||
          ext.status == SelfExtensionStatus.revisingPlan) {
        await _onPlanFinished(ext, run);
        return false;
      }
      if (ext.status == SelfExtensionStatus.implementing) {
        await _onImplementFinished(ext, run);
        return true; // await merge
      }
    } catch (error, stackTrace) {
      stderr.writeln(
        'Self-extension #${ext.id} poll failed: $error\n$stackTrace',
      );
      // Transient — keep polling with backoff hint via same interval.
      return true;
    }
    return false;
  }

  Future<void> _onPlanFinished(SelfExtension ext, CursorRun run) async {
    final raw = run.result?.trim() ?? '';
    if (raw.isEmpty) {
      await _fail(ext.id, 'Cursor returned an empty plan');
      return;
    }
    final parsed = parseExtensionPlan(raw);
    final display = _formatPlanForDiscord(ext.id, parsed);

    store.update(
      id: ext.id,
      status: SelfExtensionStatus.awaitingPlanApproval,
      planMarkdown: parsed.markdown,
      planJson: encodePlanJson(parsed.toJson()),
      clearError: true,
    );

    final approvalId =
        await services.approvals.requestSelfExtensionPlanApproval(
      channelId: ext.channelId,
      requestedBy: ext.createdBy,
      extensionId: ext.id,
      preview: display,
    );
    store.update(id: ext.id, approvalId: approvalId);
  }

  Future<void> _onImplementFinished(SelfExtension ext, CursorRun run) async {
    final prUrl = run.firstPrUrl;
    store.update(
      id: ext.id,
      status: SelfExtensionStatus.awaitingMerge,
      prUrl: prUrl,
      clearError: true,
    );
    final version = ext.targetVersion ?? '(unknown)';
    final link = prUrl ?? '(no PR URL in Cursor result — check Cursor agent)';
    await _post(
      ext.channelId,
      'Implementation finished for **#${ext.id}**.\n'
      'Target version: `$version`\n'
      'PR: $link\n'
      'Merge on GitHub when you\'re happy — deploy triggers from '
      '`deployment.json` on `master`.',
    );
  }

  Future<void> _fail(int id, String error) async {
    final ext = store.byId(id);
    store.update(
      id: id,
      status: SelfExtensionStatus.failed,
      error: error,
      clearApprovalId: true,
    );
    if (ext != null) {
      await _post(
        ext.channelId,
        'Self-extension **#$id** failed: $error',
      );
    }
  }

  Future<void> _cancelCursor(SelfExtension ext) async {
    final client = cursorClient;
    final agentId = ext.cursorAgentId;
    final runId = ext.cursorRunId;
    if (client == null || agentId == null) return;
    try {
      if (runId != null) {
        await client.cancelRun(agentId: agentId, runId: runId);
      }
    } catch (error) {
      stderr.writeln('Cancel Cursor run failed for #${ext.id}: $error');
    }
    try {
      await client.archiveAgent(agentId);
    } catch (error) {
      stderr.writeln('Archive Cursor agent failed for #${ext.id}: $error');
    }
  }

  String _formatPlanForDiscord(int id, ParsedExtensionPlan plan) {
    final buf = StringBuffer('Self-extension **#$id** plan\n');
    if (plan.summary.isNotEmpty) {
      buf.writeln('**Summary:** ${plan.summary}');
    }
    if (plan.files.isNotEmpty) {
      buf.writeln('**Files:** ${plan.files.join(', ')}');
    }
    if (plan.risks.isNotEmpty) {
      buf.writeln('**Risks:** ${plan.risks.join('; ')}');
    }
    if (plan.testPlan.isNotEmpty) {
      buf.writeln('**Tests:** ${plan.testPlan.join('; ')}');
    }
    buf.writeln();
    buf.writeln(plan.markdown);
    buf.writeln();
    buf.writeln(
      '_Approve / Reject below. Or reply in this channel with change '
      'requests to revise the plan._',
    );
    return buf.toString();
  }

  Future<void> _post(String channelId, String text) async {
    final client = _clientDiscord;
    if (client == null) return;
    try {
      final channel =
          client.channels[Snowflake.parse(channelId)] as PartialTextChannel;
      await sendLongMessage(channel, text);
    } catch (error) {
      stderr.writeln('Self-extension post failed in $channelId: $error');
    }
  }
}

class SelfExtensionStartResult {
  SelfExtensionStartResult._({this.extension, this.error});

  factory SelfExtensionStartResult.ok(SelfExtension extension) =>
      SelfExtensionStartResult._(extension: extension);

  factory SelfExtensionStartResult.error(String message) =>
      SelfExtensionStartResult._(error: message);

  final SelfExtension? extension;
  final String? error;

  bool get isOk => extension != null;
}
