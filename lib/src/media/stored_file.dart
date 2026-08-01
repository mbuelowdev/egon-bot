/// A downloaded attachment or job artifact recorded in the `files` table (§10).
class StoredFile {
  StoredFile({
    required this.id,
    required this.createdAt,
    required this.channelId,
    required this.messageId,
    required this.userId,
    required this.name,
    required this.mime,
    required this.path,
  });

  final int id;
  final DateTime createdAt;
  final String channelId;
  final String messageId;
  final String userId;
  final String name;
  final String mime;
  final String path;
}
