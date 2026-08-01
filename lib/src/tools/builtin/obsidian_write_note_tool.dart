import '../../integrations/obsidian_vault.dart';
import '../tool.dart';

class ObsidianWriteNoteTool extends Tool {
  @override
  String get name => 'obsidian_write_note';

  @override
  String get description =>
      'Creates or overwrites a note at a vault-relative path. Owner-only. '
      'Always shows a unified diff for approval before writing. Use for new '
      'notes and full replacements; prefer obsidian_append_note for adding '
      'to Inbox/Ideas.md.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'path': {
            'type': 'string',
            'description':
                'Vault-relative path, e.g. "Inbox/Research/Topic.md".',
          },
          'content': {
            'type': 'string',
            'description': 'Full markdown content to write.',
          },
        },
        'required': ['path', 'content'],
      };

  @override
  Future<String?> previewChange(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final vault = context.services.vault;
    if (!vault.isAvailable) return null;
    final path = (args['path'] as String?)?.trim() ?? '';
    final content = args['content'] as String? ?? '';
    if (path.isEmpty) return null;
    try {
      String? before;
      try {
        before = vault.readNote(path);
      } on ObsidianPathError {
        before = null;
      }
      return ObsidianVault.unifiedDiff(
        path: path,
        before: before,
        after: content,
      );
    } catch (_) {
      return 'Write `$path` (${content.length} chars).';
    }
  }

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final vault = context.services.vault;
    if (!vault.isAvailable) {
      return ToolResult.error(ObsidianVault.unavailableMessage);
    }
    final path = (args['path'] as String?)?.trim() ?? '';
    final content = args['content'] as String? ?? '';
    if (path.isEmpty) {
      return ToolResult.error('"path" must not be empty.');
    }
    try {
      final created = !_exists(vault, path);
      vault.writeNote(path, content);
      return ToolResult.ok({
        'path': path,
        'status': created ? 'created' : 'overwritten',
        'bytes': content.length,
      });
    } on ObsidianPathError catch (error) {
      return ToolResult.error(error.message);
    } on ObsidianUnavailableError catch (error) {
      return ToolResult.error(error.message);
    }
  }

  bool _exists(ObsidianVault vault, String path) {
    try {
      vault.readNote(path);
      return true;
    } catch (_) {
      return false;
    }
  }
}
