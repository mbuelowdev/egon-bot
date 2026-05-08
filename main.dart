import 'dart:io';

import 'package:dotenv/dotenv.dart';
import 'package:nyxx/nyxx.dart';
import 'src/api/external_api.dart';
import 'src/discord_events.dart';

const allowedChannelIds = <String>{
  '234802941540696064',  // Geringverdiener; #nein-haben-wir-nicht
  '1461803674144735252', // Private Chat Michael/Egon
};

Future<void> main() async {
  final env = DotEnv(includePlatformEnvironment: true)..load();
  final token = env['DISCORD_BOT_TOKEN'];
  final ollamaBaseUrl = env['OLLAMA_API_BASE_URL'] ?? 'http://127.0.0.1:11434';
  final windowsApiBaseUrl =
      env['WINDOWS_MONITOR_API_BASE_URL'] ?? 'http://127.0.0.1:11433';
  final ollamaModel = env['OLLAMA_MODEL'] ?? 'qwen3:4b';

  if (token == null || token.isEmpty) {
    stderr.writeln(
      'Missing DISCORD_BOT_TOKEN. Provide it via environment variables or .env.',
    );
    exitCode = 64;
    return;
  }

  final externalApi = ExternalApi(
    ollamaBaseUrl: Uri.parse(ollamaBaseUrl),
    windowsMonitorBaseUrl: Uri.parse(windowsApiBaseUrl),
    ollamaModel: ollamaModel,
  );

  final client = await Nyxx.connectGateway(
    token,
    GatewayIntents.allUnprivileged,
    options: GatewayClientOptions(plugins: [logging, cliIntegration]),
  );

  stdout.writeln('Discord bot connected as user ${client.user.id}.');
  await hookDiscordEvents(
    client: client,
    allowedChannelIds: allowedChannelIds,
    externalApi: externalApi,
  );
}
