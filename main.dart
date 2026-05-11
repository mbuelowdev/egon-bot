import 'dart:io';

import 'package:dotenv/dotenv.dart';
import 'package:nyxx/nyxx.dart';
import 'src/api/external_api.dart';
import 'src/api/fetch_api.dart';
import 'src/api/search_api.dart';
import 'src/discord_events.dart';

const allowedChannelIds = <String>{
  '234802941540696064',  // Geringverdiener; #nein-haben-wir-nicht
  '1461803674144735252', // Private Chat Michael/Egon
  '116205171205210117', // Hi na? - #chat1
  '480039711705137153', // Hi na? - #chat2
  '1029457370516049981', // Hi na? - #event-chat
  '1503447806000627864', // eydu - #botting
};
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
  final windowsApiBaseUrl = env['WINDOWS_MONITOR_API_BASE_URL'] ?? 'http://127.0.0.1:11433';

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
    ollamaModel: 'gpt-oss:20b',
  );
  final searchApi = SearchApi();
  final fetchApi = FetchApi();

  await _runBotSupervisor(
    token: token,
    externalApi: externalApi,
    searchApi: searchApi,
    fetchApi: fetchApi,
  );
}

Future<void> _runBotSupervisor({
  required String token,
  required ExternalApi externalApi,
  required SearchApi searchApi,
  required FetchApi fetchApi,
}) async {
  var allowEarlyRetry = false;

  while (true) {
    try {
      final client = await Nyxx.connectGateway(
        token,
        GatewayIntents.allUnprivileged,
        options: GatewayClientOptions(plugins: [logging, cliIntegration]),
      );
      stdout.writeln('Discord bot connected as user ${client.user.id}.');

      // If this connection dies later, first retry should be a bit earlier.
      allowEarlyRetry = true;

      await hookDiscordEvents(
        client: client,
        allowedChannelIds: allowedChannelIds,
        externalApi: externalApi,
        searchApi: searchApi,
        fetchApi: fetchApi,
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
