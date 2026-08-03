import 'dart:convert';

import '../../llm/ollama_models.dart';
import '../../media/stored_file.dart';
import '../../web/ssrf_guard.dart';
import '../tool.dart';

class BrowseUrlTool extends Tool {
  @override
  String get name => 'browse_url';

  @override
  String get description =>
      'Opens a public http(s) URL in Chromium via CDP (JS executed), '
      'returning rendered text, images[], links, captured XHR/fetch network '
      'traffic, a screenshot, and an optional vision summary of what the page '
      'looks like. Use for SPAs, "what does this site look like", live API '
      'discovery, or when fetch_url missed JS-rendered images. Prefer '
      'fetch_url for simple static HTML pages. To extract an image from this '
      'page: pick a URL from images[] (or links/network) → download_and_send. '
      'Do not fall back to web_search/image_search. To only post a picture of '
      'the page into chat, use screenshot_url. Not for binary downloads — use '
      'download_and_send.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'url': {
            'type': 'string',
            'description': 'Complete http(s) URL to open in Chromium.',
          },
          'include_screenshot': {
            'type': 'boolean',
            'description':
                'Store a screenshot of the rendered page (default true).',
          },
          'include_vision': {
            'type': 'boolean',
            'description': 'Ask the vision model to describe the screenshot '
                '(default true when OLLAMA_VISION_MODEL is set).',
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
      return ToolResult.error('browse_url needs a non-empty http(s) URL.');
    }
    if (!context.services.browserApi.isConfigured) {
      return ToolResult.error(
        'Browser CDP endpoint is not configured (BROWSER_API_BASE_URL).',
      );
    }

    final includeScreenshot = args['include_screenshot'] != false;
    final includeVision = args['include_vision'] != false;

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
      final result = <String, Object?>{
        'url': page.url,
        'title': page.title,
        'text': page.text,
        'truncated': page.truncated,
        'images': page.images,
        'links': page.links,
        'network': page.network,
      };

      StoredFile? stored;
      if (includeScreenshot && page.screenshotBytes.isNotEmpty) {
        final ext = page.screenshotMime.contains('png') ? 'png' : 'jpg';
        stored = context.services.attachments.storeBytes(
          channelId: context.channelId,
          messageId: 'browse-url',
          userId: context.userId,
          name: 'browse_${DateTime.now().toUtc().millisecondsSinceEpoch}.$ext',
          mime: page.screenshotMime,
          bytes: page.screenshotBytes,
        );
        result['screenshot'] = {
          'name': stored.name,
          'path': stored.path,
          'mime': stored.mime,
        };
      }

      if (includeVision &&
          includeScreenshot &&
          page.screenshotBytes.isNotEmpty) {
        final visionModel = context.services.config.ollamaVisionModel;
        if (visionModel == null) {
          result['visual_summary'] =
              '(vision disabled — set OLLAMA_VISION_MODEL)';
        } else {
          try {
            final summary = await context.services.llmGate.chatVision(
              messages: [
                OllamaChatMessage(
                  role: 'user',
                  content: 'Describe this rendered web page screenshot for an '
                      'assistant that will answer the user. Cover layout, '
                      'main visible text, UI elements, and anything that '
                      'looks like an error, login wall, or empty SPA shell. '
                      'Be concise (≤120 words). Page title: "${page.title}". '
                      'URL: ${page.url}',
                  images: [base64Encode(page.screenshotBytes)],
                ),
              ],
            );
            result['visual_summary'] = summary.content.trim();
          } catch (error) {
            result['visual_summary'] = '(vision failed: $error)';
          }
        }
      }

      return ToolResult.ok(result);
    } catch (error) {
      return ToolResult.error('Could not browse the page: $error');
    }
  }
}
