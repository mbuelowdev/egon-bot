import '../tool.dart';

class RecallMemoriesTool extends Tool {
  @override
  String get name => 'recall_memories';

  @override
  String get description =>
      'Searches long-term memory with a keyword query (FTS). Use when you need '
      'facts that may have been stored earlier and are not already in '
      '"Things you remember". Returns id, content, source, created_at.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'query': {
            'type': 'string',
            'description': 'Keywords to search for.',
          },
          'limit': {
            'type': 'integer',
            'description': 'Max results (default 5, max 20).',
          },
        },
        'required': ['query'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final query = (args['query'] as String?)?.trim() ?? '';
    if (query.isEmpty) {
      return ToolResult.error('"query" must not be empty.');
    }
    final rawLimit = args['limit'];
    final limit = switch (rawLimit) {
      int n => n.clamp(1, 20),
      num n => n.toInt().clamp(1, 20),
      _ => 5,
    };
    final hits = context.services.memory.search(query, limit: limit);
    return ToolResult.ok({
      'query': query,
      'memories': [
        for (final m in hits)
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
