import 'package:egon_bot/src/agent/approval_service.dart';
import 'package:egon_bot/src/config.dart';
import 'package:egon_bot/src/integrations/windows_monitor_client.dart';
import 'package:egon_bot/src/llm/llm_gate.dart';
import 'package:egon_bot/src/llm/ollama_client.dart';
import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:egon_bot/src/memory/memory_service.dart';
import 'package:egon_bot/src/security/whitelist_service.dart';
import 'package:egon_bot/src/services.dart';
import 'package:egon_bot/src/storage/database.dart';
import 'package:egon_bot/src/time/timestamps.dart';
import 'package:egon_bot/src/tools/tool.dart';
import 'package:egon_bot/src/tools/tool_registry.dart';
import 'package:egon_bot/src/web/fetch_api.dart';
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
  )? onChat;

  int chatCalls = 0;
  final List<String?> modelOverrides = [];

  @override
  Future<OllamaChatMessage> chatCompletion({
    required List<OllamaChatMessage> messages,
    List<OllamaTool> tools = const [],
    String? modelOverride,
    Map<String, Object?>? options,
  }) async {
    chatCalls++;
    modelOverrides.add(modelOverride);
    final handler = onChat;
    if (handler == null) {
      return OllamaChatMessage(role: 'assistant', content: 'ok');
    }
    return handler(messages, tools, modelOverride);
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

Config testConfig() => Config(
      discordBotToken: 'token',
      ownerUserId: ownerId,
      allowedChannelIds: const {'42'},
      ollamaBaseUrl: Uri.parse('http://localhost:1'),
      ollamaModel: 'big-model',
      ollamaUtilityModel: 'small-model',
      windowsMonitorBaseUrl: null,
      gpuBusyThresholdPercent: 40,
      gpuPollInterval: const Duration(milliseconds: 30),
      dataDir: '/tmp/egon-test',
      botTimezone: 'Europe/Berlin',
    );

LlmGate testGate({
  required FakeOllama ollama,
  FakeMonitor? monitor,
  String? utilityModel = 'small-model',
  Duration? interactiveTtl,
  int queueCap = 20,
}) =>
    LlmGate(
      ollama: ollama,
      monitor: monitor,
      utilityModel: utilityModel,
      busyThresholdPercent: 40,
      pollInterval: const Duration(milliseconds: 30),
      interactiveTtl: interactiveTtl ?? const Duration(hours: 6),
      queueCap: queueCap,
    );

/// Builds a fully wired [Services] with an in-memory database.
Services testServices({
  required List<Tool> tools,
  FakeOllama? ollama,
  FakeMonitor? monitor,
  Duration approvalTtl = const Duration(hours: 24),
}) {
  final config = testConfig();
  final database = AppDatabase.inMemory();
  final fakeOllama = ollama ?? FakeOllama();
  final services = Services(
    config: config,
    database: database,
    whitelist: WhitelistService(
      database: database,
      ownerUserId: config.ownerUserId,
    ),
    llmGate: testGate(ollama: fakeOllama, monitor: monitor),
    timestamps: Timestamps(config.botTimezone),
    searchApi: SearchApi(),
    fetchApi: FetchApi(),
    memory: MemoryService(database),
  );
  services.registry = ToolRegistry(tools: tools, services: services);
  services.approvals = ApprovalService(
    database: database,
    config: config,
    services: () => services,
    ttl: approvalTtl,
  );
  return services;
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
