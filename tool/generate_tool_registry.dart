import 'dart:io';

import 'package:egon_bot/src/tools/registry_codegen.dart';

/// Scans builtin/ + generated/ and writes lib/src/tools/tool_registry.g.dart.
///
/// Exit codes: 0 success, 1 no tools / hard failure.
Future<void> main(List<String> args) async {
  final root = Directory.current;
  final skipped = <ToolConventionViolation>[];
  final tools = generateToolRegistry(packageRoot: root, skipped: skipped);

  stdout.writeln(
    'Generated tool_registry.g.dart with ${tools.length} tools '
    '(${skipped.length} skipped).',
  );
  for (final tool in tools) {
    stdout.writeln('  - ${tool.className} (${tool.origin})');
  }
  for (final violation in skipped) {
    stderr.writeln('  ! $violation');
  }

  if (tools.isEmpty) {
    stderr
        .writeln('No tools discovered — refusing to write an empty registry.');
    exitCode = 1;
  }
}
