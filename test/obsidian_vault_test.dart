import 'dart:io';

import 'package:egon_bot/src/integrations/obsidian_vault.dart';
import 'package:egon_bot/src/tools/builtin/obsidian_write_note_tool.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  late Directory tmp;
  late ObsidianVault vault;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('egon-vault-');
    vault = ObsidianVault(root: tmp.path, available: true);
  });

  tearDown(() {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  group('path sandbox', () {
    test('rejects .. traversal', () {
      expect(
        () => vault.resolveFileForWrite('../outside.md'),
        throwsA(isA<ObsidianPathError>()),
      );
      expect(
        () => vault.resolveFileForWrite('Inbox/../../etc/passwd'),
        throwsA(isA<ObsidianPathError>()),
      );
    });

    test('rejects absolute paths', () {
      expect(
        () => vault.resolveFileForWrite('/etc/passwd'),
        throwsA(isA<ObsidianPathError>()),
      );
    });

    test('rejects symlink escape', () {
      final outside = Directory.systemTemp.createTempSync('egon-outside-');
      addTearDown(() => outside.deleteSync(recursive: true));
      final target = File('${outside.path}/secret.md')
        ..writeAsStringSync('nope');
      Link('${tmp.path}/escape.md').createSync(target.path);

      expect(
        () => vault.readNote('escape.md'),
        throwsA(isA<ObsidianPathError>()),
      );
    });
  });

  group('atomic write', () {
    test('creates parent dirs and replaces content', () {
      vault.writeNote('Inbox/Research/Topic.md', 'v1');
      expect(vault.readNote('Inbox/Research/Topic.md'), 'v1');
      vault.writeNote('Inbox/Research/Topic.md', 'v2');
      expect(vault.readNote('Inbox/Research/Topic.md'), 'v2');
      // No leftover temp files.
      final leftovers = Directory('${tmp.path}/Inbox/Research')
          .listSync()
          .whereType<File>()
          .where((f) => f.path.contains('.tmp.'));
      expect(leftovers, isEmpty);
    });

    test('append adds with newline separation', () {
      vault.writeNote('Inbox/Ideas.md', '# Ideas');
      vault.appendNote('Inbox/Ideas.md', '## 2026-07-31\nShip it');
      expect(
        vault.readNote('Inbox/Ideas.md'),
        '# Ideas\n## 2026-07-31\nShip it',
      );
    });
  });

  group('unifiedDiff', () {
    test('renders new file preview', () {
      final diff = ObsidianVault.unifiedDiff(
        path: 'Inbox/New.md',
        before: null,
        after: 'hello\nworld',
      );
      expect(diff, contains('--- a/Inbox/New.md (new file)'));
      expect(diff, contains('+hello'));
      expect(diff, contains('+world'));
    });

    test('renders line changes', () {
      final diff = ObsidianVault.unifiedDiff(
        path: 'a.md',
        before: 'one\ntwo\nthree',
        after: 'one\nTWO\nthree',
      );
      expect(diff, contains('-two'));
      expect(diff, contains('+TWO'));
      expect(diff, contains(' one'));
    });
  });

  group('list / search / delete', () {
    test('lists relative paths and searches case-insensitively', () {
      vault.writeNote('Inbox/a.md', 'Hello Wood');
      vault.writeNote('Inbox/b.md', 'nothing');
      expect(vault.listNotes(folder: 'Inbox'), ['Inbox/a.md', 'Inbox/b.md']);
      final hits = vault.searchNotes('wood');
      expect(hits.keys, ['Inbox/a.md']);
      expect(hits['Inbox/a.md'], ['Hello Wood']);
    });

    test('missing folder yields ObsidianPathError, not FileSystemException',
        () {
      expect(
        () => vault.listNotes(folder: '2 – Privat'),
        throwsA(
          isA<ObsidianPathError>().having(
            (e) => e.message,
            'message',
            'Folder not found: 2 – Privat',
          ),
        ),
      );
    });

    test('skips binary attachments when listing and searching', () {
      vault.writeNote('Idee.md', 'Projektidee: Holz');
      // PNG magic bytes — must not be decoded as UTF-8 during search.
      File('${tmp.path}/Screenshot_20250331-103548.png')
          .writeAsBytesSync([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      File('${tmp.path}/notes.pdf').writeAsBytesSync([0x25, 0x50, 0x44, 0x46]);

      expect(vault.listNotes(), ['Idee.md']);
      final hits = vault.searchNotes('Idee');
      expect(hits.keys, ['Idee.md']);
      expect(hits['Idee.md'], ['Projektidee: Holz']);
    });

    test('lists and resolves binary attachments', () {
      final png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      File('${tmp.path}/Screenshot_20250331-103548.png').writeAsBytesSync(png);
      File('${tmp.path}/Assets/photo.jpg')
        ..parent.createSync(recursive: true)
        ..writeAsBytesSync([0xFF, 0xD8, 0xFF]);
      vault.writeNote('note.md', 'text');

      expect(
        vault.listFiles(attachmentsOnly: true),
        ['Assets/photo.jpg', 'Screenshot_20250331-103548.png'],
      );
      expect(
        vault.listFiles(nameQuery: 'screenshot'),
        ['Screenshot_20250331-103548.png'],
      );
      expect(
        vault.resolveExistingPath('Screenshot_20250331-103548.png'),
        'Screenshot_20250331-103548.png',
      );
      expect(vault.readBytes('Assets/photo.jpg'), [0xFF, 0xD8, 0xFF]);
      expect(ObsidianVault.mimeForName('x.PNG'), 'image/png');
    });

    test('delete removes the file', () {
      vault.writeNote('gone.md', 'x');
      vault.deleteNote('gone.md');
      expect(
        () => vault.readNote('gone.md'),
        throwsA(isA<ObsidianPathError>()),
      );
    });
  });

  group('unavailable', () {
    test('tools report vault sync unavailable', () {
      final dead = ObsidianVault(root: tmp.path, available: false);
      expect(dead.isAvailable, isFalse);
      expect(
        () => dead.readNote('x.md'),
        throwsA(isA<ObsidianUnavailableError>()),
      );
    });
  });

  group('write tool preview', () {
    test('previewChange returns a unified diff for the owner', () async {
      final wired = testServices(tools: [ObsidianWriteNoteTool()]);
      File('${wired.config.obsidianVaultDir}/note.md').writeAsStringSync('old');

      final preview = await ObsidianWriteNoteTool().previewChange(
        contextFor(wired, owner: true),
        {'path': 'note.md', 'content': 'new'},
      );
      expect(preview, isNotNull);
      expect(preview!, contains('-old'));
      expect(preview, contains('+new'));
    });
  });
}
