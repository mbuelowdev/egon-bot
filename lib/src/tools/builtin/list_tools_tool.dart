import '../tool.dart';

/// Lets the model answer "what can you do?" accurately (§6.2).
class ListToolsTool extends Tool {
  @override
  String get name => 'list_tools';

  @override
  String get description =>
      'Lists every tool this bot has, with access level and description. '
      'Use when someone asks what you can do or which tools you have.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': <String, Object?>{},
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final tools = context.services.registry.all;
    return ToolResult.ok({
      'tools': [
        for (final tool in tools)
          {
            'name': tool.name,
            'access': tool.access.name,
            'origin': tool.origin,
            'description': tool.description,
          },
      ],
    });
  }
}
