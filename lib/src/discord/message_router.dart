import 'dart:async';
import 'dart:io';

import 'package:nyxx/nyxx.dart';

import '../agent/agent.dart';
import '../agent/context_builder.dart';
import '../agent/prompts.dart';
import '../services.dart';
import 'discord_actions.dart';

/// Name used in prompts when replacing `<@botId>` mentions.
const botPromptDisplayName = 'Egon';

/// Routes gateway messages (ARCHITECTURE.md §7, §16):
/// - guild messages only in whitelisted channels; respond on mention
/// - DMs respond directly and are auto-captured as memories
/// - only the owner and whitelisted users can trigger the bot
/// - everything in scope lands in the persistent conversation log
class MessageRouter {
  MessageRouter({
    required this.services,
    required this.agent,
    required this.history,
  });

  final Services services;
  final Agent agent;
  final ChannelHistoryStore history;

  Future<void> run(NyxxGateway client) async {
    final botUserId = client.user.id.toString();
    services.approvals.attachClient(client);

    try {
      await for (final event in client.onMessageCreate) {
        try {
          await _handleEvent(event, botUserId);
        } catch (error, stackTrace) {
          stderr.writeln('Message handling failed: $error\n$stackTrace');
        }
      }
    } finally {
      services.approvals.detachClient();
    }
  }

  Future<void> _handleEvent(MessageCreateEvent event, String botUserId) async {
    final message = event.message;
    final channelId = message.channelId.toString();
    final authorId = message.author.id.toString();
    final isDm = event.guildId == null;

    if (!isDm && !services.config.allowedChannelIds.contains(channelId)) {
      return;
    }
    if (message.content.trim().isEmpty) {
      return;
    }

    final authorName = await _authorDisplayName(event);
    final scrubbedContent = replaceBotMentions(
      message.content,
      botUserId,
      botPromptDisplayName,
    );

    history.add(
      channelId,
      ChannelMessage(
        timestamp: message.timestamp,
        authorId: authorId,
        authorName: authorName,
        content: scrubbedContent,
      ),
    );

    if (authorId == botUserId) {
      return;
    }
    if (!isDm && !_isMentioned(message.content, botUserId)) {
      return;
    }
    if (!services.whitelist.isAllowed(authorId)) {
      stdout.writeln(
        'Ignoring ${isDm ? 'DM' : 'mention'} from non-whitelisted user '
        '$authorId ($authorName).',
      );
      return;
    }

    // R3: every accepted DM is memorized as well as handled as a turn.
    if (isDm) {
      try {
        services.memory.captureDm(
          userId: authorId,
          channelId: channelId,
          content: scrubbedContent,
        );
      } catch (error) {
        stderr.writeln('DM memory capture failed: $error');
      }
    }

    stdout.writeln(
      'Responding to ${isDm ? 'DM' : 'mention'} in $channelId from '
      '$authorName ($authorId).',
    );

    final incoming = IncomingMessage(
      channelId: channelId,
      authorId: authorId,
      authorName: authorName,
      content: scrubbedContent,
      timestamp: message.timestamp,
      isDm: isDm,
    );

    Future<void> send(String text) async {
      if (text.trim().isEmpty) return;
      await sendLongMessage(message.channel, text);
      history.add(
        channelId,
        ChannelMessage(
          timestamp: DateTime.now(),
          authorId: botUserId,
          authorName: botPromptDisplayName,
          content: text,
        ),
      );
    }

    // Deliberately not awaited: turns in other channels shouldn't stall
    // behind this one. LLM access is serialized by the gate anyway, and
    // handleMessage catches its own errors.
    unawaited(agent.handleMessage(incoming, send));
  }

  bool _isMentioned(String content, String botUserId) {
    return content.contains('<@$botUserId>') ||
        content.contains('<@!$botUserId>');
  }

  /// Best display name for the author in this channel's context:
  /// guild nickname > global display name > username > id.
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
          'Failed to resolve member ${partialMember.id} nickname: $error',
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
    return username.isNotEmpty ? username : author.id.toString();
  }
}
