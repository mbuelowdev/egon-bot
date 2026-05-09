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

/// Builds the `system` role message for the chat-format Ollama call.
///
/// Contains Egon's persona, texting rules, the tool-usage instruction, and
/// the recent chat history rendered as readable lines. The latest message is
/// not included here — it is sent as a separate `user` message produced by
/// [buildUserMessageForChat].
String buildSystemPromptForChat({
  required List<ChannelMessageMemoryEntry> chatHistory,
  required String botUserId,
  required String botDisplayName,
  int maxHistoryItems = 10,
  int maxHistoryMessageChars = 500,
}) {
  final start = chatHistory.length > maxHistoryItems
      ? chatHistory.length - maxHistoryItems
      : 0;
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
- Immer in der gleichen Sprache antworten wie die Person — bei deutschsprachigem Chat die Antwort auf Deutsch; keine englischen Satzteile, Tool-Sprech oder erklärendes Denglisch (ok sind kurze übliche Discord-Floskeln wie „lmao“/„ngl“, wenn’s passt)
- Nie interne Überlegungen, Meta-Kommentare oder englische Kurznotizen in die Antwort schreiben (nichts wie „No results“, „probably“, Checklisten)
- Eigene Witze niemals erklären

## Tools
- Wenn eine Frage aktuelle Fakten braucht, die du nicht aus deinem allgemeinen Wissen beantworten kannst (News, aktuelle Daten, Preise, Sportergebnisse, Wetter, neue Releases, Spielzeiten etc.), ruf das web_search-Tool mit einer kurzen Suchanfrage in der Sprache der Person auf.
- Wenn dir die Snippets aus web_search nicht reichen oder du eine konkrete URL hast (vom User oder aus einem Suchergebnis), ruf fetch_url mit der vollständigen http(s)-URL auf, um die Seite als Text zu lesen. Du darfst fetch_url so oft hintereinander aufrufen wie nötig.
- web_search nimmt nur "query"; fetch_url nimmt nur "url". Niemals eine URL an web_search geben.
- Sonst chill einfach — such nicht nach Meinungen, Witzen oder Sachen die du selbst beantworten kannst.
- Erwähne die Tools niemals gegenüber dem User. Nutz einfach was du gefunden hast und antworte natürlich.

## Bisheriger Chatverlauf als Kontext
${historyLines.isEmpty ? '(noch keine Nachrichten)' : historyLines}

Antworte als Egon. Nicht zu viel nachdenken.
''';
}

/// Builds the `user` role content for the chat-format Ollama call. The author's
/// display name and message timestamp are prepended so the model knows who it
/// is replying to without us having to rely on Ollama's optional `name` field.
String buildUserMessageForChat({
  required String targetUserName,
  required String targetMessage,
  required DateTime targetMessageTimestamp,
  required String botUserId,
  required String botDisplayName,
}) {
  final filtered = replaceBotMentionsForPrompt(
    targetMessage,
    botUserId,
    botDisplayName,
  );
  return '[${formatEuropeBerlinForPrompt(targetMessageTimestamp)}] $targetUserName: $filtered';
}

/// Legacy single-string prompt builder retained for callers that still use
/// `/api/generate`. New code should call [buildSystemPromptForChat] and
/// [buildUserMessageForChat] directly and send chat-format messages.
String buildReplyToUserPrompt({
  required String targetUserName,
  required String targetMessage,
  required DateTime targetMessageTimestamp,
  required List<ChannelMessageMemoryEntry> chatHistory,
  required String botUserId,
  required String botDisplayName,
  int maxHistoryItems = 10,
  int maxHistoryMessageChars = 500,
}) {
  final system = buildSystemPromptForChat(
    chatHistory: chatHistory,
    botUserId: botUserId,
    botDisplayName: botDisplayName,
    maxHistoryItems: maxHistoryItems,
    maxHistoryMessageChars: maxHistoryMessageChars,
  );
  final user = buildUserMessageForChat(
    targetUserName: targetUserName,
    targetMessage: targetMessage,
    targetMessageTimestamp: targetMessageTimestamp,
    botUserId: botUserId,
    botDisplayName: botDisplayName,
  );
  return '$system\n\n---\n\nDein Freund $targetUserName hat gerade gesagt:\n$user\n\nAntworte als Egon. Nicht zu viel nachdenken.\n';
}
