/// An address-book entry (§14).
class Contact {
  Contact({
    required this.id,
    required this.createdAt,
    required this.name,
    required this.aliases,
    required this.discordUserId,
    required this.notes,
  });

  final int id;
  final DateTime createdAt;
  final String name;
  final List<String> aliases;
  final String? discordUserId;
  final String? notes;

  String get aliasesCsv => aliases.join(',');

  Map<String, Object?> toJson() => {
        'id': id,
        'name': name,
        'aliases': aliases,
        'discord_user_id': discordUserId,
        'notes': notes,
      };
}

/// Result of resolving a contact query.
sealed class ContactResolution {}

class ContactResolved extends ContactResolution {
  ContactResolved(this.contact);
  final Contact contact;
}

class ContactAmbiguous extends ContactResolution {
  ContactAmbiguous(this.matches);
  final List<Contact> matches;

  String askBack(String query) {
    final names = matches.map((c) => c.name).join(', ');
    return 'Which "$query" do you mean? I know: $names.';
  }
}

class ContactNotFound extends ContactResolution {
  ContactNotFound(this.query);
  final String query;

  String askBack() =>
      'I don\'t have anyone matching "$query" in the address book. '
      'Add them with add_contact, or give me a clearer name.';
}
