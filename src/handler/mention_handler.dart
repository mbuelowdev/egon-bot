import 'package:nyxx/nyxx.dart';

import '../api/external_api.dart';
import '../models/channel_message_memory_entry.dart';
import '../prompts/ai_prompts.dart';

Future<void> handleBotMention({
  required MessageCreateEvent event,
  required List<ChannelMessageMemoryEntry> channelHistory,
  required ExternalApi externalApi,
}) async {
  final message = event.message;
  final prompt = buildReplyToUserPrompt(
    targetUserName: message.author.username,
    targetMessage: message.content,
    chatHistory: channelHistory,
  );

  // Keep prompt generation in one place; this handler just orchestrates usage.
  // Later this prompt can be sent to an AI backend (for example Ollama).
  print('Generated AI prompt:\n$prompt');

  //await message.channel.triggerTyping();
  final aiReply = await externalApi.generateReply(prompt: prompt);
  print('AI response:\n$aiReply');

  try {
    await externalApi.getResourceUsage();
    final isUserActive = await externalApi.isUserActive();
    if (isUserActive) {
      await message.channel.sendMessage(MessageBuilder(
        content: 'Michael is currently using his computer. I don\'t want to steal his resources :)\nTry again later!',
        referencedMessage: MessageReferenceBuilder.reply(messageId: message.id),
      ));
      return;
    }

    await message.channel.triggerTyping();
    final aiReply = await externalApi.generateReply(prompt: prompt);
    await message.channel.sendMessage(MessageBuilder(
      content: aiReply,
      referencedMessage: MessageReferenceBuilder.reply(messageId: message.id),
    ));
    return;
  } catch (e) {
    print('External API call failed: $e');
  }

  await message.channel.sendMessage(MessageBuilder(
    content: 'I could not reach Ollama or Windows monitor API.',
    referencedMessage: MessageReferenceBuilder.reply(messageId: message.id),
  ));
}
