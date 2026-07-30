import 'dart:io';

import 'package:dotenv/dotenv.dart';
import 'package:egon_bot/src/agent/agent.dart';
import 'package:egon_bot/src/agent/approval_service.dart';
import 'package:egon_bot/src/agent/context_builder.dart';
import 'package:egon_bot/src/config.dart';
import 'package:egon_bot/src/discord/message_router.dart';
import 'package:egon_bot/src/integrations/windows_monitor_client.dart';
import 'package:egon_bot/src/llm/llm_gate.dart';
import 'package:egon_bot/src/llm/ollama_client.dart';
import 'package:egon_bot/src/memory/memory_service.dart';
import 'package:egon_bot/src/security/whitelist_service.dart';
import 'package:egon_bot/src/services.dart';
import 'package:egon_bot/src/storage/database.dart';
import 'package:egon_bot/src/time/timestamps.dart';
import 'package:egon_bot/src/tools/builtin_tools.dart';
import 'package:egon_bot/src/tools/tool_registry.dart';
import 'package:egon_bot/src/web/fetch_api.dart';
import 'package:egon_bot/src/web/search_api.dart';
import 'package:nyxx/nyxx.dart';

const reconnectDelay = Duration(minutes: 5);

Future<void> main() async {
  final env = DotEnv(includePlatformEnvironment: true);
  if (File('.env').existsSync()) {
    env.load();
  } else {
    stdout.writeln('No .env file found, using process environment variables.');
  }

  final Config config;
  try {
    config = Config.fromEnv((key) => env[key]);
  } on ConfigError catch (error) {
    stderr.writeln('$error Provide it via environment variables or .env.');
    exitCode = 64;
    return;
  }
  stdout.writeln('Starting with $config');

  final database = AppDatabase.open(config.dataDir);
  final ollama = OllamaClient(
    baseUrl: config.ollamaBaseUrl,
    model: config.ollamaModel,
  );
  final monitor = config.windowsMonitorBaseUrl == null
      ? null
      : WindowsMonitorClient(baseUrl: config.windowsMonitorBaseUrl!);
  if (monitor == null) {
    stdout.writeln(
      'WINDOWS_MONITOR_API_BASE_URL not set — GPU gating disabled.',
    );
  }

  final gate = LlmGate(
    ollama: ollama,
    monitor: monitor,
    utilityModel: config.ollamaUtilityModel,
    busyThresholdPercent: config.gpuBusyThresholdPercent,
    pollInterval: config.gpuPollInterval,
  )..start();

  final services = Services(
    config: config,
    database: database,
    whitelist: WhitelistService(
      database: database,
      ownerUserId: config.ownerUserId,
    ),
    llmGate: gate,
    timestamps: Timestamps(config.botTimezone),
    searchApi: SearchApi(),
    fetchApi: FetchApi(),
    memory: MemoryService(database),
  );
  services.registry = ToolRegistry(
    tools: buildBuiltinTools(),
    services: services,
  );
  services.approvals = ApprovalService(
    database: database,
    config: config,
    services: () => services,
  );

  final history = ChannelHistoryStore(database);
  final agent = Agent(services: services, history: history);
  final router = MessageRouter(
    services: services,
    agent: agent,
    history: history,
  );

  await _runBotSupervisor(config: config, router: router);
}

/// Keeps the bot connected forever. If the gateway connection drops or the
/// event loop throws, we reconnect: first retry after 60s, subsequent
/// retries every [reconnectDelay].
Future<void> _runBotSupervisor({
  required Config config,
  required MessageRouter router,
}) async {
  var allowEarlyRetry = false;

  while (true) {
    try {
      final client = await Nyxx.connectGateway(
        config.discordBotToken,
        // messageContent is privileged and enabled in the developer portal;
        // it delivers the content of guild messages that don't mention us,
        // which the conversation context needs.
        GatewayIntents.allUnprivileged | GatewayIntents.messageContent,
        options: GatewayClientOptions(plugins: [logging, cliIntegration]),
      );
      stdout.writeln('Discord bot connected as user ${client.user.id}.');

      // If this connection dies later, first retry should be a bit earlier.
      allowEarlyRetry = true;

      await router.run(client);

      stderr.writeln('Discord event stream ended unexpectedly.');
    } catch (error, stackTrace) {
      stderr.writeln('Discord connection loop failed: $error');
      stderr.writeln(stackTrace);
    }

    if (allowEarlyRetry) {
      stderr.writeln('Trying early reconnect in 60s...');
      allowEarlyRetry = false;
      await Future<void>.delayed(const Duration(seconds: 60));
      continue;
    }

    stderr.writeln(
      'Reconnect failed again. Retrying in ${reconnectDelay.inMinutes} '
      'minutes...',
    );
    await Future<void>.delayed(reconnectDelay);
    allowEarlyRetry = true;
  }
}
