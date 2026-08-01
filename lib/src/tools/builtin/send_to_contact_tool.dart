import '../../contacts/contact.dart';
import '../tool.dart';

class SendToContactTool extends Tool {
  @override
  String get name => 'send_to_contact';

  @override
  String get description =>
      'Sends a document and/or message to someone in the address book. '
      'Owner-only. Resolves the contact by name/alias (asks back if '
      'ambiguous). file_ref defaults to the most recent attachment in this '
      'channel ("this document"); may also be a URL, vault note path, or '
      'file id. Always shows a delivery preview for approval before sending.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'contact_query': {
            'type': 'string',
            'description': 'Name or alias to look up, e.g. "Jan".',
          },
          'file_ref': {
            'type': 'string',
            'description':
                'Optional: "this"/empty for latest attachment, URL, vault '
                    'path, or stored file id/name. Omit with message-only sends.',
          },
          'message': {
            'type': 'string',
            'description': 'Optional accompanying message for the recipient.',
          },
        },
        'required': ['contact_query'],
      };

  @override
  Future<String?> previewChange(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final query = (args['contact_query'] as String?)?.trim() ?? '';
    if (query.isEmpty) return null;

    final resolution = context.services.contacts.resolve(query);
    if (resolution is! ContactResolved) {
      return null;
    }
    final contact = resolution.contact;
    final message = (args['message'] as String?)?.trim() ?? '';

    try {
      final doc = await context.services.contacts.resolveDocument(
        channelId: context.channelId,
        fileRef: args['file_ref'] as String?,
      );
      if (doc == null && message.isEmpty) {
        return null;
      }
      final fileLine = doc == null
          ? 'File: (none — message only)'
          : 'File: ${doc.name} '
              '(${(doc.sizeBytes / 1024).toStringAsFixed(1)} KB, ${doc.mime}) '
              'via ${doc.source}';
      return 'Send to ${contact.name}'
          '${contact.discordUserId != null ? ' (<@${contact.discordUserId}>)' : ''}\n'
          '$fileLine\n'
          'Message: ${message.isNotEmpty ? message : '(default notice)'}';
    } catch (_) {
      return null;
    }
  }

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final query = (args['contact_query'] as String?)?.trim() ?? '';
    if (query.isEmpty) {
      return ToolResult.error('"contact_query" must not be empty.');
    }

    final resolution = context.services.contacts.resolve(query);
    switch (resolution) {
      case ContactNotFound():
        return ToolResult.error(resolution.askBack());
      case ContactAmbiguous():
        return ToolResult.error(resolution.askBack(query));
      case ContactResolved(:final contact):
        if (contact.discordUserId == null || contact.discordUserId!.isEmpty) {
          return ToolResult.error(
            'Contact "${contact.name}" has no discord_user_id. '
            'Update them first, then retry.',
          );
        }
        try {
          final doc = await context.services.contacts.resolveDocument(
            channelId: context.channelId,
            fileRef: args['file_ref'] as String?,
          );
          final message = args['message'] as String?;
          if (doc == null && (message == null || message.trim().isEmpty)) {
            return ToolResult.error(
              'Need a file (recent attachment / file_ref) or a message.',
            );
          }
          final result = await context.services.contacts.deliver(
            contact: contact,
            doc: doc,
            originChannelId: context.channelId,
            message: message,
          );
          return ToolResult.ok({
            'status': 'sent',
            'mode': result.mode,
            'contact': contact.toJson(),
            if (doc != null) 'file': doc.name,
            if (doc != null) 'bytes': doc.sizeBytes,
            'message': result.message,
          });
        } catch (error) {
          return ToolResult.error('$error');
        }
    }
  }
}
