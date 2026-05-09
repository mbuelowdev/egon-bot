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

  // Typing trigger triggers rate limit exception for w/e reason
  //await message.channel.triggerTyping();

  try {
    // First see if the cpu/gpu resources are free to use for ai prompting
    await externalApi.getResourceUsage();
    final isUserActive = await externalApi.isUserActive();
    if (isUserActive) {
      await message.channel.sendMessage(MessageBuilder(
        content: 'Michael is currently using his computer. I don\'t want to steal his resources :)\nTry again later!',
        referencedMessage: MessageReferenceBuilder.reply(messageId: message.id),
      ));
      return;
    }

    final aiReply = await externalApi.generateReply(prompt: prompt);
    print('AI response:\n$aiReply');
    await message.channel.sendMessage(MessageBuilder(
      content: aiReply,
      referencedMessage: MessageReferenceBuilder.reply(messageId: message.id),
    ));
    return;
  } catch (e) {
    print('External API call failed: $e');
  }
}
