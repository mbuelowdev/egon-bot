import 'dart:io';

/// One discoverable tool source file under builtin/ or generated/.
class ToolSourceFile {
  ToolSourceFile({
    required this.file,
    required this.importPath,
    required this.className,
    required this.origin,
  });

  final File file;
  final String importPath;
  final String className;

  /// `builtin` or `self-written`.
  final String origin;
}

class ToolConventionViolation implements Exception {
  ToolConventionViolation(this.path, this.reason);
  final String path;
  final String reason;

  @override
  String toString() => 'ToolConventionViolation($path): $reason';
}

/// Expected PascalCase class name for `<snake>_tool.dart`.
String expectedClassName(String fileName) {
  final base = fileName.replaceAll(RegExp(r'\.dart$'), '');
  if (!base.endsWith('_tool')) {
    throw FormatException('File name must end with _tool.dart: $fileName');
  }
  return base.split('_').map((p) {
    if (p.isEmpty) return p;
    return '${p[0].toUpperCase()}${p.substring(1)}';
  }).join();
}

/// Validates §6.3 conventions (adapted to zero-arg constructors used by this
/// codebase). Returns the expected class name on success.
String validateToolSource(String path, String source) {
  final fileName = path.split(Platform.pathSeparator).last;
  if (!fileName.endsWith('_tool.dart')) {
    throw ToolConventionViolation(path, 'file name must end with _tool.dart');
  }
  if (fileName.startsWith('_')) {
    throw ToolConventionViolation(path, 'staging/private files are skipped');
  }

  final className = expectedClassName(fileName);
  final classPattern = RegExp(
    'class\\s+$className\\s+extends\\s+Tool\\b',
  );
  if (!classPattern.hasMatch(source)) {
    throw ToolConventionViolation(
      path,
      'expected `class $className extends Tool`',
    );
  }

  final toolClasses = RegExp(r'class\s+(\w+)\s+extends\s+Tool\b')
      .allMatches(source)
      .map((m) => m.group(1)!)
      .toList();
  if (toolClasses.length != 1) {
    throw ToolConventionViolation(
      path,
      'file must contain exactly one `extends Tool` class '
      '(found ${toolClasses.length})',
    );
  }

  return className;
}

/// Import whitelist for self-written tools (§6.4).
bool isImportAllowed(String importUri) {
  if (importUri.startsWith('dart:')) return true;
  if (importUri == 'package:http/http.dart') return true;
  if (importUri.startsWith('package:http/')) return true;
  // Relative import of the Tool interface from generated/.
  if (importUri == '../tool.dart') return true;
  return false;
}

/// Returns disallowed import URIs found in [source].
List<String> findDisallowedImports(String source) {
  final disallowed = <String>[];
  for (final match in RegExp(
    """import\\s+['"]([^'"]+)['"]""",
  ).allMatches(source)) {
    final uri = match.group(1)!;
    if (!isImportAllowed(uri)) {
      disallowed.add(uri);
    }
  }
  return disallowed;
}

/// Scans builtin + generated tool directories and returns valid sources.
/// Invalid files are listed in [skipped] instead of aborting.
List<ToolSourceFile> scanToolSources({
  required Directory builtinDir,
  required Directory generatedDir,
  List<ToolConventionViolation>? skipped,
}) {
  final results = <ToolSourceFile>[];

  void scan(Directory dir, {required String origin, required String prefix}) {
    if (!dir.existsSync()) return;
    final files = dir
        .listSync()
        .whereType<File>()
        .where((f) => f.path.endsWith('_tool.dart'))
        .where((f) => !f.uri.pathSegments.last.startsWith('_'))
        .toList()
      ..sort((a, b) => a.path.compareTo(b.path));

    for (final file in files) {
      final name = file.uri.pathSegments.last;
      try {
        final source = file.readAsStringSync();
        final className = validateToolSource(file.path, source);
        results.add(
          ToolSourceFile(
            file: file,
            importPath: '$prefix/$name',
            className: className,
            origin: origin,
          ),
        );
      } on ToolConventionViolation catch (error) {
        skipped?.add(error);
        stderr.writeln('Skipping invalid tool source: $error');
      }
    }
  }

  scan(builtinDir, origin: 'builtin', prefix: 'builtin');
  scan(generatedDir, origin: 'self-written', prefix: 'generated');
  return results;
}

/// Emits the contents of `tool_registry.g.dart`.
String generateRegistrySource(List<ToolSourceFile> tools) {
  final buf = StringBuffer()
    ..writeln('// GENERATED — do not edit.')
    ..writeln('// dart run tool/generate_tool_registry.dart')
    ..writeln()
    ..writeln("import 'tool.dart';");
  for (final tool in tools) {
    buf.writeln("import '${tool.importPath}';");
  }
  buf
    ..writeln()
    ..writeln('/// All tools discovered under builtin/ + generated/.')
    ..writeln('List<Tool> buildAllTools() => [');
  for (final tool in tools) {
    buf.writeln('  ${tool.className}(),');
  }
  buf.writeln('];');
  buf.writeln();
  return buf.toString();
}

/// Runs a full scan + write of [outputFile]. Returns the tool list.
List<ToolSourceFile> generateToolRegistry({
  required Directory packageRoot,
  File? outputFile,
  List<ToolConventionViolation>? skipped,
}) {
  final toolsDir = Directory('${packageRoot.path}/lib/src/tools');
  final tools = scanToolSources(
    builtinDir: Directory('${toolsDir.path}/builtin'),
    generatedDir: Directory('${toolsDir.path}/generated'),
    skipped: skipped,
  );
  final out = outputFile ?? File('${toolsDir.path}/tool_registry.g.dart');
  out.writeAsStringSync(generateRegistrySource(tools));
  return tools;
}
