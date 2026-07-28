import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:egon_bot/src/tools/tool.dart';
import 'package:test/test.dart';

import 'helpers.dart';

OllamaToolCall call(String name) =>
    OllamaToolCall(name: name, arguments: const {});

void main() {
  group('ToolRegistry access enforcement', () {
    test('owner can run any tier', () async {
      for (final access in ToolAccess.values) {
        final tool = StubTool(toolAccess: access);
        final services = testServices(tools: [tool]);
        final result = await services.registry.dispatch(
          contextFor(services, owner: true),
          call('stub_tool'),
        );
        expect(result.isError, isFalse, reason: access.name);
        expect(tool.executions, 1, reason: access.name);
      }
    });

    test('non-owner can run standard tools', () async {
      final tool = StubTool();
      final services = testServices(tools: [tool]);
      final result = await services.registry.dispatch(
        contextFor(services, owner: false),
        call('stub_tool'),
      );
      expect(result.isError, isFalse);
      expect(tool.executions, 1);
    });

    test('non-owner is refused personal tools', () async {
      final tool = StubTool(toolAccess: ToolAccess.personal);
      final services = testServices(tools: [tool]);
      final result = await services.registry.dispatch(
        contextFor(services, owner: false),
        call('stub_tool'),
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('owner'));
      expect(tool.executions, 0);
    });

    test('non-owner dangerous tools point to owner approval', () async {
      final tool = StubTool(toolAccess: ToolAccess.dangerous);
      final services = testServices(tools: [tool]);
      final result = await services.registry.dispatch(
        contextFor(services, owner: false),
        call('stub_tool'),
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('approval'));
      expect(tool.executions, 0);
    });

    test('unknown tool returns an error', () async {
      final services = testServices(tools: [StubTool()]);
      final result = await services.registry.dispatch(
        contextFor(services, owner: true),
        call('no_such_tool'),
      );
      expect(result.isError, isTrue);
    });

    test('non-owners only see standard tool schemas', () {
      final services = testServices(
        tools: [
          StubTool(),
          _NamedTool('personal_tool', ToolAccess.personal),
          _NamedTool('dangerous_tool', ToolAccess.dangerous),
        ],
      );
      final ownerSchemas = services.registry
          .schemasFor(contextFor(services, owner: true))
          .map((t) => t.name);
      final userSchemas = services.registry
          .schemasFor(contextFor(services, owner: false))
          .map((t) => t.name);

      expect(ownerSchemas,
          containsAll(['stub_tool', 'personal_tool', 'dangerous_tool']));
      expect(userSchemas, ['stub_tool']);
    });

    test('every dispatch is audit-logged', () async {
      final services = testServices(
        tools: [StubTool(toolAccess: ToolAccess.personal)],
      );
      await services.registry.dispatch(
        contextFor(services, owner: true),
        call('stub_tool'),
      );
      await services.registry.dispatch(
        contextFor(services, owner: false),
        call('stub_tool'),
      );

      final rows = services.database.db.select(
        'SELECT caller, ok FROM tool_audit_log ORDER BY id',
      );
      expect(rows.length, 2);
      expect(rows[0]['caller'], ownerId);
      expect(rows[0]['ok'], 1);
      expect(rows[1]['caller'], strangerId);
      expect(rows[1]['ok'], 0);
    });
  });
}

class _NamedTool extends StubTool {
  _NamedTool(this._name, ToolAccess access) : super(toolAccess: access);

  final String _name;

  @override
  String get name => _name;
}
