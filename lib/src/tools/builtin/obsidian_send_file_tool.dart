import '../../integrations/obsidian_vault.dart';
import '../../media/attachments.dart';
import '../tool.dart';

class ObsidianSendFileTool extends Tool {
  @override
  String get name => 'obsidian_send_file';

  @override
  String get description =>
      'Posts a vault file (image, PDF, note, …) into the current Discord '
      'channel so Michael can see it. Owner-only. path may be a vault-'
      'relative path or a unique filename (e.g. a screenshot). Optional '
      'message is the caption — if you set it, leave your final chat reply '
      'empty (do not repeat it). Prefer this over describing the '
      'image; do not use for sending to other people (use send_to_contact).';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'path': {
            'type': 'string',
            'description': 'Vault-relative path or unique filename, e.g. '
                '"Screenshot_20250331-103548.png".',
          },
          'message': {
            'type': 'string',
            'description':
                'Optional caption posted with the file. If set, leave the '
                    'final chat reply empty — do not send the same text again.',
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
    final pathArg = (args['path'] as String?)?.trim() ?? '';
    if (pathArg.isEmpty) {
      return ToolResult.error('"path" must not be empty.');
    }

    try {
      final doc = await context.services.contacts.resolveDocument(
        channelId: context.channelId,
        fileRef: pathArg,
        requireFile: true,
      );
      if (doc == null || !doc.source.startsWith('vault:')) {
        return ToolResult.error('Vault file not found: $pathArg');
      }
      final caption = args['message'] as String?;
      final result = await context.services.contacts.deliverToChannel(
        channelId: context.channelId,
        doc: doc,
        message: caption,
      );
      context.notePostedCaption(caption);
      return ToolResult.ok({
        'status': 'sent',
        'path': doc.source.substring('vault:'.length),
        'file': doc.name,
        'mime': doc.mime,
        'bytes': doc.sizeBytes,
        'message': result.message,
      });
    } on AttachmentTooLargeException catch (error) {
      return ToolResult.error(error.toString());
    } on ObsidianPathError catch (error) {
      return ToolResult.error(error.message);
    } on ObsidianUnavailableError catch (error) {
      return ToolResult.error(error.message);
    } catch (error) {
      return ToolResult.error('$error');
    }
  }
}
