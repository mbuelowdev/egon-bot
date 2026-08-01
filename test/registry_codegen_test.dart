import 'dart:io';

import 'package:egon_bot/src/tools/registry_codegen.dart';
import 'package:test/test.dart';

void main() {
  group('expectedClassName', () {
    test('PascalCases snake_tool file names', () {
      expect(expectedClassName('web_search_tool.dart'), 'WebSearchTool');
      expect(expectedClassName('list_tools_tool.dart'), 'ListToolsTool');
      expect(expectedClassName('create_tool_tool.dart'), 'CreateToolTool');
    });
  });

  group('validateToolSource', () {
    test('accepts a well-formed tool file', () {
      const source = '''
import '../tool.dart';

class DiceRollTool extends Tool {
  @override
  String get name => 'dice_roll';
  // ...
}
''';
      expect(validateToolSource('dice_roll_tool.dart', source), 'DiceRollTool');
    });

    test('rejects wrong class name', () {
      const source = '''
class WrongName extends Tool {}
''';
      expect(
        () => validateToolSource('dice_roll_tool.dart', source),
        throwsA(isA<ToolConventionViolation>()),
      );
    });

    test('rejects multiple Tool subclasses', () {
      const source = '''
class DiceRollTool extends Tool {}
class ExtraTool extends Tool {}
''';
      expect(
        () => validateToolSource('dice_roll_tool.dart', source),
        throwsA(isA<ToolConventionViolation>()),
      );
    });

    test('rejects non-_tool.dart names', () {
      expect(
        () => validateToolSource('dice.dart', 'class Dice extends Tool {}'),
        throwsA(isA<ToolConventionViolation>()),
      );
    });
  });

  group('import whitelist', () {
    test('allows dart, http, and tool.dart', () {
      expect(isImportAllowed('dart:math'), isTrue);
      expect(isImportAllowed('dart:convert'), isTrue);
      expect(isImportAllowed('package:http/http.dart'), isTrue);
      expect(isImportAllowed('../tool.dart'), isTrue);
    });

    test('rejects everything else', () {
      expect(isImportAllowed('package:nyxx/nyxx.dart'), isFalse);
      expect(isImportAllowed('package:egon_bot/src/services.dart'), isFalse);
      expect(isImportAllowed('../services.dart'), isFalse);
    });

    test('findDisallowedImports reports offenders', () {
      const source = '''
import 'dart:math';
import 'package:nyxx/nyxx.dart';
import '../tool.dart';
''';
      expect(findDisallowedImports(source), ['package:nyxx/nyxx.dart']);
    });
  });

  group('generateRegistrySource', () {
    test('emits imports and zero-arg constructors', () {
      final tmp = Directory.systemTemp.createTempSync('egon-codegen-');
      addTearDown(() => tmp.deleteSync(recursive: true));
      final file = File('${tmp.path}/web_search_tool.dart')
        ..writeAsStringSync('// stub');
      final tools = [
        ToolSourceFile(
          file: file,
          importPath: 'builtin/web_search_tool.dart',
          className: 'WebSearchTool',
          origin: 'builtin',
        ),
        ToolSourceFile(
          file: file,
          importPath: 'generated/dice_roll_tool.dart',
          className: 'DiceRollTool',
          origin: 'self-written',
        ),
      ];
      final out = generateRegistrySource(tools);
      expect(out, contains("// GENERATED — do not edit."));
      expect(out, contains("import 'builtin/web_search_tool.dart';"));
      expect(out, contains("import 'generated/dice_roll_tool.dart';"));
      expect(out, contains('List<Tool> buildAllTools() => ['));
      expect(out, contains('WebSearchTool(),'));
      expect(out, contains('DiceRollTool(),'));
      expect(out, isNot(contains('Services')));
    });
  });

  group('scanToolSources', () {
    test('scans builtin fixtures and skips staging files', () {
      final root = Directory.systemTemp.createTempSync('egon-scan-');
      addTearDown(() => root.deleteSync(recursive: true));
      final builtin = Directory('${root.path}/builtin')..createSync();
      final generated = Directory('${root.path}/generated')..createSync();

      File('${builtin.path}/ok_tool.dart').writeAsStringSync('''
class OkTool extends Tool {}
''');
      File('${generated.path}/_staging_tool.dart').writeAsStringSync('''
class StagingTool extends Tool {}
''');
      File('${generated.path}/bad_tool.dart').writeAsStringSync('''
class NotMatching extends Tool {}
''');

      final skipped = <ToolConventionViolation>[];
      final tools = scanToolSources(
        builtinDir: builtin,
        generatedDir: generated,
        skipped: skipped,
      );

      expect(tools.map((t) => t.className), ['OkTool']);
      expect(tools.single.origin, 'builtin');
      expect(skipped, isNotEmpty);
    });
  });
}
