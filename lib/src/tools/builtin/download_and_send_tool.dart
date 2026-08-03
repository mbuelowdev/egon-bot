import 'dart:typed_data';

import '../../contacts/contacts_service.dart';
import '../../media/attachments.dart';
import '../../media/discord_image.dart';
import '../../web/fetch_api.dart';
import '../tool.dart';

class DownloadAndSendTool extends Tool {
  @override
  String get name => 'download_and_send';

  @override
  String get description =>
      'Downloads a public image or file URL and posts it as a Discord '
      'attachment in the current channel. Use when the user wants a picture '
      'or file from the web: after image_search use image_url; after '
      'fetch_url pick a URL from images[] (prefer kind=og); or pass a direct '
      'image/CDN URL. Optional message is the caption — if you set it, leave '
      'your final chat reply empty (do not repeat the caption). Do not use for '
      'HTML pages (fetch_url first) or to invent search results (image_search). '
      'Not for vault files (obsidian_send_file) or sending to other people '
      '(send_to_contact).';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'url': {
            'type': 'string',
            'description':
                'Direct http(s) URL of an image or downloadable file '
                    '(not an HTML page).',
          },
          'message': {
            'type': 'string',
            'description':
                'Optional caption posted with the file. If set, leave the '
                    'final chat reply empty — do not send the same text again.',
          },
        },
        'required': ['url'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final url = (args['url'] as String?)?.trim() ?? '';
    if (url.isEmpty) {
      return ToolResult.error(
        'download_and_send needs a non-empty http(s) file/image URL.',
      );
    }

    final attachments = context.services.attachments;
    DownloadedFile file;
    try {
      file = await context.services.fetchApi.download(
        url,
        maxBytes: attachments.maxBytes,
      );
    } catch (error) {
      return ToolResult.error('Could not download: $error');
    }

    String name = file.name;
    String mime = file.mime;
    Uint8List bytes = file.bytes;
    try {
      final converted = await DiscordImage().ensurePngCompatible(
        name: name,
        mime: mime,
        bytes: bytes,
      );
      name = converted.name;
      mime = converted.mime;
      bytes = converted.bytes;
    } catch (error) {
      return ToolResult.error('Could not convert image for Discord: $error');
    }

    try {
      final stored = attachments.storeBytes(
        channelId: context.channelId,
        messageId: 'url-download',
        userId: context.userId,
        name: name,
        mime: mime,
        bytes: bytes,
      );
      final doc = ResolvedDocument(
        name: stored.name,
        mime: stored.mime,
        bytes: attachments.readBytes(stored),
        source: 'file:#${stored.id}',
        storedFileId: stored.id,
      );
      final caption = args['message'] as String?;
      final result = await context.services.contacts.deliverToChannel(
        channelId: context.channelId,
        doc: doc,
        message: caption,
      );
      context.notePostedCaption(caption);
      return ToolResult.ok({
        'status': 'sent',
        'url': file.url,
        'file': stored.name,
        'mime': stored.mime,
        'bytes': bytes.length,
        'file_id': stored.id,
        'message': result.message,
      });
    } on AttachmentTooLargeException catch (error) {
      return ToolResult.error(error.toString());
    } catch (error) {
      return ToolResult.error('Downloaded but could not post: $error');
    }
  }
}
