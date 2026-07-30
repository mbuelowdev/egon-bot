import '../tool.dart';

class RememberTool extends Tool {
  @override
  String get name => 'remember';

  @override
  String get description =>
      'Stores a lasting fact in long-term memory. Use when the owner asks to '
      'remember something, or when a durable preference/fact should stick '
      'across conversations. Do not store ephemeral chat fluff.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'content': {
            'type': 'string',
            'description':
                'The fact to remember, in a short declarative sentence.',
          },
          'tags': {
            'type': 'string',
            'description': 'Optional comma-separated tags, e.g. "prefs,food".',
          },
        },
        'required': ['content'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final content = (args['content'] as String?)?.trim() ?? '';
    if (content.isEmpty) {
      return ToolResult.error('"content" must not be empty.');
    }
    final tags = (args['tags'] as String?)?.trim();
    final id = context.services.memory.remember(
      userId: context.userId,
      channelId: context.channelId,
      content: content,
      source: 'explicit',
      tags: (tags == null || tags.isEmpty) ? null : tags,
    );
    return ToolResult.ok({'id': id, 'status': 'remembered'});
  }
}
