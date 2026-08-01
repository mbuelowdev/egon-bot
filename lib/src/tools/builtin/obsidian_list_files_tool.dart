import '../../integrations/obsidian_vault.dart';
import '../tool.dart';

class ObsidianListFilesTool extends Tool {
  @override
  String get name => 'obsidian_list_files';

  @override
  String get description =>
      'Lists non-markdown vault files (images, PDFs, etc.), optionally '
      'filtered by folder or name substring. Owner-only. Use to find '
      'screenshots/attachments before `obsidian_send_file`. For markdown '
      'notes use `obsidian_list_notes` instead.';

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
          'query': {
            'type': 'string',
            'description':
                'Optional case-insensitive substring match on the relative '
                    'path, e.g. "Screenshot" or ".png".',
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
      final query = (args['query'] as String?)?.trim();
      final files = vault.listFiles(
        folder: (folder == null || folder.isEmpty) ? null : folder,
        nameQuery: (query == null || query.isEmpty) ? null : query,
        attachmentsOnly: true,
      );
      return ToolResult.ok({'files': files, 'count': files.length});
    } on ObsidianPathError catch (error) {
      return ToolResult.error(error.message);
    } on ObsidianUnavailableError catch (error) {
      return ToolResult.error(error.message);
    }
  }
}
