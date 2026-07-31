import 'dart:io';
import 'dart:math';

/// Sandboxed access to the local Obsidian vault (ARCHITECTURE.md §13).
///
/// Every path is resolved against [root] and must stay inside it after
/// symlink/`..` resolution. Writes are atomic (temp file + rename).
class ObsidianVault {
  ObsidianVault({
    required String root,
    bool available = true,
  })  : root = Directory(root).absolute.path,
        _available = available;

  /// Absolute path to the vault root.
  final String root;

  bool _available;

  /// When false, note tools return "vault sync unavailable".
  bool get isAvailable => _available && Directory(root).existsSync();

  set available(bool value) => _available = value;

  static const unavailableMessage = 'vault sync unavailable';

  /// Resolves an existing [relative] path. Throws if missing or outside root.
  File resolveFile(String relative) {
    final file = resolveFileForWrite(relative);
    if (!file.existsSync()) {
      throw ObsidianPathError('Note not found: $relative');
    }
    final resolved = file.resolveSymbolicLinksSync();
    if (!_isInsideRoot(resolved)) {
      throw ObsidianPathError('Path escapes the vault: $relative');
    }
    return File(resolved);
  }

  /// Resolves [relative] for create/overwrite. The leaf may not exist yet.
  File resolveFileForWrite(String relative) {
    final cleaned = _normalizeRelative(relative);
    final candidate = File('$root${Platform.pathSeparator}$cleaned');
    var check = candidate.parent;
    while (!check.existsSync()) {
      final parent = check.parent;
      if (parent.path == check.path) break;
      check = parent;
    }
    final rootResolved = Directory(root).resolveSymbolicLinksSync();
    final resolvedParent =
        check.existsSync() ? check.resolveSymbolicLinksSync() : rootResolved;
    if (resolvedParent != rootResolved && !_isInsideRoot(resolvedParent)) {
      throw ObsidianPathError('Path escapes the vault: $relative');
    }
    final abs = candidate.absolute.path;
    if (abs != rootResolved && !_pathUnder(abs, rootResolved)) {
      throw ObsidianPathError('Path escapes the vault: $relative');
    }
    return candidate;
  }

  Directory resolveDir(String relative) {
    final cleaned = relative.trim().isEmpty ? '' : _normalizeRelative(relative);
    if (cleaned.isEmpty) {
      return Directory(Directory(root).resolveSymbolicLinksSync());
    }
    final dir = Directory('$root${Platform.pathSeparator}$cleaned');
    final resolved = dir.resolveSymbolicLinksSync();
    if (!_isInsideRoot(resolved)) {
      throw ObsidianPathError('Path escapes the vault: $relative');
    }
    return Directory(resolved);
  }

  String relativePath(FileSystemEntity entity) {
    final abs = entity is Link
        ? entity.path
        : (entity.existsSync()
            ? entity.resolveSymbolicLinksSync()
            : entity.absolute.path);
    final rootResolved = Directory(root).resolveSymbolicLinksSync();
    var rel = abs;
    if (rel.startsWith(rootResolved)) {
      rel = rel.substring(rootResolved.length);
    }
    if (rel.startsWith(Platform.pathSeparator)) {
      rel = rel.substring(1);
    }
    return rel.replaceAll('\\', '/');
  }

  /// Lists note-like files under [folder] (relative), recursively.
  List<String> listNotes({String? folder}) {
    _ensureAvailable();
    final dir = resolveDir(folder ?? '');
    if (!dir.existsSync()) {
      throw ObsidianPathError('Folder not found: ${folder ?? '/'}');
    }
    final notes = <String>[];
    for (final entity in dir.listSync(recursive: true, followLinks: false)) {
      if (entity is! File) continue;
      final name = entity.uri.pathSegments.isEmpty
          ? entity.path
          : entity.uri.pathSegments.last;
      if (name.startsWith('.')) continue;
      // Skip anything under a hidden directory segment.
      final rel = relativePath(entity);
      if (rel.split('/').any((p) => p.startsWith('.'))) continue;
      notes.add(rel);
    }
    notes.sort();
    return notes;
  }

  String readNote(String path) {
    _ensureAvailable();
    final file = resolveFile(path);
    if (!file.existsSync()) {
      throw ObsidianPathError('Note not found: $path');
    }
    return file.readAsStringSync();
  }

  /// Atomically writes [content] to [path] (create or overwrite).
  void writeNote(String path, String content) {
    _ensureAvailable();
    final file = resolveFileForWrite(path);
    file.parent.createSync(recursive: true);
    final tmp = File(
      '${file.path}.tmp.${DateTime.now().microsecondsSinceEpoch}.'
      '${Random().nextInt(1 << 32)}',
    );
    tmp.writeAsStringSync(content);
    tmp.renameSync(file.path);
  }

  /// Appends [content] to [path], creating the file if needed.
  /// Ensures a separating newline when the existing file doesn't end with one.
  void appendNote(String path, String content) {
    _ensureAvailable();
    final file = resolveFileForWrite(path);
    if (!file.existsSync()) {
      writeNote(path, content);
      return;
    }
    final existing = file.readAsStringSync();
    final separator = existing.isEmpty || existing.endsWith('\n') ? '' : '\n';
    writeNote(path, '$existing$separator$content');
  }

