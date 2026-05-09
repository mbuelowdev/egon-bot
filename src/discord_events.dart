import 'dart:io';

import 'package:nyxx/nyxx.dart';

import 'api/external_api.dart';
import 'api/search_api.dart';
import 'handler/mention_handler.dart';
import 'models/channel_message_memory_entry.dart';

const maxMessagesPerChannel = 200;

/// Name used in AI prompts when replacing `<@botId>` mentions (Discord username may differ).
const botPromptDisplayName = 'Egon';

Future<void> hookDiscordEvents({
  required NyxxGateway client,
  required Set<String> allowedChannelIds,
  required ExternalApi externalApi,
  required SearchApi searchApi,
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

    // Resolve the author's per-server name once and reuse it for both the
    // history entry and the AI handler so the model and the prompt agree.
    final authorDisplayName = await _authorDisplayName(event);

    final channelHistory = messagesByChannel.putIfAbsent(channelId, () => []);
    channelHistory.add(
      ChannelMessageMemoryEntry(
        timestamp: message.timestamp,
        userName: authorDisplayName,
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
      searchApi: searchApi,
      authorDisplayName: authorDisplayName,
      botUserId: botUserId,
      botDisplayName: botPromptDisplayName,
    );
  }
}

bool _isMentioned(String content, String botUserId) {
  return content.contains('<@$botUserId>') ||
      content.contains('<@!$botUserId>');
}

/// Resolves the best name to show for a message author in the context of the
/// channel/guild the message was sent in.
///
/// Priority:
///   1. Guild member nickname (`Member.nick`) — the per-server profile name.
///   2. Global display name (`User.globalName`) — set in Discord account settings.
///   3. Username (`MessageAuthor.username`) — the unique handle.
///   4. The numeric user id, as a last resort.
Future<String> _authorDisplayName(MessageCreateEvent event) async {
  final author = event.message.author;

  final partialMember = event.member;
  if (partialMember != null) {
    try {
      final member = await partialMember.get();
      final nick = member.nick?.trim();
      if (nick != null && nick.isNotEmpty) {
        return nick;
      }
    } catch (error) {
      stdout.writeln(
        'Failed to resolve guild member ${partialMember.id} for nickname: $error',
      );
    }
  }

  if (author is User) {
    final globalName = author.globalName?.trim();
    if (globalName != null && globalName.isNotEmpty) {
      return globalName;
    }
  }

  final username = author.username.trim();
  if (username.isNotEmpty) {
    return username;
  }
  return author.id.toString();
}

