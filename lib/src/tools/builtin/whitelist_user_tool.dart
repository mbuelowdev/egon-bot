import '../tool.dart';

class WhitelistUserTool extends Tool {
  @override
  String get name => 'whitelist_user';

  @override
  String get description =>
      'Grants a Discord user access to the bot\'s standard features. Takes '
      'the numeric Discord user id. Owner only.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'user_id': {
            'type': 'string',
            'description':
                'Numeric Discord user id, e.g. "116152966632735745".',
          },
          'note': {
            'type': 'string',
            'description': 'Optional note, e.g. the person\'s name.',
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
    if (!RegExp(r'^\d{5,25}$').hasMatch(userId)) {
      return ToolResult.error(
        '"user_id" must be a numeric Discord user id.',
      );
    }
    final added = context.services.whitelist.add(
      userId,
      addedBy: context.userId,
      note: (args['note'] as String?)?.trim(),
    );
    if (!added) {
      return ToolResult.ok({
        'user_id': userId,
        'status': 'already whitelisted',
      });
    }
    return ToolResult.ok({'user_id': userId, 'status': 'whitelisted'});
  }
}
