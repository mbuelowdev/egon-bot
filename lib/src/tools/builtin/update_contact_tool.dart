import '../tool.dart';

class UpdateContactTool extends Tool {
  @override
  String get name => 'update_contact';

  @override
  String get description =>
      'Updates an existing address-book contact by id. Owner-only. Use to fix '
      'names, aliases, Discord ids, or notes.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'id': {
            'type': 'integer',
            'description': 'Contact id from list_contacts.',
          },
          'name': {'type': 'string'},
          'aliases': {
            'type': 'string',
            'description': 'Comma-separated aliases (replaces existing).',
          },
          'discord_user_id': {'type': 'string'},
          'notes': {'type': 'string'},
        },
        'required': ['id'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final idRaw = args['id'];
    final id = idRaw is int ? idRaw : int.tryParse(idRaw?.toString() ?? '');
    if (id == null) {
      return ToolResult.error('"id" must be an integer.');
    }
    List<String>? aliases;
    if (args.containsKey('aliases')) {
      final raw = (args['aliases'] as String?)?.trim() ?? '';
      aliases = raw.isEmpty
          ? <String>[]
          : raw
              .split(',')
              .map((s) => s.trim())
              .where((s) => s.isNotEmpty)
              .toList();
    }
    final updated = context.services.contacts.update(
      id: id,
      name: args['name'] as String?,
      aliases: aliases,
      discordUserId: args['discord_user_id'] as String?,
      notes: args['notes'] as String?,
    );
    if (updated == null) {
      return ToolResult.error('No contact with id $id.');
    }
    return ToolResult.ok({'contact': updated.toJson(), 'status': 'updated'});
  }
}
