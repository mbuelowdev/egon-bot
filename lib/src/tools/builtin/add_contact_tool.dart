import '../tool.dart';

class AddContactTool extends Tool {
  @override
  String get name => 'add_contact';

  @override
  String get description =>
      'Adds a person to the address book. Owner-only. Use when Michael wants '
      'to remember someone for later document delivery (name, optional '
      'aliases, Discord user id, notes).';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'name': {
            'type': 'string',
            'description': 'Canonical display name, e.g. "Jan Müller".',
          },
          'aliases': {
            'type': 'string',
            'description':
                'Optional comma-separated aliases, e.g. "jan,jan m".',
          },
          'discord_user_id': {
            'type': 'string',
            'description': 'Discord snowflake for DM delivery.',
          },
          'notes': {
            'type': 'string',
            'description': 'Optional free-text notes.',
          },
        },
        'required': ['name'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final name = (args['name'] as String?)?.trim() ?? '';
    if (name.isEmpty) {
      return ToolResult.error('"name" must not be empty.');
    }
    final aliasesRaw = (args['aliases'] as String?)?.trim() ?? '';
    final aliases = aliasesRaw.isEmpty
        ? <String>[]
        : aliasesRaw
            .split(',')
            .map((s) => s.trim())
            .where((s) => s.isNotEmpty)
            .toList();
    try {
      final contact = context.services.contacts.add(
        name: name,
        aliases: aliases,
        discordUserId: args['discord_user_id'] as String?,
        notes: args['notes'] as String?,
      );
      return ToolResult.ok({'contact': contact.toJson(), 'status': 'added'});
    } catch (error) {
      return ToolResult.error('$error');
    }
  }
}
