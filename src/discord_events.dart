import 'dart:io';

import 'package:nyxx/nyxx.dart';

import 'api/external_api.dart';
import 'handler/mention_handler.dart';
import 'models/channel_message_memory_entry.dart';

const maxMessagesPerChannel = 200;

Future<void> hookDiscordEvents({
  required NyxxGateway client,
  required Set<String> allowedChannelIds,
  required ExternalApi externalApi,
}) async {
  final botUserId = client.user.id.toString();
  final messagesByChannel = <String, List<ChannelMessageMemoryEntry>>{};

  await for (final event in client.onMessageCreate) {
    final message = event.message;
    final channelId = message.channelId.toString();
    if (!allowedChannelIds.contains(channelId)) {
      stdout.writeln(
        'Ignoring message from non-whitelisted channelId:$channelId from ${message.author.username}'
      );
      continue;
    }

    final channelHistory = messagesByChannel.putIfAbsent(channelId, () => []);
    channelHistory.add(
      ChannelMessageMemoryEntry(
        timestamp: message.timestamp,
        userName: _authorDisplayName(message.author),
        content: message.content,
      ),
    );
    if (channelHistory.length > maxMessagesPerChannel) {
      channelHistory.removeRange(
        0,
        channelHistory.length - maxMessagesPerChannel,
      );
    }

    if (!_isMentioned(message.content, botUserId)) {
      continue;
    }

    stdout.writeln(
      'Responding to mention in $channelId from ${message.author.id} '
      '(message ${message.id})',
    );

    await handleBotMention(
      event: event,
      channelHistory: List.unmodifiable(channelHistory),
      externalApi: externalApi,
    );
  }
}

bool _isMentioned(String content, String botUserId) {
  return content.contains('<@$botUserId>') ||
      content.contains('<@!$botUserId>');
}

String _authorDisplayName(MessageAuthor author) {
  final username = author.username.trim();
  if (username.isNotEmpty) {
    return username;
  }
  return author.id.toString();
}

