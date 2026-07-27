import 'dart:io';

import 'package:nyxx/nyxx.dart';

import '../llm/ollama_client.dart';
import '../llm/ollama_models.dart';

/// Minimal proof-of-life loop: replies via Ollama when the bot is mentioned
/// or messaged directly. This is the seed the new architecture grows from —
/// see ARCHITECTURE.md.
Future<void> runMessageLoop({
  required NyxxGateway client,
  required OllamaClient ollama,
}) async {
  final botUserId = client.user.id.toString();

  await for (final event in client.onMessageCreate) {
    final message = event.message;
    if (message.author.id.toString() == botUserId) {
      continue;
    }

    final isDm = event.guildId == null;
    if (!isDm && !_isMentioned(message.content, botUserId)) {
      continue;
    }

    try {
      final reply = await ollama.chatCompletion(
        messages: [
          OllamaChatMessage(
            role: 'system',
            content: 'You are a helpful Discord assistant. Reply briefly and '
                'in the same language as the user.',
          ),
          OllamaChatMessage(role: 'user', content: message.content),
        ],
      );
      if (reply.content.trim().isEmpty) {
        continue;
      }
      await message.channel.sendMessage(
        MessageBuilder(content: reply.content.trim()),
      );
    } catch (error) {
      stderr.writeln('Failed to handle message ${message.id}: $error');
    }
  }
}

bool _isMentioned(String content, String botUserId) {
  return content.contains('<@$botUserId>') ||
      content.contains('<@!$botUserId>');
}
