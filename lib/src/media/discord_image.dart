import 'dart:io';
import 'dart:typed_data';

/// Discord message attachments preview JPEG/PNG/GIF reliably; WebP often does
/// not render as an inline image. Convert WebP bytes to PNG before posting.
class DiscordImage {
  DiscordImage({this.ffmpegPath = 'ffmpeg'});

  final String ffmpegPath;

  /// True when [mime] / [name] / magic bytes indicate WebP.
  static bool isWebp({
    required String mime,
    required String name,
    required List<int> bytes,
  }) {
    final lowerMime = mime.toLowerCase().split(';').first.trim();
    if (lowerMime == 'image/webp') return true;
    if (name.toLowerCase().endsWith('.webp')) return true;
    return _hasWebpMagic(bytes);
  }

  /// Returns PNG bytes + name/mime when [input] is WebP; otherwise unchanged.
  Future<({String name, String mime, Uint8List bytes})> ensurePngCompatible({
    required String name,
    required String mime,
    required Uint8List bytes,
  }) async {
    if (!isWebp(mime: mime, name: name, bytes: bytes)) {
      return (name: name, mime: mime, bytes: bytes);
    }
    final png = await _webpToPng(bytes);
    return (
      name: _withExtension(name, '.png'),
      mime: 'image/png',
      bytes: png,
    );
  }

  Future<Uint8List> _webpToPng(Uint8List webpBytes) async {
    final dir = await Directory.systemTemp.createTemp('egon-webp-');
    final input = File('${dir.path}/in.webp');
    final output = File('${dir.path}/out.png');
    try {
      await input.writeAsBytes(webpBytes, flush: true);
      final result = await Process.run(ffmpegPath, [
        '-y',
        '-i',
        input.path,
        '-frames:v',
        '1',
        output.path,
      ]);
      if (result.exitCode != 0 || !output.existsSync()) {
        throw StateError(
          'Could not convert WebP to PNG for Discord: '
                  '${result.stderr}'
              .trim(),
        );
      }
      return Uint8List.fromList(await output.readAsBytes());
    } finally {
      try {
        await dir.delete(recursive: true);
      } catch (_) {}
    }
  }

  static bool _hasWebpMagic(List<int> bytes) {
    // RIFF....WEBP
    if (bytes.length < 12) return false;
    return bytes[0] == 0x52 &&
        bytes[1] == 0x49 &&
        bytes[2] == 0x46 &&
        bytes[3] == 0x46 &&
        bytes[8] == 0x57 &&
        bytes[9] == 0x45 &&
        bytes[10] == 0x42 &&
        bytes[11] == 0x50;
  }

  static String _withExtension(String name, String ext) {
    final base = name.trim().isEmpty ? 'image' : name.trim();
    final dot = base.lastIndexOf('.');
    if (dot <= 0) return '$base$ext';
    return '${base.substring(0, dot)}$ext';
  }
}
