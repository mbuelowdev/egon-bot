import '../llm/ollama_models.dart';
import '../services.dart';

/// Who may trigger a tool, and what it takes (ARCHITECTURE.md §16).
enum ToolAccess {
  /// Any whitelisted user: web search, list_tools, reminders in shared chats.
  standard,

  /// Owner only — personal data: calendar, Obsidian, memory listing.
  personal,

  /// Owner runs it directly; a whitelisted user's request pauses and asks
  /// the owner for approval in the same channel (§6.5): create_tool,
  /// extend_self, restart_self.
  dangerous,
}

/// Everything a tool needs to know about the call site.
class ToolContext {
  ToolContext({
    required this.channelId,
    required this.userId,
    required this.isOwner,
    required this.isDm,
    required this.services,
  });

  final String channelId;
  final String userId;
  final bool isOwner;
  final bool isDm;
  final Services services;

  /// Captions already shown with channel attachments this turn.
  ///
  /// Used so the final chat reply does not repeat text that was already
  /// posted as an image/file caption.
  final List<String> postedCaptions = [];

  /// Records a non-empty caption posted with an attachment in this channel.
  void notePostedCaption(String? message) {
    final trimmed = message?.trim() ?? '';
    if (trimmed.isNotEmpty) postedCaptions.add(trimmed);
  }

  /// Returns [reply] unchanged, or empty when it only repeats a posted caption.
  String replyWithoutDuplicateCaption(String reply) {
    final out = reply.trim();
    if (out.isEmpty || postedCaptions.isEmpty) return out;
    final lower = out.toLowerCase();
    for (final caption in postedCaptions) {
      if (caption.trim().toLowerCase() == lower) return '';
    }
    return out;
  }
}

/// Result fed back to the model verbatim as the tool message content.
class ToolResult {
  ToolResult.ok(this.json);
  ToolResult.error(String message) : json = {'error': message};

  final Map<String, Object?> json;

  bool get isError => json.containsKey('error');
}

/// Base class for every capability — built-in or self-written (§6.1).
abstract class Tool {
  /// Unique snake_case identifier, e.g. `web_search`.
  String get name;

  /// One-paragraph description shown to the LLM. Must state when to use it,
  /// what it returns, and when NOT to use it.
  String get description;

  /// JSON Schema (draft-07 subset Ollama understands) for the arguments.
  Map<String, Object?> get parametersJsonSchema;

  ToolAccess get access => ToolAccess.standard;

  /// `builtin` or `self-written`; rendered by `list_tools`.
  String get origin => 'builtin';

  /// Non-null = this tool's effect must be previewed and approved by the
  /// owner before [execute] runs (§6.5). Obsidian writes return a unified
  /// diff here; calendar mutations a human-readable summary.
  Future<String?> previewChange(
    ToolContext context,
    Map<String, Object?> args,
  ) async =>
      null;

  /// Execute the call. Must not throw for expected failures — return
  /// [ToolResult.error] instead so the LLM can react.
  Future<ToolResult> execute(ToolContext context, Map<String, Object?> args);

  OllamaTool toOllamaTool() => OllamaTool(
        name: name,
        description: description,
        parameters: parametersJsonSchema,
      );
}
