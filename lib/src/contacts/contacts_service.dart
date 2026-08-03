import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:nyxx/nyxx.dart';

import '../discord/discord_actions.dart';
import '../integrations/obsidian_vault.dart';
import '../media/attachments.dart';
import '../media/stored_file.dart';
import '../storage/database.dart';
import 'contact.dart';

/// Address book + name/document resolution + DM delivery (§14).
class ContactsService {
  ContactsService({
    required AppDatabase database,
    required this.attachments,
    required this.vault,
    http.Client? httpClient,
  })  : _db = database,
        _http = httpClient ?? http.Client();

  final AppDatabase _db;
  final AttachmentStore attachments;
  final ObsidianVault vault;
  final http.Client _http;

  NyxxGateway? _client;

  void attachClient(NyxxGateway client) => _client = client;

  void detachClient() => _client = null;

  Contact add({
    required String name,
    List<String> aliases = const [],
    String? discordUserId,
    String? notes,
  }) {
    final trimmed = name.trim();
    if (trimmed.isEmpty) {
      throw ArgumentError('name must not be empty');
    }
    final createdAt = DateTime.now().toUtc();
    final aliasCsv =
        aliases.map((a) => a.trim()).where((a) => a.isNotEmpty).join(',');
    final discord = discordUserId?.trim();
    final noteText = notes?.trim();
    _db.db.execute(
      'INSERT INTO contacts (created_at, name, aliases, discord_user_id, notes) '
      'VALUES (?, ?, ?, ?, ?)',
      [
        createdAt.toIso8601String(),
        trimmed,
        aliasCsv.isEmpty ? null : aliasCsv,
        (discord == null || discord.isEmpty) ? null : discord,
        (noteText == null || noteText.isEmpty) ? null : noteText,
      ],
    );
    return byId(_db.db.lastInsertRowId)!;
  }

