import 'package:egon_bot/src/config.dart';
import 'package:egon_bot/src/integrations/cursor_agents_client.dart';
import 'package:egon_bot/src/self_extension/plan_parser.dart';
import 'package:egon_bot/src/self_extension/self_extension_models.dart';
import 'package:egon_bot/src/self_extension/version_bump.dart';
import 'package:test/test.dart';

import 'helpers.dart';

Config _cursorConfig() {
  final keyed = testConfig();
  return Config(
    discordBotToken: keyed.discordBotToken,
    ownerUserId: keyed.ownerUserId,
    allowedChannelIds: keyed.allowedChannelIds,
    ollamaBaseUrl: keyed.ollamaBaseUrl,
    ollamaModel: keyed.ollamaModel,
    ollamaUtilityModel: keyed.ollamaUtilityModel,
    ollamaVisionModel: keyed.ollamaVisionModel,
    browserApiBaseUrl: keyed.browserApiBaseUrl,
    browserUserAgent: keyed.browserUserAgent,
    windowsMonitorBaseUrl: keyed.windowsMonitorBaseUrl,
    gpuBusyThresholdPercent: keyed.gpuBusyThresholdPercent,
    gpuPollInterval: keyed.gpuPollInterval,
    dataDir: keyed.dataDir,
    botTimezone: keyed.botTimezone,
    obsidianEmail: null,
    obsidianPassword: null,
    obsidianVaultName: null,
    obsidianE2eePassword: null,
    obsidianVaultDir: keyed.obsidianVaultDir,
    whisperModel: keyed.whisperModel,
    maxAttachmentMb: keyed.maxAttachmentMb,
    googleCalendarId: null,
    cursorApiKey: 'test-key',
    cursorRepoUrl: keyed.cursorRepoUrl,
    cursorStartingRef: keyed.cursorStartingRef,
    cursorModel: null,
  );
}

class FakeCursorClient extends CursorAgentsClient {
  FakeCursorClient() : super(apiKey: 'test-key');

  final List<String> createPrompts = [];
  final List<String> runPrompts = [];
  String agentId = 'bc-test-agent';
  String runId = 'run-1';
  CursorRunStatusOverride? nextRun;
  final Map<String, CursorRun> runs = {};

  @override
  Future<CursorAgentCreateResult> createAgent({
    required String promptText,
    required String repoUrl,
    required String startingRef,
    bool autoCreatePr = false,
    String mode = 'agent',
    String? name,
    String? modelId,
  }) async {
    nextRun = null;
    createPrompts.add(promptText);
    final run = CursorRun(
      id: runId,
      agentId: agentId,
      status: CursorRunStatus.creating,
    );
    runs[run.id] = run;
    return CursorAgentCreateResult(
      agent: CursorAgent(
        id: agentId,
        status: 'ACTIVE',
        latestRunId: run.id,
        autoCreatePr: autoCreatePr,
      ),
      run: run,
    );
  }

  @override
  Future<CursorRun> createRun({
    required String agentId,
    required String promptText,
    String? mode,
  }) async {
    nextRun = null;
    runPrompts.add(promptText);
    runId = 'run-${runPrompts.length + 1}';
    final run = CursorRun(
      id: runId,
      agentId: agentId,
      status: CursorRunStatus.running,
    );
    runs[run.id] = run;
    return run;
  }

  @override
  Future<CursorRun> getRun({
    required String agentId,
    required String runId,
  }) async {
    final override = nextRun;
    if (override != null) {
      final run = CursorRun(
        id: runId,
        agentId: agentId,
        status: override.status,
        result: override.result,
        git: override.git,
      );
      runs[runId] = run;
      return run;
    }
    return runs[runId] ??
        CursorRun(
          id: runId,
          agentId: agentId,
          status: CursorRunStatus.running,
        );
  }

  @override
  Future<void> cancelRun({
    required String agentId,
    required String runId,
  }) async {}

  @override
  Future<void> archiveAgent(String agentId) async {}
}

class CursorRunStatusOverride {
  CursorRunStatusOverride({
    required this.status,
    this.result,
    this.git,
  });

  final String status;
  final String? result;
  final CursorRunGit? git;
}

