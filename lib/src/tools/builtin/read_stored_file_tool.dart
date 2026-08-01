import '../tool.dart';

/// Reads text-like stored attachments into the tool result (§10).
class ReadStoredFileTool extends Tool {
  @override
  String get name => 'read_stored_file';

  @override
  String get description =>
      'Reads the text content of a recently stored attachment in this channel '
      '(txt/md/json/csv, or pdf via pdftotext). Owner-only. Pass a file id '
      'from the recent-files context, a name hint, or omit for the latest.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'file_ref': {
            'type': 'string',
            'description':
                'File id, name hint, or empty/latest for most recent.',
          },
        },
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final ref = (args['file_ref'] as String?)?.trim() ?? '';
    final store = context.services.attachments;
    final file = ref.isEmpty || ref == 'latest' || ref == 'this'
        ? store.mostRecentInChannel(context.channelId)
        : () {
            final id = int.tryParse(ref);
            if (id != null) {
              final byId = store.byId(id);
              if (byId != null) return byId;
            }
            return store.mostRecentInChannel(
              context.channelId,
              nameHint: ref,
            );
          }();
    if (file == null) {
      return ToolResult.error('No matching stored file in this channel.');
    }
    try {
      final text = await store.readTextContent(file);
      const cap = 8000;
      final truncated = text.length > cap;
      return ToolResult.ok({
        'id': file.id,
        'name': file.name,
        'mime': file.mime,
        'content': truncated ? text.substring(0, cap) : text,
        'truncated': truncated,
      });
    } catch (error) {
      return ToolResult.error('$error');
    }
  }
}
