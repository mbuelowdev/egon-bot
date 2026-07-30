import '../tool.dart';

class ForgetMemoryTool extends Tool {
  @override
  String get name => 'forget_memory';

  @override
  String get description =>
      'Deletes one memory by numeric id. Use after list_memories or '
      'recall_memories when the owner asks to forget something.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'id': {
            'type': 'integer',
            'description': 'Memory id from recall_memories / list_memories.',
          },
        },
        'required': ['id'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final raw = args['id'];
    final id = switch (raw) {
      int n => n,
      num n => n.toInt(),
      String s => int.tryParse(s),
      _ => null,
    };
    if (id == null) {
      return ToolResult.error('"id" must be an integer.');
    }
    final removed = context.services.memory.forget(id);
    return ToolResult.ok({
      'id': id,
      'status': removed ? 'forgotten' : 'not_found',
    });
  }
}
