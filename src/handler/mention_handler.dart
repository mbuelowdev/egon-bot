import 'package:nyxx/nyxx.dart';

import '../api/external_api.dart';
import '../api/fetch_api.dart';
import '../api/ollama_models.dart';
import '../api/search_api.dart';
import '../models/channel_message_memory_entry.dart';
import '../prompts/ai_prompts.dart';
import 'tool_loop.dart';

Future<void> handleBotMention({
  required MessageCreateEvent event,
  required List<ChannelMessageMemoryEntry> channelHistory,
  required ExternalApi externalApi,
  required SearchApi searchApi,
  required FetchApi fetchApi,
  required String authorDisplayName,
  required String botUserId,
  required String botDisplayName,
}) async {
  final message = event.message;

  final systemPrompt = buildSystemPromptForChat(
    chatHistory: channelHistory,
    botUserId: botUserId,
    botDisplayName: botDisplayName,
  );
  final userContent = buildUserMessageForChat(
    targetUserName: authorDisplayName,
    targetMessage: message.content,
    targetMessageTimestamp: message.timestamp,
    botUserId: botUserId,
    botDisplayName: botDisplayName,
  );

  final initialMessages = <OllamaChatMessage>[
    OllamaChatMessage(role: 'system', content: systemPrompt),
    OllamaChatMessage(role: 'user', content: userContent),
  ];

  print('System prompt:\n$systemPrompt');
  print('User message: $userContent');

  // Typing trigger triggers rate limit exception for w/e reason
  //await message.channel.triggerTyping();

  try {
    // First see if the cpu/gpu resources are free to use for ai prompting
    await externalApi.getResourceUsage();
    final isUserActive = await externalApi.isUserActive();
    if (isUserActive) {
      await message.channel.sendMessage(MessageBuilder(
        content:
            'Michael ist grad am Rechner — will ihm die Ressourcen nicht klauen :)\n'
            'Später nochmal probieren!',
        referencedMessage: MessageReferenceBuilder.reply(messageId: message.id),
      ));
      return;
    }

    final generationStopwatch = Stopwatch()..start();
    final aiReply = await runToolLoop(
      externalApi: externalApi,
      searchApi: searchApi,
      fetchApi: fetchApi,
      initialMessages: initialMessages,
    );
    generationStopwatch.stop();
    print('AI response:\n$aiReply');
    if (aiReply.isEmpty) {
      print('AI returned empty content; not sending a reply.');
      return;
    }
    final seconds =
        generationStopwatch.elapsedMicroseconds / Duration.microsecondsPerSecond;
    final contentWithTiming =
        '${aiReply.trimRight()} (${seconds.toStringAsFixed(2)}s)';
    await message.channel.sendMessage(MessageBuilder(
      content: contentWithTiming,
      referencedMessage: MessageReferenceBuilder.reply(messageId: message.id),
    ));
    return;
  } catch (e) {
    print('External API call failed: $e');
  }
}
