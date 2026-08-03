import '../../contacts/contacts_service.dart';
import '../../media/attachments.dart';
import '../../web/ssrf_guard.dart';
import '../tool.dart';

class ScreenshotUrlTool extends Tool {
  @override
  String get name => 'screenshot_url';

  @override
  String get description =>
      'Opens a public http(s) page in Chromium via CDP (JS executed) and posts '
      'a screenshot as a Discord attachment in this channel. Use when the user '
      'wants to see what a page looks like. Optional message is the caption — '
      'if you set it, leave your final chat reply empty (do not repeat it). '
      'For full analysis (text, network, vision) use browse_url. For direct '
      'image file URLs use download_and_send.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'url': {
            'type': 'string',
            'description': 'Complete http(s) page URL to screenshot.',
          },
          'message': {
            'type': 'string',
            'description':
                'Optional caption posted with the screenshot. If set, leave '
                    'the final chat reply empty — do not send the same text again.',
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
        'screenshot_url needs a non-empty http(s) URL.',
      );
    }
    if (!context.services.browserApi.isConfigured) {
      return ToolResult.error(
        'Browser CDP endpoint is not configured (BROWSER_API_BASE_URL).',
      );
    }

    Uri uri;
    try {
      uri = Uri.parse(url);
    } catch (error) {
      return ToolResult.error('Invalid URL: $error');
    }

    try {
      await assertPublicHttpUri(uri);
    } on SsrfBlockedException catch (error) {
      return ToolResult.error('$error');
    }

    try {
      final page = await context.services.browserApi.analyze(url);
      if (page.screenshotBytes.isEmpty) {
        return ToolResult.error('Browser returned an empty screenshot.');
      }

      final attachments = context.services.attachments;
      final ext = page.screenshotMime.contains('png') ? 'png' : 'jpg';
      final stored = attachments.storeBytes(
        channelId: context.channelId,
        messageId: 'screenshot-url',
        userId: context.userId,
        name:
            'screenshot_${DateTime.now().toUtc().millisecondsSinceEpoch}.$ext',
        mime: page.screenshotMime,
        bytes: page.screenshotBytes,
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
        'url': page.url,
        'title': page.title,
        'file': stored.name,
        'mime': stored.mime,
        'bytes': page.screenshotBytes.length,
        'file_id': stored.id,
        'message': result.message,
      });
    } on AttachmentTooLargeException catch (error) {
      return ToolResult.error(error.toString());
    } on SsrfBlockedException catch (error) {
      return ToolResult.error('$error');
    } catch (error) {
      return ToolResult.error('Could not screenshot the page: $error');
    }
  }
}
