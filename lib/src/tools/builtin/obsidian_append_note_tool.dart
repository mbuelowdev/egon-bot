import '../../integrations/obsidian_vault.dart';
import '../tool.dart';

class ObsidianAppendNoteTool extends Tool {
  @override
  String get name => 'obsidian_append_note';

  @override
  String get description =>
      'Appends text to a vault note (creates the file if missing). Owner-only. '
      'Shows a diff of the appended block for approval. Use for idea capture '
      'to Inbox/Ideas.md (date-stamped entries) and other additive updates.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'path': {
            'type': 'string',
            'description':
                'Vault-relative path. For ideas use "Inbox/Ideas.md".',
          },
          'content': {
            'type': 'string',
            'description': 'Markdown block to append.',
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
      String before;
      try {
        before = vault.readNote(path);
      } on ObsidianPathError {
        before = '';
      }
      final separator = before.isEmpty || before.endsWith('\n') ? '' : '\n';
      final after = '$before$separator$content';
      return ObsidianVault.unifiedDiff(
        path: path,
        before: before.isEmpty ? null : before,
        after: after,
      );
    } catch (_) {
      return 'Append to `$path`:\n$content';
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
    if (content.isEmpty) {
      return ToolResult.error('"content" must not be empty.');
    }
    try {
      vault.appendNote(path, content);
      return ToolResult.ok({'path': path, 'status': 'appended'});
    } on ObsidianPathError catch (error) {
      return ToolResult.error(error.message);
    } on ObsidianUnavailableError catch (error) {
      return ToolResult.error(error.message);
    }
  }
}
