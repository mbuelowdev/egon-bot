import 'dart:io';

import '../config.dart';

class TranscriptionException implements Exception {
  TranscriptionException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// ogg/opus → wav → whisper.cpp text (§10).
class TranscriptionService {
  TranscriptionService({
    required this.config,
    this.ffmpegPath = 'ffmpeg',
    String? whisperCliPath,
    String? modelPath,
  })  : whisperCliPath = whisperCliPath ??
            Platform.environment['WHISPER_CLI'] ??
            'whisper-cli',
        modelPath = modelPath ??
            Platform.environment['WHISPER_MODEL_PATH'] ??
            '/models/ggml-${config.whisperModel}.bin';

  final Config config;
  final String ffmpegPath;
  final String whisperCliPath;
  final String modelPath;

  /// Transcribes an audio file (typically Discord voice ogg/opus).
  Future<String> transcribe(File audioFile) async {
    if (!audioFile.existsSync()) {
      throw TranscriptionException('Audio file missing: ${audioFile.path}');
    }
    final model = File(modelPath);
    if (!model.existsSync()) {
      throw TranscriptionException(
        'Whisper model not found at $modelPath. '
        'Set WHISPER_MODEL_PATH or install ggml-${config.whisperModel}.bin.',
      );
    }

    final wav = File('${audioFile.path}.16k.wav');
    try {
      final ffmpeg = await Process.run(ffmpegPath, [
        '-y',
        '-i',
        audioFile.path,
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        wav.path,
      ]);
      if (ffmpeg.exitCode != 0) {
        throw TranscriptionException(
          'ffmpeg failed: ${ffmpeg.stderr}'.trim(),
        );
      }

      final outBase = '${wav.path}.out';
      final whisper = await Process.run(whisperCliPath, [
        '-m',
        modelPath,
        '-f',
        wav.path,
        '-otxt',
        '-of',
        outBase,
        '-l',
        'auto',
        '-np',
      ]);
      if (whisper.exitCode != 0) {
        throw TranscriptionException(
          'whisper-cli failed: ${whisper.stderr}'.trim(),
        );
      }

      final txt = File('$outBase.txt');
      if (!txt.existsSync()) {
        // Some builds write without the extra suffix.
        final alt = File('$outBase');
        if (alt.existsSync()) {
          final text = alt.readAsStringSync().trim();
          if (text.isEmpty) {
            throw TranscriptionException('Empty transcript.');
          }
          return text;
        }
        throw TranscriptionException('Whisper produced no transcript file.');
      }
      final text = txt.readAsStringSync().trim();
      if (text.isEmpty) {
        throw TranscriptionException('Empty transcript.');
      }
      return text;
    } finally {
      _tryDelete(wav);
      _tryDelete(File('${wav.path}.out.txt'));
      _tryDelete(File('${wav.path}.out'));
    }
  }

  static void _tryDelete(File f) {
    try {
      if (f.existsSync()) f.deleteSync();
    } catch (_) {}
  }
}