  Contact? byId(int id) {
    final rows = _db.db.select('SELECT * FROM contacts WHERE id = ?', [id]);
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  Contact? update({
    required int id,
    String? name,
    List<String>? aliases,
    String? discordUserId,
    bool clearDiscordUserId = false,
    String? notes,
    bool clearNotes = false,
  }) {
    final existing = byId(id);
    if (existing == null) return null;
    final newName =
        name?.trim().isNotEmpty == true ? name!.trim() : existing.name;
    final newAliases = aliases ?? existing.aliases;
    final newDiscord =
        clearDiscordUserId ? null : (discordUserId ?? existing.discordUserId);
    final newNotes = clearNotes ? null : (notes ?? existing.notes);
    _db.db.execute(
      'UPDATE contacts SET name = ?, aliases = ?, discord_user_id = ?, '
      'notes = ? WHERE id = ?',
      [
        newName,
        newAliases.isEmpty ? null : newAliases.join(','),
        newDiscord,
        newNotes,
        id,
      ],
    );
    return byId(id);
  }

  List<Contact> list() {
    final rows =
        _db.db.select('SELECT * FROM contacts ORDER BY name COLLATE NOCASE');
    return [for (final row in rows) _fromRow(row)];
  }

  /// Case-insensitive match on name + aliases (§14).
  ContactResolution resolve(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return ContactNotFound(query);

    final all = list();
    final exact = <Contact>[];
    final partial = <Contact>[];
    for (final c in all) {
      final names = [c.name, ...c.aliases]
          .map((s) => s.trim().toLowerCase())
          .where((s) => s.isNotEmpty)
          .toList();
      if (names.any((n) => n == q)) {
        exact.add(c);
      } else if (names.any((n) => n.contains(q) || q.contains(n))) {
        partial.add(c);
      }
    }

    final hits = exact.isNotEmpty ? exact : partial;
    if (hits.isEmpty) return ContactNotFound(query);
    if (hits.length == 1) return ContactResolved(hits.single);
    return ContactAmbiguous(hits);
  }

  /// Resolves a document reference for send_to_contact (§14).
  ///
  /// Order: recent attachment (default / "this") → URL → vault file →
  /// stored file id/name in channel. Returns null when [fileRef] is empty
  /// and there is no recent attachment (message-only send).
  Future<ResolvedDocument?> resolveDocument({
    required String channelId,
    String? fileRef,
    bool requireFile = false,
  }) async {
    final ref = fileRef?.trim() ?? '';
    if (ref.isEmpty ||
        ref.toLowerCase() == 'this' ||
        ref.toLowerCase() == 'this document' ||
        ref.toLowerCase() == 'latest') {
      final recent = attachments.mostRecentInChannel(channelId);
      if (recent == null) {
        if (requireFile || ref.isNotEmpty) {
          throw StateError('No recent attachment in this channel.');
        }
        return null;
      }
      return ResolvedDocument.fromStored(recent);
    }

    if (ref.startsWith('http://') || ref.startsWith('https://')) {
      final uri = Uri.parse(ref);
      final response = await _http.get(uri);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError('Failed to fetch URL (${response.statusCode}).');
      }
      final name =
          uri.pathSegments.isNotEmpty ? uri.pathSegments.last : 'download.bin';
      final mime =
          response.headers['content-type'] ?? 'application/octet-stream';
      final stored = attachments.storeBytes(
        channelId: channelId,
        messageId: 'url-fetch',
        userId: 'bot',
        name: name.isEmpty ? 'download.bin' : name,
        mime: mime.split(';').first.trim(),
        bytes: response.bodyBytes,
      );
      return ResolvedDocument.fromStored(stored);
    }

    // Vault path (markdown note or binary attachment)?
    if (vault.isAvailable) {
      try {
        final path = vault.resolveExistingPath(ref);
        final name = path.split('/').last;
        final bytes = vault.readBytes(path);
        if (bytes.length > attachments.maxBytes) {
          throw AttachmentTooLargeException(
            name,
            bytes.length,
            attachments.maxBytes,
          );
        }
        return ResolvedDocument(
          name: name,
          mime: ObsidianVault.mimeForName(name),
          bytes: bytes,
          source: 'vault:$path',
        );
      } on ObsidianPathError catch (error) {
        if (error.message.startsWith('Ambiguous file')) {
          throw StateError(error.message);
        }
        // fall through
      } on ObsidianUnavailableError {
        // fall through
      }
    }

    // Stored file by id or name hint in this channel.
    final asId = int.tryParse(ref);
    if (asId != null) {
      final byId = attachments.byId(asId);
      if (byId != null) return ResolvedDocument.fromStored(byId);
    }
    final byName = attachments.mostRecentInChannel(channelId, nameHint: ref);
    if (byName != null) return ResolvedDocument.fromStored(byName);

    throw StateError(
      'Could not resolve document "$ref". Use a recent attachment, URL, '
      'vault path, or file id.',
    );
  }

  /// Posts optional [doc] + [message] into [channelId] (current chat).
  Future<DeliveryResult> deliverToChannel({
    required String channelId,
    ResolvedDocument? doc,
    String? message,
  }) async {
    final client = _client;
    if (client == null) {
      throw StateError('Discord client not attached.');
    }
    final trimmed = message?.trim() ?? '';
    if (doc == null && trimmed.isEmpty) {
      throw StateError('Need a file or a message to send.');
    }

    final attachmentBuilders = doc == null
        ? <AttachmentBuilder>[]
        : [AttachmentBuilder(data: doc.bytes, fileName: doc.name)];

    final channel =
        client.channels[Snowflake.parse(channelId)] as PartialTextChannel;
    await channel.sendMessage(
      MessageBuilder(
        content: trimmed.isEmpty
            ? null
            : (trimmed.length > discordMessageLimit
                ? trimmed.substring(0, discordMessageLimit)
                : trimmed),
        attachments: attachmentBuilders,
      ),
    );
    final postedWithCaption = doc != null && trimmed.isNotEmpty;
    return DeliveryResult(
      mode: 'channel',
      recipientId: channelId,
      fileName: doc?.name,
      message: doc == null
          ? 'Posted message in this channel.'
          : postedWithCaption
              ? 'Posted ${doc.name} in this channel with caption. '
                  'Leave your final chat reply empty — do not repeat the caption.'
              : 'Posted ${doc.name} in this channel.',
    );
  }