  void deleteNote(String path) {
    _ensureAvailable();
    final file = resolveFile(path);
    if (!file.existsSync()) {
      throw ObsidianPathError('Note not found: $path');
    }
    file.deleteSync();
  }

  /// Case-insensitive content search. Returns path → matching lines.
  Map<String, List<String>> searchNotes(String query, {int maxHits = 50}) {
    _ensureAvailable();
    final q = query.trim();
    if (q.isEmpty) return {};
    final lower = q.toLowerCase();
    final hits = <String, List<String>>{};
    var count = 0;
    for (final path in listNotes()) {
      final text = readNote(path);
      final matching = <String>[];
      for (final line in text.split('\n')) {
        if (line.toLowerCase().contains(lower)) {
          matching.add(line);
          count++;
          if (count >= maxHits) break;
        }
      }
      if (matching.isNotEmpty) {
        hits[path] = matching;
      }
      if (count >= maxHits) break;
    }
    return hits;
  }

  /// Unified diff of changing [path] from [before] to [after].
  static String unifiedDiff({
    required String path,
    required String? before,
    required String after,
  }) {
    final oldLines = (before ?? '').split('\n');
    final newLines = after.split('\n');
    // Drop a single trailing empty element from the final newline convention.
    if (oldLines.length > 1 && oldLines.last.isEmpty) {
      oldLines.removeLast();
    }
    if (newLines.length > 1 && newLines.last.isEmpty) {
      newLines.removeLast();
    }

    final label = before == null ? '$path (new file)' : path;
    final buf = StringBuffer()
      ..writeln('--- a/$label')
      ..writeln('+++ b/$path');

    if (before == null) {
      buf.writeln('@@ -0,0 +1,${newLines.length} @@');
      for (final line in newLines) {
        buf.writeln('+$line');
      }
      return buf.toString().trimRight();
    }

    // Simple line-oriented diff (LCS-based) good enough for approval previews.
    final ops = _diffOps(oldLines, newLines);
    if (ops.isEmpty) {
      buf.writeln('@@ (no changes) @@');
      return buf.toString().trimRight();
    }

    // Emit as one hunk for preview clarity.
    buf.writeln('@@ -1,${oldLines.length} +1,${newLines.length} @@');
    for (final op in ops) {
      switch (op.type) {
        case _DiffOpType.equal:
          buf.writeln(' ${op.line}');
        case _DiffOpType.remove:
          buf.writeln('-${op.line}');
        case _DiffOpType.add:
          buf.writeln('+${op.line}');
      }
    }
    return buf.toString().trimRight();
  }

  void _ensureAvailable() {
    if (!isAvailable) {
      throw ObsidianUnavailableError(unavailableMessage);
    }
  }

  String _normalizeRelative(String relative) {
    var s = relative.trim().replaceAll('\\', '/');
    if (s.isEmpty) {
      throw ObsidianPathError('Path must not be empty.');
    }
    if (s.startsWith('/')) {
      throw ObsidianPathError('Path must be vault-relative, not absolute.');
    }
    final parts = <String>[];
    for (final part in s.split('/')) {
      if (part.isEmpty || part == '.') continue;
      if (part == '..') {
        throw ObsidianPathError('Path escapes the vault: $relative');
      }
      parts.add(part);
    }
    if (parts.isEmpty) {
      throw ObsidianPathError('Path must not be empty.');
    }
    return parts.join(Platform.pathSeparator);
  }

  bool _isInsideRoot(String absolutePath) {
    final rootResolved = Directory(root).resolveSymbolicLinksSync();
    return absolutePath == rootResolved ||
        _pathUnder(absolutePath, rootResolved);
  }

  static bool _pathUnder(String absolutePath, String rootResolved) {
    final prefix = rootResolved.endsWith(Platform.pathSeparator)
        ? rootResolved
        : '$rootResolved${Platform.pathSeparator}';
    return absolutePath.startsWith(prefix);
  }
}

class ObsidianPathError implements Exception {
  ObsidianPathError(this.message);
  final String message;

  @override
  String toString() => message;
}

class ObsidianUnavailableError implements Exception {
  ObsidianUnavailableError(this.message);
  final String message;

  @override
  String toString() => message;
}

enum _DiffOpType { equal, add, remove }

class _DiffOp {
  _DiffOp(this.type, this.line);
  final _DiffOpType type;
  final String line;
}

List<_DiffOp> _diffOps(List<String> a, List<String> b) {
  final n = a.length;
  final m = b.length;
  final dp = List.generate(n + 1, (_) => List<int>.filled(m + 1, 0));
  for (var i = n - 1; i >= 0; i--) {
    for (var j = m - 1; j >= 0; j--) {
      if (a[i] == b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  final ops = <_DiffOp>[];
  var i = 0;
  var j = 0;
  while (i < n && j < m) {
    if (a[i] == b[j]) {
      ops.add(_DiffOp(_DiffOpType.equal, a[i]));
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.add(_DiffOp(_DiffOpType.remove, a[i]));
      i++;
    } else {
      ops.add(_DiffOp(_DiffOpType.add, b[j]));
      j++;
    }
  }
  while (i < n) {
    ops.add(_DiffOp(_DiffOpType.remove, a[i]));
    i++;
  }
  while (j < m) {
    ops.add(_DiffOp(_DiffOpType.add, b[j]));
    j++;
  }
  return ops;
}
