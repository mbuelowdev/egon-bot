import 'dart:async';
import 'dart:io';

import 'package:nyxx/nyxx.dart';

import '../agent/agent.dart';
import '../agent/context_builder.dart';
import '../agent/prompts.dart';
import '../boot_health.dart';
import '../media/attachments.dart';
import '../media/stored_file.dart';
import '../media/transcription.dart';
import '../services.dart';
import 'discord_actions.dart';
import 'gateway_watchdog.dart';

/// Routes gateway messages (ARCHITECTURE.md §7, §9, §10, §16):
/// - guild messages only in whitelisted channels; respond on mention
/// - all allowed-channel messages logged to `conversation_log` (text + media URLs)
/// - DMs respond directly and are auto-captured as memories
/// - attachments downloaded only when addressed; voice messages transcribed
/// - owner replies resume `waiting_user` jobs; cancel intents stop active jobs
/// - only the owner and whitelisted users can trigger the bot
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
    services.jobRunner.attachClient(client);
    services.contacts.attachClient(client);
    services.discordSearch.attachClient(client);
    await services.scheduler.start(client);
    await services.jobRunner.recover();
    markHealthyBoot(services.config);
    await services.notices.flush(client);

    services.llmGate.onMonitorDownNotice = (message) {
      unawaited(_notifyOwner(client, message));
    };

    final watchdog = GatewayWatchdog()..start();
    final gatewaySub = client.gateway.messages.listen((message) {
      if (message is EventReceived) watchdog.touch();
    });

    try {
      await for (final event in client.onMessageCreate) {
        watchdog.touch();
        try {
          await _handleEvent(event, botUserId);
        } catch (error, stackTrace) {
          stderr.writeln('Message handling failed: $error\n$stackTrace');
        }
      }
    } finally {
      await gatewaySub.cancel();
      watchdog.stop();
      services.llmGate.onMonitorDownNotice = null;
      services.scheduler.stop();
      services.jobRunner.detachClient();
      services.approvals.detachClient();
      services.contacts.detachClient();
      services.discordSearch.detachClient();
    }
  }

  Future<void> _notifyOwner(NyxxGateway client, String text) async {
    try {
      final dm = await client.users.createDm(
        Snowflake.parse(services.config.ownerUserId),
      );
      await sendLongMessage(dm, text);
    } catch (error) {
      stderr.writeln('Failed to DM owner: $error');
    }
  }

  Future<void> _handleEvent(MessageCreateEvent event, String botUserId) async {
    final message = event.message;
    final channelId = message.channelId.toString();
    final authorId = message.author.id.toString();
    final isDm = event.guildId == null;
    final hasAttachments = message.attachments.isNotEmpty;

    if (!isDm && !services.config.allowedChannelIds.contains(channelId)) {
      return;
    }
    if (message.content.trim().isEmpty && !hasAttachments) {
      return;
    }

    final authorName = await _authorDisplayName(event);

    // Bot replies are logged by send()/job runner/scheduler with the prompt
    // display name; skip the gateway echo to avoid double-counting.
    if (authorId == botUserId) {
      return;
    }

    final isOwner = authorId == services.config.ownerUserId;

    // Job orchestration for the owner happens even without a mention when
    // there is an active/waiting job in this channel (§9).
    final ownerJobContext = isOwner &&
        (services.jobs.waitingInChannel(channelId) != null ||
            services.jobs.activeInChannel(channelId) != null);

    final isAddressed = isDm ||
        _isMentioned(message.content, botUserId) ||
        ownerJobContext;

    // Log every allowed-channel message for short-term context. Media is
    // recorded as filename + CDN URL only — never downloaded into SQLite.
    if (!isAddressed) {
      final logged = _contentForHistory(message, botUserId);
      if (logged.trim().isNotEmpty) {
        history.add(
          channelId,
          ChannelMessage(
            timestamp: message.timestamp,
            authorId: authorId,
            authorName: authorName,
            content: logged,
          ),
        );
      }
      return;
    }

    if (!services.whitelist.isAllowed(authorId)) {
      final logged = _contentForHistory(message, botUserId);
      if (logged.trim().isNotEmpty) {
        history.add(
          channelId,
          ChannelMessage(
            timestamp: message.timestamp,
            authorId: authorId,
            authorName: authorName,
            content: logged,
          ),
        );
      }
      stdout.writeln(
        'Ignoring ${isDm ? 'DM' : 'mention'} from non-whitelisted user '
        '$authorId ($authorName).',
      );
      return;
    }

    // Download attachments for addressed messages (§10).
    final stored = <StoredFile>[];
    if (hasAttachments) {
      try {
        stored.addAll(
          await _downloadAttachments(
            message: message,
            channelId: channelId,
            authorId: authorId,
          ),
        );
      } on AttachmentTooLargeException catch (error) {
        await sendLongMessage(message.channel, '$error');
        return;
      } catch (error, stackTrace) {
        stderr.writeln('Attachment download failed: $error\n$stackTrace');
        await sendLongMessage(
          message.channel,
          'Couldn\'t download that attachment. Try again?',
        );
        return;
      }
    }

    var content = formatMentionsForPrompt(
      message.content,
      botUserId,
      botPromptDisplayName,
      mentionedUserLabels: _mentionedUserLabels(message),
    );

    // Voice message → transcript (§10).
    if (message.flags.isAVoiceMessage && stored.isNotEmpty) {
      try {
        final transcript = await services.transcription.transcribe(
          File(stored.first.path),
        );
        content = '(voice message) $transcript';
      } on TranscriptionException catch (error) {
        stderr.writeln('Voice transcription failed: $error');
        await sendLongMessage(
          message.channel,
          'Couldn\'t understand the voice message, please type it.',
        );
        return;
      } catch (error, stackTrace) {
        stderr.writeln('Voice transcription failed: $error\n$stackTrace');
        await sendLongMessage(
          message.channel,
          'Couldn\'t understand the voice message, please type it.',
        );
        return;
      }
    } else if (hasAttachments) {
      content = _appendAttachmentRefs(content, message.attachments);
    }

    if (content.trim().isEmpty) {
      return;
    }

    history.add(
      channelId,
      ChannelMessage(
        timestamp: message.timestamp,
        authorId: authorId,
        authorName: authorName,
        content: content,
      ),
    );

    if (isOwner) {
      final waiting = services.jobs.waitingInChannel(channelId);
      if (waiting != null) {
        stdout.writeln(
          'Resuming waiting job #${waiting.id} with owner reply in $channelId',
        );
        services.jobRunner.answerWaitingJob(waiting.id, content);
        return;
      }

      final active = services.jobs.activeInChannel(channelId);
      if (active != null) {
        final cancel = await services.jobRunner.classifyCancelIntent(
          active,
          content,
        );
        if (cancel) {
          stdout.writeln(
            'Cancel intent for job #${active.id} ("${active.title}")',
          );
          services.jobRunner.requestCancel(active.id);
          await sendLongMessage(
            message.channel,
            'Stopping **${active.title}** — wrapping up the current step.',
          );
          return;
        }
      }
    }

    // R3: every accepted DM is memorized as well as handled as a turn.
    if (isDm) {
      try {
        services.memory.captureDm(
          userId: authorId,
          channelId: channelId,
          content: content,
        );
      } catch (error) {
        stderr.writeln('DM memory capture failed: $error');
      }
    }

    final incoming = IncomingMessage(
      channelId: channelId,
      authorId: authorId,
      authorName: authorName,
      content: content,
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

    unawaited(() async {
      await agent.handleMessage(incoming, send);
      services.exitIfRestartRequested();
    }());
  }

  Future<List<StoredFile>> _downloadAttachments({
    required Message message,
    required String channelId,
    required String authorId,
  }) async {
    final out = <StoredFile>[];
    final messageId = message.id.toString();
    for (final attachment in message.attachments) {
      final stored = await services.attachments.storeDownload(
        channelId: channelId,
        messageId: messageId,
        userId: authorId,
        name: attachment.fileName,
        mime: attachment.contentType ?? 'application/octet-stream',
        url: attachment.url,
        knownSize: attachment.size,
      );
      out.add(stored);
    }
    return out;
  }

  bool _isMentioned(String content, String botUserId) {
    return content.contains('<@$botUserId>') ||
        content.contains('<@!$botUserId>');
  }

  /// Text + attachment filename/URL refs for the rolling history (no downloads).
  String _contentForHistory(Message message, String botUserId) {
    final text = formatMentionsForPrompt(
      message.content,
      botUserId,
      botPromptDisplayName,
      mentionedUserLabels: _mentionedUserLabels(message),
    );
    return _appendAttachmentRefs(text, message.attachments);
  }

  Map<String, String> _mentionedUserLabels(Message message) {
    return {
      for (final user in message.mentions)
        user.id.toString(): discordUserPromptLabel(
          id: user.id.toString(),
          globalName: user.globalName,
          username: user.username,
        ),
    };
  }

  String _appendAttachmentRefs(
    String content,
    List<Attachment> attachments,
  ) {
    if (attachments.isEmpty) return content;
    final refs = attachments
        .map((a) => '${a.fileName} (${a.url})')
        .join(', ');
    if (content.trim().isEmpty) return '(attached: $refs)';
    return '$content\n(attached: $refs)';
  }

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
