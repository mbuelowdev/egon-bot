import '../tool.dart';

class UnwhitelistUserTool extends Tool {
  @override
  String get name => 'unwhitelist_user';

  @override
  String get description =>
      'Revokes a Discord user\'s access to the bot\'s standard features. '
      'Takes the numeric Discord user id. Owner only.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'user_id': {
            'type': 'string',
            'description': 'Numeric Discord user id.',
          },
        },
        'required': ['user_id'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final userId = (args['user_id'] as String?)?.trim() ?? '';
    if (userId.isEmpty) {
      return ToolResult.error('"user_id" must not be empty.');
    }
    final removed = context.services.whitelist.remove(userId);
    return ToolResult.ok({
      'user_id': userId,
      'status': removed ? 'removed' : 'was not whitelisted',
    });
  }
}
