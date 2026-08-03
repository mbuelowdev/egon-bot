import '../tool.dart';

/// Starts a Cursor Cloud Agent self-extension (plan → approve → PR) (§6.4).
class ExtendSelfTool extends Tool {
  @override
  String get name => 'extend_self';

  @override
  String get description =>
      'Starts a durable self-extension via Cursor Cloud Agents: plans the '
      'change, asks Michael to Approve/Reject (or reply with revision notes), '
      'then implements on a PR with a deployment.json version bump. '
      'Use for real capabilities (multi-file, tests, deps, deploy). '
      'For a trivial single-file Dart tool with no deploy, prefer create_tool.';

  @override
  ToolAccess get access => ToolAccess.dangerous;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'description': {
            'type': 'string',
            'description':
                'What to build or change, including expected behavior.',
          },
          'title': {
            'type': 'string',
            'description': 'Optional short label for the extension.',
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
    final title = args['title']?.toString().trim();
    final result = await context.services.selfExtensionRunner.start(
      createdBy: context.userId,
      channelId: context.channelId,
      description: description,
      title: (title == null || title.isEmpty) ? null : title,
    );
    if (!result.isOk) {
      return ToolResult.error(result.error!);
    }
    final ext = result.extension!;
    return ToolResult.ok({
      'id': ext.id,
      'status': ext.status,
      'message':
          'Self-extension #${ext.id} started. A Cursor plan will be posted '
              'in this channel for Michael to Approve/Reject (or reply with '
              'change requests).',
    });
  }
}
