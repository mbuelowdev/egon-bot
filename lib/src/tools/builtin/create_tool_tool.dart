import '../tool.dart';
import '../tool_creator.dart';

/// Self-extension: generate a new Dart tool, analyze it, install, restart (§6.4).
class CreateToolTool extends Tool {
  @override
  String get name => 'create_tool';

  @override
  String get description =>
      'Creates a new Dart tool from a natural-language description, validates '
      'it with dart analyze (up to 3 repair rounds), installs it under '
      '/data/tools, and restarts the bot so the tool becomes available. '
      'Use when the owner asks you to build yourself a new capability. '
      'Do NOT use for one-off tasks that existing tools can already handle.';

  @override
  ToolAccess get access => ToolAccess.dangerous;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'description': {
            'type': 'string',
            'description':
                'What the new tool should do, including inputs/outputs.',
          },
          'name': {
            'type': 'string',
            'description':
                'Optional snake_case tool name (without _tool suffix). '
                    'Derived from the description when omitted.',
          },
        },
        'required': ['description'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final description = args['description']?.toString().trim() ?? '';
    if (description.isEmpty) {
      return ToolResult.error('description is required');
    }
    final preferred = args['name']?.toString().trim();
    return ToolCreator(context.services).create(
      description: description,
      channelId: context.channelId,
      preferredName:
          (preferred == null || preferred.isEmpty) ? null : preferred,
    );
  }
}
