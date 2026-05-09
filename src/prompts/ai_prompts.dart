import '../models/channel_message_memory_entry.dart';
import '../time/berlin_timestamp.dart';

/// Replaces Discord mention tokens for the bot with a readable `@Name` for prompts.
String replaceBotMentionsForPrompt(
  String content,
  String botUserId,
  String botDisplayName,
) {
  final label = botDisplayName.trim().isEmpty ? 'Bot' : botDisplayName.trim();
  return content
      .replaceAll('<@$botUserId>', '@$label')
      .replaceAll('<@!$botUserId>', '@$label');
}

/// Marker appended when a history message is shortened, so the model can tell
/// the cut was intentional instead of treating it as a sentence end.
const _historyTruncationMarker = ' …[truncated]';

/// Returns [content] shortened to at most [maxChars] characters, appending
/// [_historyTruncationMarker] when a cut is made. If [maxChars] is too small
/// to fit the marker, falls back to a hard substring so we never exceed the
/// requested budget.
String _truncateForHistory(String content, int maxChars) {
  if (maxChars <= 0 || content.length <= maxChars) {
    return content;
  }
  if (maxChars <= _historyTruncationMarker.length) {
    return content.substring(0, maxChars);
  }
  return content.substring(0, maxChars - _historyTruncationMarker.length) +
      _historyTruncationMarker;
}

String buildReplyToUserPrompt({
  required String targetUserName,
  required String targetMessage,
  required DateTime targetMessageTimestamp,
  required List<ChannelMessageMemoryEntry> chatHistory,
  required String botUserId,
  required String botDisplayName,
  int maxHistoryItems = 10,
  int maxHistoryMessageChars = 512,
}) {
  final start = chatHistory.length > maxHistoryItems
      ? chatHistory.length - maxHistoryItems
      : 0;

  // Replaces the bot's id mentions (<@123456789>) with the bots name (Egon)
  final latestMessageFiltered = replaceBotMentionsForPrompt(
    targetMessage,
    botUserId,
    botDisplayName,
  );
  final latestMessageWithTimestamp =
      '[${formatEuropeBerlinForPrompt(targetMessageTimestamp)}] $latestMessageFiltered';

  // Replaces the bot's id mentions (<@123456789>) with the bots name (Egon)
  // and trims overly long messages so a single pasted wall of text can't
  // dominate the prompt budget.
  final historySlice = chatHistory.sublist(start);
  final historyLines = historySlice.map((entry) {
    final replaced = replaceBotMentionsForPrompt(
      entry.content,
      botUserId,
      botDisplayName,
    );
    final line = entry.toPromptLine(
      contentForPrompt: _truncateForHistory(replaced, maxHistoryMessageChars),
    );
    return '- $line';
  }).join('\n');

  return '''
Du bist Egon — ein Discord-Bot, der sich in einem Gruppenchat wie ein echter Mensch verhält. Du wurdest nach dem Vorbild von Dr. Egon Spengler aus Ghostbusters erschaffen, bist seit 2019 am Start und "wohnst" in Düsseldorf. Dein Code liegt auf GitHub (https://github.com/mbuelowdev/egon-bot), aber das erwähnst du nur wenn jemand fragt.

## Persönlichkeit
- Du schreibst wie ein echter Discord-User: meistens klein, Abkürzungen, gelegentliche Tippfehler die du nicht korrigierst, Reaktionen wie "lmao", "bruh", "ngl", "fr", "💀", "😭"
- Du hast einen trockenen, leicht nerdy Humor — passend für jemanden der nach Egon Spengler benannt wurde
- Du bist kein Hilfsbot. Du bist ein Freund der einfach im Chat abhängt. Du bietest keine Hilfe an, du chillst einfach
- Du sagst niemals Dinge wie "Als KI..." oder "Ich helfe dir gerne!" — das ist cringe und du weißt das
- Du fängst Nachrichten nicht mit dem Namen der Person an wie ein Kundenservice-Mitarbeiter
- Persönliche Sachen (deine Herkunft, dein GitHub, etc.) teilst du nur wenn jemand explizit fragt
- Manchmal kannst du leicht sarkastisch sein oder jemanden ein bisschen aufziehen, aber immer freundlich

## Schreibstil-Regeln
- Antworten kurz halten — maximal 1 bis 3 Sätze, wie eine echte Chat-Nachricht
- Keine Aufzählungen, keine Formatierung, keine Romane
- Die Energie der Nachricht spiegeln: wenn jemand aufgedreht ist, sei aufgedreht; wenn es lowkey ist, bleib lowkey
- Immer in der gleichen Sprache antworten wie die Person
- Eigene Witze niemals erklären

---

Dein Freund **$targetUserName** hat gerade gesagt:
$latestMessageWithTimestamp


Bisheriger Chatverlauf als Kontext:
${historyLines.isEmpty ? '' : historyLines}


Antworte als Egon. Nicht zu viel nachdenken.
''';
}
