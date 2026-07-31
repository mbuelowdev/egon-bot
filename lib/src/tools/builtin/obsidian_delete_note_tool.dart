import '../../integrations/obsidian_vault.dart';
import '../tool.dart';

class ObsidianDeleteNoteTool extends Tool {
  @override
  String get name => 'obsidian_delete_note';

  @override
  String get description =>
      'Deletes a note at a vault-relative path. Owner-only. Shows a summary '
      'preview for approval. Use sparingly — prefer editing over deleting.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'path': {
            'type': 'string',
            'description': 'Vault-relative path to delete.',
          },
        },
        'required': ['path'],
      };

  @override
  Future<String?> previewChange(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final vault = context.services.vault;
    if (!vault.isAvailable) return null;
    final path = (args['path'] as String?)?.trim() ?? '';
    if (path.isEmpty) return null;
    try {
      final content = vault.readNote(path);
      final lines = content.isEmpty ? 0 : content.split('\n').length;
      final preview =
          content.length > 500 ? '${content.substring(0, 497)}...' : content;
      return 'Delete `$path` ($lines lines, ${content.length} chars):\n\n'
          '```\n$preview\n```';
    } on ObsidianPathError catch (error) {
      return 'Delete `$path` — ${error.message}';
    } catch (_) {
      return 'Delete `$path`.';
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
    if (path.isEmpty) {
      return ToolResult.error('"path" must not be empty.');
    }
    try {
      vault.deleteNote(path);
      return ToolResult.ok({'path': path, 'status': 'deleted'});
    } on ObsidianPathError catch (error) {
      return ToolResult.error(error.message);
    } on ObsidianUnavailableError catch (error) {
      return ToolResult.error(error.message);
    }
  }
}
