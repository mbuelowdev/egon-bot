import '../tool.dart';

class ListMemoriesTool extends Tool {
  @override
  String get name => 'list_memories';

  @override
  String get description =>
      'Pages through all stored memories, newest first. Owner DMs only — do '
      'not call this in a guild channel. Use when the owner asks what you '
      'remember in general.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'limit': {
            'type': 'integer',
            'description': 'Page size (default 20, max 50).',
          },
          'offset': {
            'type': 'integer',
            'description': 'Offset for paging (default 0).',
          },
        },
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    if (!context.isDm) {
      return ToolResult.error(
        'list_memories is only available in owner DMs. Tell the user to '
        'message you privately.',
      );
    }
    final limit = switch (args['limit']) {
      int n => n.clamp(1, 50),
      num n => n.toInt().clamp(1, 50),
      _ => 20,
    };
    final offset = switch (args['offset']) {
      int n => n < 0 ? 0 : n,
      num n => n.toInt() < 0 ? 0 : n.toInt(),
      _ => 0,
    };
    final memories = context.services.memory.list(limit: limit, offset: offset);
    return ToolResult.ok({
      'offset': offset,
      'limit': limit,
      'memories': [
        for (final m in memories)
          {
            'id': m.id,
            'content': m.content,
            'source': m.source,
            'created_at': m.createdAt.toUtc().toIso8601String(),
            'tags': m.tags,
          },
      ],
    });
  }
}
