import 'package:egon_bot/src/agent/approval_service.dart';
import 'package:egon_bot/src/agent/context_builder.dart';
import 'package:egon_bot/src/agent/agent.dart';
import 'package:egon_bot/src/config.dart';
import 'dart:io';

import 'package:egon_bot/src/contacts/contacts_service.dart';
import 'package:egon_bot/src/discord/discord_search_api.dart';
import 'package:egon_bot/src/integrations/cursor_agents_client.dart';
import 'package:egon_bot/src/integrations/google_calendar_client.dart';
import 'package:egon_bot/src/integrations/obsidian_vault.dart';
import 'package:egon_bot/src/integrations/windows_monitor_client.dart';
import 'package:egon_bot/src/jobs/job_models.dart';
import 'package:egon_bot/src/jobs/job_runner.dart';
import 'package:egon_bot/src/jobs/job_store.dart';
import 'package:egon_bot/src/jobs/planner.dart';
import 'package:egon_bot/src/self_extension/self_extension_runner.dart';
import 'package:egon_bot/src/self_extension/self_extension_store.dart';
import 'package:egon_bot/src/llm/llm_gate.dart';
import 'package:egon_bot/src/llm/ollama_client.dart';
import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:egon_bot/src/media/attachments.dart';
import 'package:egon_bot/src/media/transcription.dart';
import 'package:egon_bot/src/memory/memory_service.dart';
import 'package:egon_bot/src/notices/notice_service.dart';
import 'package:egon_bot/src/scheduler/scheduler.dart';
import 'package:egon_bot/src/scheduler/task_store.dart';
import 'package:egon_bot/src/security/whitelist_service.dart';
import 'package:egon_bot/src/services.dart';
import 'package:egon_bot/src/storage/database.dart';
import 'package:egon_bot/src/time/timestamps.dart';
import 'package:egon_bot/src/tools/tool.dart';
import 'package:egon_bot/src/tools/tool_registry.dart';
import 'package:egon_bot/src/web/browser_api.dart';
import 'package:egon_bot/src/web/fetch_api.dart';
import 'package:egon_bot/src/web/http_request_api.dart';
import 'package:egon_bot/src/web/image_search_api.dart';
import 'package:egon_bot/src/web/search_api.dart';

const ownerId = '1000';
const strangerId = '2000';

class FakeOllama extends OllamaClient {
  FakeOllama({this.onChat})
      : super(baseUrl: Uri.parse('http://localhost:1'), model: 'big-model');

  Future<OllamaChatMessage> Function(
    List<OllamaChatMessage> messages,
    List<OllamaTool> tools,
    String? modelOverride,
    Object? format,
  )? onChat;

  int chatCalls = 0;
  final List<String?> modelOverrides = [];
  final List<Object?> thinkValues = [];

  @override
  Future<OllamaChatMessage> chatCompletion({
    required List<OllamaChatMessage> messages,
    List<OllamaTool> tools = const [],
    String? modelOverride,
    Map<String, Object?>? options,
    Object? format,
    Object? think = 'high',
  }) async {
    chatCalls++;
    modelOverrides.add(modelOverride);
    thinkValues.add(think);
    final handler = onChat;
    if (handler == null) {
      return OllamaChatMessage(role: 'assistant', content: 'ok');
    }
    return handler(messages, tools, modelOverride, format);
  }

  @override
  Future<List<String>> loadedModels() async => const [];

  @override
  Future<void> requestUnload(String modelName) async {}
}

class FakeMonitor extends WindowsMonitorClient {
  FakeMonitor() : super(baseUrl: Uri.parse('http://localhost:1'));

  bool userActive = false;
  double gpuAvg5m = 0;
  bool unreachable = false;

  @override
  Future<bool> isUserActive() async {
    if (unreachable) throw Exception('monitor down');
    return userActive;
  }

  @override
  Future<Map<String, Object?>> getResourceUsage() async {
    if (unreachable) throw Exception('monitor down');
    return {
      'gpuUsagePercent': {'avg5m': gpuAvg5m},
    };
  }
}

Config testConfig({String? vaultDir}) {
  final dataDir = Directory.systemTemp.createTempSync('egon-test-').path;
  return Config(
    discordBotToken: 'token',
    ownerUserId: ownerId,
    allowedChannelIds: const {'42'},
    ollamaBaseUrl: Uri.parse('http://localhost:1'),
    ollamaModel: 'big-model',
    ollamaUtilityModel: 'small-model',
    ollamaVisionModel: null,
    browserApiBaseUrl: null,
    browserUserAgent: BrowserApi.defaultUserAgent,
    windowsMonitorBaseUrl: null,
    gpuBusyThresholdPercent: 40,
    gpuPollInterval: const Duration(milliseconds: 30),
    dataDir: dataDir,
    botTimezone: 'Europe/Berlin',
    obsidianEmail: null,
    obsidianPassword: null,
    obsidianVaultName: null,
    obsidianE2eePassword: null,
    obsidianVaultDir: vaultDir ?? '$dataDir/vault',
    whisperModel: 'tiny',
    maxAttachmentMb: 1,
    googleCalendarId: null,
    cursorApiKey: null,
    cursorRepoUrl: 'https://github.com/mbuelowdev/egon-bot',
    cursorStartingRef: 'master',
    cursorModel: null,
  );
}

