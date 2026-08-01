import 'dart:io';

import 'package:egon_bot/src/contacts/contact.dart';
import 'package:egon_bot/src/media/attachments.dart';
import 'package:egon_bot/src/tools/builtin/send_to_contact_tool.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('ContactsService.resolve', () {
    test('exact name and alias matches', () {
      final services = testServices(tools: []);
      services.contacts.add(
        name: 'Jan Müller',
        aliases: ['jan', 'jan m'],
        discordUserId: '111',
      );
      services.contacts.add(
        name: 'Jan Klein',
        aliases: ['jan k'],
        discordUserId: '222',
      );

      final exact = services.contacts.resolve('jan müller');
      expect(exact, isA<ContactResolved>());
      expect((exact as ContactResolved).contact.discordUserId, '111');

      final alias = services.contacts.resolve('jan k');
      expect(alias, isA<ContactResolved>());
      expect((alias as ContactResolved).contact.name, 'Jan Klein');
    });

    test('ambiguous partial match asks back', () {
      final services = testServices(tools: []);
      services.contacts.add(name: 'Jan Müller', aliases: ['jan']);
      services.contacts.add(name: 'Jan Klein', aliases: ['jan']);

      final result = services.contacts.resolve('jan');
      expect(result, isA<ContactAmbiguous>());
      final ask = (result as ContactAmbiguous).askBack('jan');
      expect(ask, contains('Which "jan"'));
      expect(ask, contains('Jan Müller'));
      expect(ask, contains('Jan Klein'));
    });

    test('unknown name is not found', () {
      final services = testServices(tools: []);
      final result = services.contacts.resolve('Nobody');
      expect(result, isA<ContactNotFound>());
    });
  });

  group('send_to_contact tool', () {
    test('ambiguous contact returns ask-back without preview approval',
        () async {
      final services = testServices(tools: [SendToContactTool()]);
      services.contacts.add(
        name: 'Jan Müller',
        aliases: ['jan'],
        discordUserId: '111',
      );
      services.contacts.add(
        name: 'Jan Klein',
        aliases: ['jan'],
        discordUserId: '222',
      );

      final tool = SendToContactTool();
      final preview = await tool.previewChange(
        contextFor(services, owner: true),
        {'contact_query': 'jan'},
      );
      expect(preview, isNull);

      final result = await tool.execute(
        contextFor(services, owner: true),
        {'contact_query': 'jan'},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('Which "jan"'));
    });

    test('resolved contact with file gets a delivery preview', () async {
      final services = testServices(tools: [SendToContactTool()]);
      services.contacts.add(
        name: 'Jan Müller',
        aliases: ['jan'],
        discordUserId: '111',
      );
      services.attachments.storeBytes(
        channelId: '42',
        messageId: '1',
        userId: ownerId,
        name: 'report.pdf',
        mime: 'application/pdf',
        bytes: List<int>.filled(100, 1),
      );

      final preview = await SendToContactTool().previewChange(
        contextFor(services, owner: true),
        {'contact_query': 'jan', 'file_ref': 'this'},
      );
      expect(preview, isNotNull);
      expect(preview!, contains('Jan Müller'));
      expect(preview, contains('report.pdf'));
    });

    test('resolves vault binary attachments as documents', () async {
      final services = testServices(tools: []);
      final png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      File('${services.config.obsidianVaultDir}/shot.png')
          .writeAsBytesSync(png);

      final doc = await services.contacts.resolveDocument(
        channelId: '42',
        fileRef: 'shot.png',
      );
      expect(doc, isNotNull);
      expect(doc!.name, 'shot.png');
      expect(doc.mime, 'image/png');
      expect(doc.source, 'vault:shot.png');
      expect(doc.bytes, png);
    });
  });

  group('AttachmentStore size cap', () {
    test('rejects oversize byte payloads', () {
      final services = testServices(tools: []);
      // testConfig maxAttachmentMb = 1
      expect(
        () => services.attachments.storeBytes(
          channelId: '42',
          messageId: '1',
          userId: ownerId,
          name: 'big.bin',
          mime: 'application/octet-stream',
          bytes: List<int>.filled(1024 * 1024 + 1, 0),
        ),
        throwsA(isA<AttachmentTooLargeException>()),
      );
    });

    test('stores and lists recent files', () {
      final services = testServices(tools: []);
      final a = services.attachments.storeBytes(
        channelId: '42',
        messageId: '1',
        userId: ownerId,
        name: 'a.txt',
        mime: 'text/plain',
        bytes: 'hello'.codeUnits,
      );
      final b = services.attachments.storeBytes(
        channelId: '42',
        messageId: '2',
        userId: ownerId,
        name: 'b.txt',
        mime: 'text/plain',
        bytes: 'world'.codeUnits,
      );
      expect(services.attachments.mostRecentInChannel('42')?.id, b.id);
      expect(File(a.path).readAsStringSync(), 'hello');
      expect(services.attachments.recentInChannel('42').length, 2);
    });
  });
}
