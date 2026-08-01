import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../config.dart';
import '../storage/database.dart';
import 'stored_file.dart';

class AttachmentTooLargeException implements Exception {
  AttachmentTooLargeException(this.name, this.sizeBytes, this.maxBytes);
  final String name;
  final int sizeBytes;
  final int maxBytes;

  @override
  String toString() =>
      'Attachment "$name" is ${sizeBytes} bytes; max is $maxBytes '
      '(${maxBytes ~/ (1024 * 1024)} MB).';
}

/// Downloads Discord attachments into `$DATA_DIR/files/` and records rows (§10).
class AttachmentStore {
  AttachmentStore({
    required AppDatabase database,
    required this.config,
    http.Client? httpClient,
  })  : _db = database,
        _http = httpClient ?? http.Client();

  final AppDatabase _db;
  final Config config;
  final http.Client _http;

  Directory get filesDir => Directory('${config.dataDir}/files');

  int get maxBytes => config.maxAttachmentMb * 1024 * 1024;

  /// Downloads [url] when ≤ cap, writes under [filesDir], inserts a row.
  Future<StoredFile> storeDownload({
    required String channelId,
    required String messageId,
    required String userId,
    required String name,
    required String mime,
    required Uri url,
    int? knownSize,
  }) async {
    if (knownSize != null && knownSize > maxBytes) {
      throw AttachmentTooLargeException(name, knownSize, maxBytes);
    }

    final response = await _http.get(url);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException(
        'Download failed (${response.statusCode}) for $name',
        uri: url,
      );
    }
    final bytes = response.bodyBytes;
    if (bytes.length > maxBytes) {
      throw AttachmentTooLargeException(name, bytes.length, maxBytes);
    }

    return storeBytes(
      channelId: channelId,
      messageId: messageId,
      userId: userId,
      name: name,
      mime: mime,
      bytes: bytes,
    );
  }

  /// Persists raw [bytes] (used for job artifacts and URL fetches).
  StoredFile storeBytes({
    required String channelId,
    required String messageId,
    required String userId,
    required String name,
    required String mime,
    required List<int> bytes,
  }) {
    if (bytes.length > maxBytes) {
      throw AttachmentTooLargeException(name, bytes.length, maxBytes);
    }
    filesDir.createSync(recursive: true);
    final safe = _safeFileName(name);
    final stamp = DateTime.now().toUtc().millisecondsSinceEpoch;
    final rel = '${channelId}_${stamp}_$safe';
    final dest = File('${filesDir.path}/$rel');
    dest.writeAsBytesSync(bytes, flush: true);

    final createdAt = DateTime.now().toUtc();
    _db.db.execute(
      'INSERT INTO files (created_at, channel_id, message_id, user_id, name, '
      'mime, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        createdAt.toIso8601String(),
        channelId,
        messageId,
        userId,
        name,
        mime,
        dest.path,
      ],
    );
    final id = _db.db.lastInsertRowId;
    return StoredFile(
      id: id,
      createdAt: createdAt,
      channelId: channelId,
      messageId: messageId,
      userId: userId,
      name: name,
      mime: mime,
      path: dest.path,
    );
  }

  StoredFile? byId(int id) {
    final rows = _db.db.select('SELECT * FROM files WHERE id = ?', [id]);
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  /// Most recent file in [channelId], optionally matching a name substring.
  StoredFile? mostRecentInChannel(String channelId, {String? nameHint}) {
    final rows = _db.db.select(
      'SELECT * FROM files WHERE channel_id = ? ORDER BY id DESC LIMIT 50',
      [channelId],
    );
    if (rows.isEmpty) return null;
    if (nameHint == null || nameHint.trim().isEmpty) {
      return _fromRow(rows.first);
    }
    final hint = nameHint.trim().toLowerCase();
    for (final row in rows) {
      final name = (row['name'] as String).toLowerCase();
      if (name.contains(hint) || hint.contains(name)) {
        return _fromRow(row);
      }
    }
    // Numeric id?
    final asId = int.tryParse(hint);
    if (asId != null) {
      for (final row in rows) {
        if (row['id'] == asId) return _fromRow(row);
      }
    }
    return null;
  }

  List<StoredFile> recentInChannel(String channelId, {int limit = 5}) {
    final rows = _db.db.select(
      'SELECT * FROM files WHERE channel_id = ? ORDER BY id DESC LIMIT ?',
      [channelId, limit],
    );
    return [for (final row in rows) _fromRow(row)];
  }

  /// Reads text-like content (txt/md/json/csv or pdf via pdftotext).
  Future<String> readTextContent(StoredFile file) async {
    final path = file.path;
    final lower = file.name.toLowerCase();
    final mime = file.mime.toLowerCase();

    final isPdf = lower.endsWith('.pdf') || mime.contains('pdf');
    if (isPdf) {
      final result = await Process.run('pdftotext', ['-layout', path, '-']);
      if (result.exitCode != 0) {
        throw StateError(
          'pdftotext failed: ${result.stderr}'.trim(),
        );
      }
      return (result.stdout as String).trim();
    }

    final textLike = lower.endsWith('.txt') ||
        lower.endsWith('.md') ||
        lower.endsWith('.json') ||
        lower.endsWith('.csv') ||
        mime.startsWith('text/') ||
        mime.contains('json') ||
        mime.contains('markdown');
    if (!textLike) {
      throw StateError(
        'File "${file.name}" is not a text-like type (mime: ${file.mime}).',
      );
    }
    return File(path).readAsStringSync();
  }

  Uint8List readBytes(StoredFile file) =>
      Uint8List.fromList(File(file.path).readAsBytesSync());

  StoredFile _fromRow(Map<String, Object?> row) => StoredFile(
        id: row['id'] as int,
        createdAt: DateTime.parse(row['created_at'] as String),
        channelId: row['channel_id'] as String,
        messageId: row['message_id'] as String,
        userId: row['user_id'] as String,
        name: row['name'] as String,
        mime: row['mime'] as String,
        path: row['path'] as String,
      );

  static String _safeFileName(String name) {
    final base = name.split(RegExp(r'[/\\]')).last;
    final cleaned = base.replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '_');
    if (cleaned.isEmpty) return 'file.bin';
    return cleaned.length > 120
        ? cleaned.substring(cleaned.length - 120)
        : cleaned;
  }
}
