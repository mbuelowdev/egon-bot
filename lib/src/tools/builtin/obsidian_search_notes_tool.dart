import '../../integrations/obsidian_vault.dart';
import '../tool.dart';

class ObsidianSearchNotesTool extends Tool {
  @override
  String get name => 'obsidian_search_notes';

  @override
  String get description =>
      'Case-insensitive content search across the vault. Returns matching '
      'paths and lines. Owner-only. Use before reading when you know a '
      'keyword but not the path.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'query': {
            'type': 'string',
            'description': 'Substring to find (case-insensitive).',
          },
        },
        'required': ['query'],
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
    final query = (args['query'] as String?)?.trim() ?? '';
    if (query.isEmpty) {
      return ToolResult.error('"query" must not be empty.');
    }
    try {
      final hits = vault.searchNotes(query);
      return ToolResult.ok({
        'query': query,
        'matches': [
          for (final entry in hits.entries)
            {'path': entry.key, 'lines': entry.value},
        ],
        'file_count': hits.length,
      });
    } on ObsidianPathError catch (error) {
      return ToolResult.error(error.message);
    } on ObsidianUnavailableError catch (error) {
      return ToolResult.error(error.message);
    }
  }
}
