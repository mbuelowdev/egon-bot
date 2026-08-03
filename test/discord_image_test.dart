import 'dart:io';
import 'dart:typed_data';

import 'package:egon_bot/src/media/discord_image.dart';
import 'package:test/test.dart';

void main() {
  group('DiscordImage.isWebp', () {
    test('detects mime, extension, and RIFF magic', () {
      final magic = Uint8List.fromList([
        0x52,
        0x49,
        0x46,
        0x46,
        0,
        0,
        0,
        0,
        0x57,
        0x45,
        0x42,
        0x50,
      ]);
      expect(
        DiscordImage.isWebp(mime: 'image/webp', name: 'x.bin', bytes: const []),
        isTrue,
      );
      expect(
        DiscordImage.isWebp(mime: 'image/png', name: 'x.webp', bytes: const []),
        isTrue,
      );
      expect(
        DiscordImage.isWebp(
            mime: 'application/octet-stream', name: 'x.bin', bytes: magic),
        isTrue,
      );
      expect(
        DiscordImage.isWebp(
          mime: 'image/jpeg',
          name: 'x.jpg',
          bytes: Uint8List.fromList([0xFF, 0xD8, 0xFF]),
        ),
        isFalse,
      );
    });
  });

  group('DiscordImage.ensurePngCompatible', () {
    test('leaves non-webp unchanged', () async {
      final bytes = Uint8List.fromList([0xFF, 0xD8, 0xFF]);
      final out = await DiscordImage().ensurePngCompatible(
        name: 'photo.jpg',
        mime: 'image/jpeg',
        bytes: bytes,
      );
      expect(out.name, 'photo.jpg');
      expect(out.mime, 'image/jpeg');
      expect(out.bytes, bytes);
    });

    test('converts webp to png via ffmpeg', () async {
      final webp = await _makeTinyWebp();
      final out = await DiscordImage().ensurePngCompatible(
        name: 'shot.webp',
        mime: 'image/webp',
        bytes: webp,
      );
      expect(out.mime, 'image/png');
      expect(out.name, 'shot.png');
      expect(out.bytes.length, greaterThan(8));
      expect(out.bytes[0], 0x89);
      expect(out.bytes[1], 0x50); // P
      expect(out.bytes[2], 0x4E); // N
      expect(out.bytes[3], 0x47); // G
    });
  });
}

Future<Uint8List> _makeTinyWebp() async {
  final dir = await Directory.systemTemp.createTemp('egon-webp-fixture-');
  try {
    final png = File('${dir.path}/in.png');
    final webp = File('${dir.path}/out.webp');
    final makePng = await Process.run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=2x2',
      '-frames:v',
      '1',
      png.path,
    ]);
    expect(makePng.exitCode, 0, reason: '${makePng.stderr}');
    final makeWebp = await Process.run('ffmpeg', [
      '-y',
      '-i',
      png.path,
      webp.path,
    ]);
    expect(makeWebp.exitCode, 0, reason: '${makeWebp.stderr}');
    return Uint8List.fromList(await webp.readAsBytes());
  } finally {
    await dir.delete(recursive: true);
  }
}
