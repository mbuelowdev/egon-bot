import 'dart:io';

import 'package:dotenv/dotenv.dart';
import 'package:egon_bot/src/discord/message_loop.dart';
import 'package:egon_bot/src/integrations/windows_monitor_client.dart';
import 'package:egon_bot/src/llm/ollama_client.dart';
import 'package:nyxx/nyxx.dart';

const reconnectDelay = Duration(minutes: 5);

Future<void> main() async {
  final env = DotEnv(includePlatformEnvironment: true);
  if (File('.env').existsSync()) {
    env.load();
  } else {
    stdout.writeln('No .env file found, using process environment variables.');
  }

  final token = env['DISCORD_BOT_TOKEN'];
  final ollamaBaseUrl = env['OLLAMA_API_BASE_URL'] ?? 'http://127.0.0.1:11434';
  final ollamaModel = env['OLLAMA_MODEL'] ?? 'gpt-oss:20b';
  // CPU-only fallback model used while the GPU is busy (ARCHITECTURE.md §5.1).
  // Set to an empty string to disable the utility tier.
  final rawUtilityModel = env['OLLAMA_UTILITY_MODEL'] ?? 'llama3.2:3b';
  final utilityModel = rawUtilityModel.isEmpty ? null : rawUtilityModel;
  final windowsMonitorBaseUrl = env['WINDOWS_MONITOR_API_BASE_URL'];

  if (token == null || token.isEmpty) {
    stderr.writeln(
      'Missing DISCORD_BOT_TOKEN. Provide it via environment variables or .env.',
    );
    exitCode = 64;
    return;
  }

  final ollama = OllamaClient(
    baseUrl: Uri.parse(ollamaBaseUrl),
    model: ollamaModel,
  );

  // The GPU that Ollama uses is shared with the Windows machine's primary
  // user. When the monitor sidecar is configured, big-model calls only run
  // while the GPU is free. Unset = gating disabled (local development).
  final monitor = windowsMonitorBaseUrl == null || windowsMonitorBaseUrl.isEmpty
      ? null
      : WindowsMonitorClient(baseUrl: Uri.parse(windowsMonitorBaseUrl));
  if (monitor == null) {
    stdout.writeln(
      'WINDOWS_MONITOR_API_BASE_URL not set — GPU gating disabled.',
    );
  }

  await _runBotSupervisor(
    token: token,
    ollama: ollama,
    monitor: monitor,
    utilityModel: utilityModel,
  );
}

/// Keeps the bot connected forever. If the gateway connection drops or the
/// event loop throws, we reconnect: first retry after 60s, subsequent
/// retries every [reconnectDelay].
Future<void> _runBotSupervisor({
  required String token,
  required OllamaClient ollama,
  required WindowsMonitorClient? monitor,
  required String? utilityModel,
}) async {
  var allowEarlyRetry = false;

  while (true) {
    try {
      final client = await Nyxx.connectGateway(
        token,
        // messageContent is privileged and enabled in the developer portal;
        // it delivers the content of guild messages that don't mention us,
        // which the conversation context needs.
        GatewayIntents.allUnprivileged | GatewayIntents.messageContent,
        options: GatewayClientOptions(plugins: [logging, cliIntegration]),
      );
      stdout.writeln('Discord bot connected as user ${client.user.id}.');

      // If this connection dies later, first retry should be a bit earlier.
      allowEarlyRetry = true;

      await runMessageLoop(
        client: client,
        ollama: ollama,
        monitor: monitor,
        utilityModel: utilityModel,
      );

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
      'Reconnect failed again. Retrying in ${reconnectDelay.inMinutes} minutes...',
    );
    await Future<void>.delayed(reconnectDelay);
    allowEarlyRetry = true;
  }
}