  /// Delivers optional [doc] + [message] to [contact] via DM, with channel
  /// fallback when DM is impossible. At least one of doc/message is required.
  Future<DeliveryResult> deliver({
    required Contact contact,
    required String originChannelId,
    ResolvedDocument? doc,
    String? message,
  }) async {
    final client = _client;
    if (client == null) {
      throw StateError('Discord client not attached.');
    }
    final discordId = contact.discordUserId;
    if (discordId == null || discordId.isEmpty) {
      throw StateError(
        'Contact "${contact.name}" has no discord_user_id — update_contact first.',
      );
    }

    final trimmed = message?.trim() ?? '';
    if (doc == null && trimmed.isEmpty) {
      throw StateError('Need a file or a message to send.');
    }
    final body =
        trimmed.isNotEmpty ? trimmed : 'File from Michael: ${doc!.name}';

    final attachmentBuilders = doc == null
        ? <AttachmentBuilder>[]
        : [AttachmentBuilder(data: doc.bytes, fileName: doc.name)];

    try {
      final dm = await client.users.createDm(Snowflake.parse(discordId));
      await dm.sendMessage(
        MessageBuilder(
          content: body.length > discordMessageLimit
              ? body.substring(0, discordMessageLimit)
              : body,
          attachments: attachmentBuilders,
        ),
      );
      return DeliveryResult(
        mode: 'dm',
        recipientId: discordId,
        fileName: doc?.name,
        message: 'Delivered to ${contact.name} via DM.',
      );
    } catch (error) {
      stderr
          .writeln('DM to $discordId failed, falling back to channel: $error');
      final channel = client.channels[Snowflake.parse(originChannelId)]
          as PartialTextChannel;
      await channel.sendMessage(
        MessageBuilder(
          content: 'Could not DM <@$discordId> (${contact.name}) — '
              'Discord only allows DMs when you share a server. '
              'Posting here instead:\n\n$body',
          attachments: attachmentBuilders,
        ),
      );
      return DeliveryResult(
        mode: 'channel_fallback',
        recipientId: discordId,
        fileName: doc?.name,
        message: 'DM failed; posted in this channel for ${contact.name}.',
      );
    }
  }

  Contact _fromRow(Map<String, Object?> row) {
    final rawAliases = row['aliases'] as String?;
    return Contact(
      id: row['id'] as int,
      createdAt: DateTime.parse(row['created_at'] as String),
      name: row['name'] as String,
      aliases: rawAliases == null || rawAliases.trim().isEmpty
          ? const []
          : rawAliases
              .split(',')
              .map((s) => s.trim())
              .where((s) => s.isNotEmpty)
              .toList(),
      discordUserId: row['discord_user_id'] as String?,
      notes: row['notes'] as String?,
    );
  }
}

class ResolvedDocument {
  ResolvedDocument({
    required this.name,
    required this.mime,
    required this.bytes,
    required this.source,
    this.storedFileId,
  });

  factory ResolvedDocument.fromStored(StoredFile file) {
    final bytes = File(file.path).readAsBytesSync();
    return ResolvedDocument(
      name: file.name,
      mime: file.mime,
      bytes: Uint8List.fromList(bytes),
      source: 'file:#${file.id}',
      storedFileId: file.id,
    );
  }

  final String name;
  final String mime;
  final Uint8List bytes;
  final String source;
  final int? storedFileId;

  int get sizeBytes => bytes.length;
}

class DeliveryResult {
  DeliveryResult({
    required this.mode,
    required this.recipientId,
    required this.fileName,
    required this.message,
  });

  final String mode;
  final String recipientId;
  final String? fileName;
  final String message;
}
