import 'dart:io';

import '../llm/llm_gate.dart';
import '../llm/ollama_models.dart';
import '../services.dart';
import 'registry_codegen.dart';
import 'tool.dart';

/// Generates, validates, and installs a self-written tool (§6.4).
class ToolCreator {
  ToolCreator(this.services);

  final Services services;

  static const maxRepairRounds = 3;

  /// Package root (contains `pubspec.yaml` and `lib/`). Defaults to cwd.
  Directory get packageRoot => Directory.current;

  Directory get dataToolsDir => Directory('${services.config.dataDir}/tools');

  Directory get generatedDir =>
      Directory('${packageRoot.path}/lib/src/tools/generated');

  Future<ToolResult> create({
    required String description,
    required String channelId,
    String? preferredName,
  }) async {
    final slug = _slugify(preferredName ?? _guessName(description));
    if (slug.isEmpty) {
      return ToolResult.error(
        'Could not derive a tool name from the description. '
        'Pass a snake_case `name`.',
      );
    }

    final fileName = '${slug}_tool.dart';
    final className = expectedClassName(fileName);

    final collision = _collisionReason(slug);
    if (collision != null) {
      return ToolResult.error(collision);
    }

    var source = await _generateSource(
      description: description,
      slug: slug,
      className: className,
    );
    source = _stripFences(source);

    String? lastErrors;
    for (var round = 0; round <= maxRepairRounds; round++) {
      if (round > 0) {
        source = await _repairSource(
          description: description,
          slug: slug,
          className: className,
          previous: source,
          errors: lastErrors!,
        );
        source = _stripFences(source);
      }

      final validation = _validateSource(fileName, source, slug);
      if (validation != null) {
        lastErrors = validation;
        if (round == maxRepairRounds) break;
        continue;
      }

      final analyzeErrors = await _analyzeStaged(fileName, source);
      if (analyzeErrors != null) {
        lastErrors = analyzeErrors;
        if (round == maxRepairRounds) break;
        continue;
      }

      // Install into the persistent volume; supervisor syncs on restart.
      dataToolsDir.createSync(recursive: true);
      final dest = File('${dataToolsDir.path}/$fileName');
      dest.writeAsStringSync(source);

      services.notices.enqueue(
        channelId: channelId,
        message: 'Back online — tool `$slug` is live.',
      );
      services.requestRestart();

      return ToolResult.ok({
        'installed': true,
        'name': slug,
        'file': dest.path,
        'restarting': true,
        'message': 'Tool `$slug` installed. Restarting now to load it.',
      });
    }

    return ToolResult.error(
      'Failed to produce an analyze-clean tool after '
      '$maxRepairRounds repair rounds.\n\nLast errors:\n$lastErrors',
    );
  }

  String? _collisionReason(String slug) {
    if (services.registry.byName(slug) != null) {
      return 'Tool name `$slug` already exists in the registry.';
    }
    final dataFile = File('${dataToolsDir.path}/${slug}_tool.dart');
    if (dataFile.existsSync()) {
      return 'A file for `$slug` already exists at ${dataFile.path}.';
    }
    final genFile = File('${generatedDir.path}/${slug}_tool.dart');
    if (genFile.existsSync()) {
      return 'A generated file for `$slug` already exists.';
    }
    return null;
  }

  String? _validateSource(String fileName, String source, String slug) {
    try {
      validateToolSource(fileName, source);
    } on ToolConventionViolation catch (error) {
      return error.toString();
    }

    final disallowed = findDisallowedImports(source);
    if (disallowed.isNotEmpty) {
      return 'Disallowed imports: ${disallowed.join(', ')}. '
          'Only dart:*, package:http, and ../tool.dart are allowed.';
    }

    final nameMatch = RegExp(
      """String\\s+get\\s+name\\s*=>\\s*['"]([^'"]+)['"]""",
    ).firstMatch(source);
    if (nameMatch == null) {
      return 'Tool must declare `String get name => \'$slug\';`.';
    }
    if (nameMatch.group(1) != slug) {
      return 'Tool name getter is `${nameMatch.group(1)}` but file implies '
          '`$slug`. They must match.';
    }

    if (!source.contains("origin => 'self-written'") &&
        !source.contains('origin => "self-written"')) {
      return "Tool must override `origin` to return 'self-written'.";
    }

    return null;
  }

  Future<String?> _analyzeStaged(String fileName, String source) async {
    generatedDir.createSync(recursive: true);
    final staging = File('${generatedDir.path}/_$fileName');
    staging.writeAsStringSync(source);
    try {
      final result = await Process.run(
        'dart',
        ['analyze', staging.path],
        workingDirectory: packageRoot.path,
      );
      if (result.exitCode == 0) {
        return null;
      }
      final out = '${result.stdout}\n${result.stderr}'.trim();
      return out.isEmpty
          ? 'dart analyze failed with code ${result.exitCode}'
          : out;
    } finally {
      if (staging.existsSync()) {
        staging.deleteSync();
      }
    }
  }