LlmGate testGate({
  required FakeOllama ollama,
  FakeMonitor? monitor,
  String? utilityModel = 'small-model',
  String? visionModel,
  Duration? interactiveTtl,
  int queueCap = 20,
  Duration monitorDownNotifyAfter = const Duration(minutes: 15),
  void Function(String message)? onMonitorDownNotice,
  DateTime Function()? clock,
}) =>
    LlmGate(
      ollama: ollama,
      monitor: monitor,
      utilityModel: utilityModel,
      visionModel: visionModel,
      busyThresholdPercent: 40,
      pollInterval: const Duration(milliseconds: 30),
      interactiveTtl: interactiveTtl ?? const Duration(hours: 6),
      queueCap: queueCap,
      monitorDownNotifyAfter: monitorDownNotifyAfter,
      onMonitorDownNotice: onMonitorDownNotice,
      clock: clock,
    );

/// Builds a fully wired [Services] with an in-memory database.
Services testServices({
  required List<Tool> tools,
  FakeOllama? ollama,
  FakeMonitor? monitor,
  Duration approvalTtl = const Duration(hours: 24),
  DateTime Function()? clock,
  JobPlanner? planner,
  FetchApi? fetchApi,
  BrowserApi? browserApi,
  HttpRequestApi? httpRequest,
  DiscordSearchApi? discordSearch,
  ImageSearchApi? imageSearchApi,
  DateTime? startedAt,
  String? utilityModel = 'small-model',
  CursorAgentsClient? cursorAgents,
  Config? configOverride,
}) {
  final config = configOverride ?? testConfig();
  final vaultRoot = Directory(config.obsidianVaultDir)
    ..createSync(recursive: true);
  final database = AppDatabase.inMemory();
  final fakeOllama = ollama ?? FakeOllama();
  final vault = ObsidianVault(root: vaultRoot.path, available: true);
  final attachments = AttachmentStore(database: database, config: config);
  final timestamps = Timestamps(config.botTimezone);
  final services = Services(
    config: config,
    database: database,
    whitelist: WhitelistService(
      database: database,
      ownerUserId: config.ownerUserId,
    ),
    llmGate: testGate(
      ollama: fakeOllama,
      monitor: monitor,
      utilityModel: utilityModel,
    ),
    timestamps: timestamps,
    searchApi: SearchApi(),
    imageSearchApi: imageSearchApi ?? ImageSearchApi(),
    discordSearch: discordSearch ?? DiscordSearchApi(),
    fetchApi: fetchApi ?? FetchApi(),
    browserApi: browserApi ?? BrowserApi(userAgent: config.browserUserAgent),
    httpRequest: httpRequest ?? HttpRequestApi(),
    memory: MemoryService(database),
    tasks: TaskStore(database),
    jobs: JobStore(database),
    selfExtensions: SelfExtensionStore(database),
    notices: NoticeService(database: database, config: config),
    vault: vault,
    attachments: attachments,
    transcription: TranscriptionService(config: config),
    contacts: ContactsService(
      database: database,
      attachments: attachments,
      vault: vault,
    ),
    calendar: GoogleCalendarClient.forTesting(
      config: config,
      timestamps: timestamps,
    ),
    cursorAgents: cursorAgents,
    startedAt: startedAt,
  );
  services.registry = ToolRegistry(tools: tools, services: services);
  services.approvals = ApprovalService(
    database: database,
    config: config,
    services: () => services,
    ttl: approvalTtl,
  );
  final history = ChannelHistoryStore(database);
  final agent = Agent(services: services, history: history);
  services.scheduler = Scheduler(
    services: services,
    agent: agent,
    history: history,
    store: services.tasks,
    clock: clock,
  );
  services.jobRunner = JobRunner(
    services: services,
    store: services.jobs,
    history: history,
    planner: planner ?? JobPlanner(services.llmGate),
  );
  services.selfExtensionRunner = SelfExtensionRunner(
    services: services,
    store: services.selfExtensions,
    client: cursorAgents,
  );
  return services;
}

/// Planner that returns a fixed plan without calling the model.
class FixedPlanner extends JobPlanner {
  FixedPlanner(this._title, this._descriptions) : super(_unusedGate());

  final String _title;
  final List<String> _descriptions;

  static LlmGate _unusedGate() => testGate(ollama: FakeOllama());

  @override
  Future<PlannedJob> plan(String instructions) async => PlannedJob(
        title: _title,
        steps: [
          for (var i = 0; i < _descriptions.length; i++)
            JobStep(index: i + 1, description: _descriptions[i]),
        ],
      );
}

ToolContext contextFor(
  Services services, {
  required bool owner,
  bool isDm = false,
}) =>
    ToolContext(
      channelId: '42',
      userId: owner ? ownerId : strangerId,
      isOwner: owner,
      isDm: isDm,
      services: services,
    );

class StubTool extends Tool {
  StubTool({
    this.toolAccess = ToolAccess.standard,
    this.preview,
  });

  final ToolAccess toolAccess;
  final String? preview;
  int executions = 0;

  @override
  String get name => 'stub_tool';

  @override
  String get description => 'Test stub.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': <String, Object?>{},
      };

  @override
  ToolAccess get access => toolAccess;

  @override
  Future<String?> previewChange(
    ToolContext context,
    Map<String, Object?> args,
  ) async =>
      preview;

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    executions++;
    return ToolResult.ok({'ran': true});
  }
}
