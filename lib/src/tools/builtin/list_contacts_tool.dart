import '../tool.dart';

class ListContactsTool extends Tool {
  @override
  String get name => 'list_contacts';

  @override
  String get description =>
      'Lists everyone in the address book. Owner-only. Use before '
      'send_to_contact when you need to see names/aliases/ids.';

  @override
  ToolAccess get access => ToolAccess.personal;

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
    final contacts = context.services.contacts.list();
    return ToolResult.ok({
      'contacts': [for (final c in contacts) c.toJson()],
      'count': contacts.length,
    });
  }
}