  Future<String> _generateSource({
    required String description,
    required String slug,
    required String className,
  }) async {
    final prompt = _codegenPrompt(
      description: description,
      slug: slug,
      className: className,
    );
    final reply = await services.llmGate.chat(
      tier: ModelTier.big,
      messages: [
        OllamaChatMessage(role: 'system', content: prompt),
        OllamaChatMessage(
          role: 'user',
          content: 'Write the complete Dart source for this tool now.',
        ),
      ],
    );
    final content = reply.content.trim();
    if (content.isEmpty) {
      throw StateError('Model returned empty tool source.');
    }
    return content;
  }

  Future<String> _repairSource({
    required String description,
    required String slug,
    required String className,
    required String previous,
    required String errors,
  }) async {
    final reply = await services.llmGate.chat(
      tier: ModelTier.big,
      messages: [
        OllamaChatMessage(
          role: 'system',
          content: _codegenPrompt(
            description: description,
            slug: slug,
            className: className,
          ),
        ),
        OllamaChatMessage(
          role: 'user',
          content: 'The previous source failed validation/analyze. Fix it and '
              'return the complete corrected file only.\n\n'
              '## Errors\n$errors\n\n'
              '## Previous source\n```dart\n$previous\n```',
        ),
      ],
    );
    final content = reply.content.trim();
    return content.isEmpty ? previous : content;
  }

  String _codegenPrompt({
    required String description,
    required String slug,
    required String className,
  }) =>
      '''
You write Dart tools for the Egon Discord bot. Output ONLY the Dart source
file — no markdown fences, no commentary.

## Requirements for the tool
$description

## Hard conventions
- Filename will be `${slug}_tool.dart`
- Exactly one class: `class $className extends Tool`
- Zero-argument constructor (no fields in the constructor)
- `String get name => '$slug';`
- Override `String get origin => 'self-written';`
- Override `description`, `parametersJsonSchema`, and `execute`
- Access `Services` only via `context.services` inside `execute`
- Imports whitelist ONLY:
  - `dart:*` (e.g. dart:convert, dart:math, dart:async)
  - `package:http/http.dart`
  - `../tool.dart`  (required — provides Tool, ToolContext, ToolResult, ToolAccess)
- Do NOT import anything else (no nyxx, no sqlite, no other package:egon_bot paths)
- Prefer `ToolAccess.standard` unless the tool clearly needs owner-only data
- `execute` must not throw for expected failures — return `ToolResult.error(...)`
- Return useful JSON via `ToolResult.ok({...})`

## Skeleton
```dart
import 'dart:math';

import '../tool.dart';

class $className extends Tool {
  @override
  String get name => '$slug';

  @override
  String get description => '...';

  @override
  String get origin => 'self-written';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': <String, Object?>{
          // ...
        },
        'required': <String>[],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    // ...
    return ToolResult.ok({'ok': true});
  }
}
```
''';

  static String _stripFences(String source) {
    var s = source.trim();
    if (s.startsWith('```')) {
      final firstNl = s.indexOf('\n');
      if (firstNl > 0) s = s.substring(firstNl + 1);
      if (s.endsWith('```')) {
        s = s.substring(0, s.length - 3);
      }
    }
    return s.trim();
  }

  static String _slugify(String raw) {
    var s = raw.trim().toLowerCase();
    s = s.replaceAll(RegExp(r'\.dart$'), '');
    s = s.replaceAll(RegExp(r'_tool$'), '');
    s = s.replaceAll(RegExp(r'[^a-z0-9]+'), '_');
    s = s.replaceAll(RegExp(r'_+'), '_');
    s = s.replaceAll(RegExp(r'^_|_$'), '');
    if (s.isEmpty) return s;
    if (RegExp(r'^[0-9]').hasMatch(s)) {
      s = 'tool_$s';
    }
    return s;
  }

  static String _guessName(String description) {
    final words = description
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9\s]'), ' ')
        .split(RegExp(r'\s+'))
        .where((w) => w.length > 2)
        .where(
          (w) => !const {
            'the',
            'and',
            'that',
            'this',
            'with',
            'from',
            'tool',
            'build',
            'create',
            'yourself',
            'please',
            'make',
            'for',
            'does',
            'which',
            'rolls',
            'roll',
          }.contains(w),
        )
        .take(4)
        .toList();
    return words.join('_');
  }
}
