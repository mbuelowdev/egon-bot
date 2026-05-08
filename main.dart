import 'dart:io';

import 'package:dotenv/dotenv.dart';
import 'package:nyxx/nyxx.dart';

const allowedChannelIds = <String>{
  '234802941540696064',  // Geringverdiener; #nein-haben-wir-nicht
  '1461803674144735252', // Private Chat Michael/Egon
};

Future<void> main() async {
  final env = DotEnv(includePlatformEnvironment: true)..load();
  final token = env['DISCORD_BOT_TOKEN'];

  if (token == null || token.isEmpty) {
    stderr.writeln(
      'Missing DISCORD_BOT_TOKEN. Provide it via environment variables or .env.',
    );
    exitCode = 64;
    return;
  }

  final client = await Nyxx.connectGateway(
    token,
    GatewayIntents.allUnprivileged,
    options: GatewayClientOptions(plugins: [logging, cliIntegration]),
  );

  stdout.writeln('Discord bot connected as user ${client.user.id}.');
  final botUserId = client.user.id.toString();

  await for (final event in client.onMessageCreate) {
    final message = event.message;
    final channelId = message.channelId.toString();
    if (!allowedChannelIds.contains(channelId)) {
      continue;
    }

    if (!_isMentioned(message.content, botUserId)) {
      continue;
    }

    stdout.writeln(
      'Responding to mention in $channelId from ${message.author.id} '
      '(message ${message.id})',
    );

    await message.channel.sendMessage(MessageBuilder(
      content: 'You mentioned me!',
      referencedMessage: MessageReferenceBuilder.reply(messageId: event.message.id),
    ));
  }
}

bool _isMentioned(String content, String botUserId) {
  return content.contains('<@$botUserId>') ||
      content.contains('<@!$botUserId>');
}
