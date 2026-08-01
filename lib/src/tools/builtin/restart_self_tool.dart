import '../tool.dart';

/// Asks the supervisor to restart the bot process (exit 42) (§6.4).
class RestartSelfTool extends Tool {
  @override
  String get name => 'restart_self';

  @override
  String get description =>
      'Restarts the bot process via the supervisor (exit code 42). Use after '
      'manual tool edits on the host, or when a clean reload is needed. '
      'Do NOT use for ordinary conversation.';

  @override
  ToolAccess get access => ToolAccess.dangerous;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'reason': {
            'type': 'string',
            'description': 'Optional short reason recorded in the tool result.',
          },
        },
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final reason = args['reason']?.toString().trim();
    context.services.requestRestart();
    return ToolResult.ok({
      'restarting': true,
      if (reason != null && reason.isNotEmpty) 'reason': reason,
      'message': 'Restart requested. Coming back shortly.',
    });
  }
}
