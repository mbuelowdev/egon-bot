import 'dart:io';

import 'package:nyxx/nyxx.dart';

import '../integrations/windows_monitor_client.dart';
import '../llm/ollama_client.dart';
import '../llm/ollama_models.dart';

/// Minimal proof-of-life loop: replies via Ollama when the bot is mentioned
/// or messaged directly. This is the seed the new architecture grows from —
/// see ARCHITECTURE.md.
///
/// When [monitor] is provided, the shared GPU is checked before every Ollama
/// call. While the GPU is busy, replies fall back to [utilityModel] running
/// CPU-only (`num_gpu: 0`) so they never touch VRAM — or are refused when no
/// utility model is configured. The full design adds a queue and degraded-mode
/// toolset on top (ARCHITECTURE.md §5.1).
Future<void> runMessageLoop({
  required NyxxGateway client,
  required OllamaClient ollama,
  required WindowsMonitorClient? monitor,
  required String? utilityModel,
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

    var gpuBusy = false;
    if (monitor != null) {
      try {
        gpuBusy = await monitor.isUserActive();
      } catch (error) {
        // Monitor unreachable most likely means the Windows machine (and
        // with it Ollama, including the CPU tier) is off. Stay quiet.
        stderr.writeln('Windows monitor unreachable, skipping reply: $error');
        continue;
      }
    }

    if (gpuBusy && utilityModel == null) {
      await message.channel.sendMessage(
        MessageBuilder(
          content: 'The GPU is in use right now — try again later.',
        ),
      );
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
        // Degraded mode: the GPU belongs to the game right now, so answer
        // with the small utility model pinned to the CPU.
        modelOverride: gpuBusy ? utilityModel : null,
        options: gpuBusy ? const {'num_gpu': 0} : null,
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
