import '../../integrations/obsidian_vault.dart';
import '../tool.dart';

class ObsidianReadNoteTool extends Tool {
  @override
  String get name => 'obsidian_read_note';

  @override
  String get description =>
      'Reads the full text of a vault-relative note path. Owner-only. '
      'Use after list/search when you need the note contents.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'path': {
            'type': 'string',
            'description': 'Vault-relative path, e.g. "Inbox/Ideas.md".',
          },
        },
        'required': ['path'],
      };

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
      final content = vault.readNote(path);
      return ToolResult.ok({'path': path, 'content': content});
    } on ObsidianPathError catch (error) {
      return ToolResult.error(error.message);
    } on ObsidianUnavailableError catch (error) {
      return ToolResult.error(error.message);
    }
  }
}
