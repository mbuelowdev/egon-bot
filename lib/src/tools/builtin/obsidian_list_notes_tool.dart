import '../../integrations/obsidian_vault.dart';
import '../tool.dart';

class ObsidianListNotesTool extends Tool {
  @override
  String get name => 'obsidian_list_notes';

  @override
  String get description =>
      'Lists note paths in the Obsidian vault (recursive). Optionally scoped '
      'to a folder. Owner-only. Use to discover what notes exist before '
      'reading or writing.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'folder': {
            'type': 'string',
            'description':
                'Optional vault-relative folder, e.g. "Inbox". Empty = root.',
          },
        },
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
    try {
      final folder = (args['folder'] as String?)?.trim();
      final notes = vault.listNotes(
        folder: (folder == null || folder.isEmpty) ? null : folder,
      );
      return ToolResult.ok({'notes': notes, 'count': notes.length});
    } on ObsidianPathError catch (error) {
      return ToolResult.error(error.message);
    } on ObsidianUnavailableError catch (error) {
      return ToolResult.error(error.message);
    }
  }
}