void main() {
  group('parseExtensionPlan', () {
    test('parses frontmatter lists and body', () {
      const raw = '''
---
summary: Add dice roller
files: [lib/src/tools/builtin/dice_tool.dart, test/dice_test.dart]
risks: [naming collision]
test_plan: [unit test roll range]
---
# Plan
Implement DiceTool.
''';
      final plan = parseExtensionPlan(raw);
      expect(plan.summary, 'Add dice roller');
      expect(plan.files, contains('lib/src/tools/builtin/dice_tool.dart'));
      expect(plan.risks, ['naming collision']);
      expect(plan.testPlan, ['unit test roll range']);
      expect(plan.markdown, contains('Implement DiceTool'));
    });

    test('falls back without frontmatter', () {
      final plan = parseExtensionPlan('Just a free-form plan body.');
      expect(plan.summary, 'Just a free-form plan body.');
      expect(plan.markdown, contains('free-form'));
    });
  });

  group('bumpPatch', () {
    test('increments patch', () {
      expect(bumpPatch('0.14.0'), '0.14.1');
      expect(bumpPatch('1.0.9'), '1.0.10');
    });
  });

  group('SelfExtensionRunner', () {
    test('rejects when Cursor is not configured', () async {
      final services = testServices(tools: []);
      final result = await services.selfExtensionRunner.start(
        createdBy: ownerId,
        channelId: '42',
        description: 'build something',
      );
      expect(result.isOk, isFalse);
      expect(result.error, contains('CURSOR_API_KEY'));
    });

    test('plan → await approval → approve → implement → merge → done',
        () async {
      final cursor = FakeCursorClient();
      final services = testServices(
        tools: [],
        cursorAgents: cursor,
        configOverride: _cursorConfig(),
      );

      final started = await services.selfExtensionRunner.start(
        createdBy: ownerId,
        channelId: '42',
        description: 'Add a healthcheck tool',
        title: 'healthcheck',
      );
      expect(started.isOk, isTrue);
      final id = started.extension!.id;

      // Wait for async _beginPlanning
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(cursor.createPrompts, isNotEmpty);
      expect(
        services.selfExtensions.byId(id)!.cursorAgentId,
        'bc-test-agent',
      );

      // Finish plan run
      cursor.nextRun = CursorRunStatusOverride(
        status: CursorRunStatus.finished,
        result: '''
---
summary: Healthcheck tool
files: [lib/src/tools/builtin/healthcheck_tool.dart]
risks: []
test_plan: [analyze]
---
# Plan
Add HealthcheckTool.
''',
      );
      await services.selfExtensionRunner.recover();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      var ext = services.selfExtensions.byId(id)!;
      expect(ext.status, SelfExtensionStatus.awaitingPlanApproval);
      expect(ext.planMarkdown, contains('HealthcheckTool'));
      expect(ext.approvalId, isNotNull);

      // Second start rejected (single-flight)
      final second = await services.selfExtensionRunner.start(
        createdBy: ownerId,
        channelId: '42',
        description: 'another',
      );
      expect(second.isOk, isFalse);

      // Approve via ApprovalService
      await services.approvals.decide(
        id: ext.approvalId!,
        approved: true,
        actorId: ownerId,
      );
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(cursor.runPrompts, isNotEmpty);
      expect(cursor.runPrompts.last, contains('deployment.json'));

      ext = services.selfExtensions.byId(id)!;
      expect(ext.status, SelfExtensionStatus.implementing);
      expect(ext.targetVersion, isNotNull);

      cursor.nextRun = CursorRunStatusOverride(
        status: CursorRunStatus.finished,
        result: 'Done',
        git: CursorRunGit(
          branches: [
            CursorBranch(
              prUrl: 'https://github.com/mbuelowdev/egon-bot/pull/1',
            ),
          ],
        ),
      );
      await services.selfExtensionRunner.recover();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      ext = services.selfExtensions.byId(id)!;
      expect(ext.status, SelfExtensionStatus.awaitingMerge);
      expect(ext.prUrl, contains('pull/1'));

      services.selfExtensions.update(
        id: id,
        targetVersion: '9.9.9',
      );
      await services.selfExtensionRunner.checkShipped();
      expect(
        services.selfExtensions.byId(id)!.status,
        SelfExtensionStatus.awaitingMerge,
      );
    });

    test('reject cancels the extension', () async {
      final cursor = FakeCursorClient();
      final services = testServices(
        tools: [],
        cursorAgents: cursor,
        configOverride: _cursorConfig(),
      );

      final started = await services.selfExtensionRunner.start(
        createdBy: ownerId,
        channelId: '42',
        description: 'thing',
      );
      final id = started.extension!.id;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      cursor.nextRun = CursorRunStatusOverride(
        status: CursorRunStatus.finished,
        result:
            '---\nsummary: x\nfiles: []\nrisks: []\ntest_plan: []\n---\n# Plan\nX\n',
      );
      await services.selfExtensionRunner.recover();
      await Future<void>.delayed(const Duration(milliseconds: 50));
      final approvalId = services.selfExtensions.byId(id)!.approvalId!;
      await services.approvals.decide(
        id: approvalId,
        approved: false,
        actorId: ownerId,
      );
      expect(
        services.selfExtensions.byId(id)!.status,
        SelfExtensionStatus.cancelled,
      );
    });

    test('revision notes move to revising_plan', () async {
      final cursor = FakeCursorClient();
      final services = testServices(
        tools: [],
        cursorAgents: cursor,
        configOverride: _cursorConfig(),
      );
      final started = await services.selfExtensionRunner.start(
        createdBy: ownerId,
        channelId: '42',
        description: 'thing',
      );
      final id = started.extension!.id;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      cursor.nextRun = CursorRunStatusOverride(
        status: CursorRunStatus.finished,
        result:
            '---\nsummary: x\nfiles: []\nrisks: []\ntest_plan: []\n---\n# Plan\nX\n',
      );
      await services.selfExtensionRunner.recover();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      await services.selfExtensionRunner.requestPlanRevision(
        extensionId: id,
        notes: 'Also add a test',
      );
      expect(
        services.selfExtensions.byId(id)!.status,
        SelfExtensionStatus.revisingPlan,
      );
      expect(cursor.runPrompts.last, contains('Also add a test'));
    });
  });

  group('CursorRun.fromJson', () {
    test('parses pr url from git branches', () {
      final run = CursorRun.fromJson({
        'id': 'run-1',
        'agentId': 'bc-1',
        'status': 'FINISHED',
        'result': 'ok',
        'git': {
          'branches': [
            {
              'repoUrl': 'github.com/mbuelowdev/egon-bot',
              'branch': 'cursor/x',
              'prUrl': 'https://github.com/mbuelowdev/egon-bot/pull/9',
            },
          ],
        },
      });
      expect(run.firstPrUrl, contains('pull/9'));
    });
  });
}
