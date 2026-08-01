import 'dart:convert';
import 'dart:io';

import '../llm/ollama_models.dart';
import '../services.dart';
import 'tool.dart';

/// Holds all tools, exports their schemas for the Ollama call, dispatches
/// tool calls with [ToolAccess] enforcement + approval flow, and audit-logs
/// every invocation (ARCHITECTURE.md §6.2, §6.5, §16).
class ToolRegistry {
  ToolRegistry({required List<Tool> tools, required Services services})
      : _services = services {
    for (final tool in tools) {
      if (_tools.containsKey(tool.name)) {
        throw StateError('Duplicate tool name: ${tool.name}');
      }
      _tools[tool.name] = tool;
    }
  }

  final Map<String, Tool> _tools = {};
  final Services _services;

  static const _maxAuditArgsChars = 2000;

  List<Tool> get all => List.unmodifiable(_tools.values);

  Tool? byName(String name) => _tools[name];

  /// Tool schemas the given caller is allowed to see.
  ///
  /// Non-owners get `standard` and `dangerous` (dangerous calls escalate to
  /// the owner). `personal` schemas stay owner-only so the model never plans
  /// calls that would be hard-refused.
  List<OllamaTool> schemasFor(ToolContext context) => [
        for (final tool in _tools.values)
          if (context.isOwner ||
              tool.access == ToolAccess.standard ||
              tool.access == ToolAccess.dangerous)
            tool.toOllamaTool(),
      ];

  Future<ToolResult> dispatch(ToolContext context, OllamaToolCall call) async {
    final tool = _tools[call.name];
    if (tool == null) {
      return ToolResult.error('Unknown tool: ${call.name}');
    }

    final refusal = _accessRefusal(tool, context);
    if (refusal != null) {
      _audit(context, call, ok: false, durationMs: 0);
      return ToolResult.error(refusal);
    }

    final stopwatch = Stopwatch()..start();
    ToolResult result;
    try {
      final preview = await tool.previewChange(context, call.arguments);
      final needsPreviewApproval = preview != null;
      final needsDangerousEscalation =
          !context.isOwner && tool.access == ToolAccess.dangerous;

      if (needsPreviewApproval || needsDangerousEscalation) {
        final previewText =
            preview ?? _defaultDangerousPreview(tool.name, call.arguments);
        result = await _services.approvals.requestApproval(
          context: context,
          toolName: tool.name,
          args: call.arguments,
          preview: previewText,
        );
      } else {
        result = await tool.execute(context, call.arguments);
      }
    } catch (error, stackTrace) {
      stderr.writeln('Tool ${tool.name} threw: $error\n$stackTrace');
      result = ToolResult.error('Tool ${tool.name} failed unexpectedly.');
    }
    stopwatch.stop();

    _audit(
      context,
      call,
      ok: !result.isError,
      durationMs: stopwatch.elapsedMilliseconds,
    );
    return result;
  }

  /// Runs a tool that has already been owner-approved, skipping the approval
  /// gate but still writing an audit row.
  Future<ToolResult> executeApproved({
    required Tool tool,
    required ToolContext context,
    required Map<String, Object?> args,
  }) async {
    final call = OllamaToolCall(name: tool.name, arguments: args);
    final stopwatch = Stopwatch()..start();
    ToolResult result;
    try {
      result = await tool.execute(context, args);
    } catch (error, stackTrace) {
      stderr.writeln(
        'Approved tool ${tool.name} threw: $error\n$stackTrace',
      );
      result = ToolResult.error('Tool ${tool.name} failed unexpectedly.');
    }
    stopwatch.stop();
    _audit(
      context,
      call,
      ok: !result.isError,
      durationMs: stopwatch.elapsedMilliseconds,
    );
    return result;
  }

  String? _accessRefusal(Tool tool, ToolContext context) {
    if (context.isOwner) return null;
    switch (tool.access) {
      case ToolAccess.standard:
      case ToolAccess.dangerous:
        // Dangerous is escalated inside dispatch, not refused here.
        return null;
      case ToolAccess.personal:
        return 'The tool ${tool.name} works with personal data and is '
            'reserved for the owner. Tell the user this feature is not '
            'available to them.';
    }
  }

  String _defaultDangerousPreview(
    String toolName,
    Map<String, Object?> args,
  ) {
    final encoded = const JsonEncoder.withIndent('  ').convert(args);
    return 'Dangerous tool `$toolName` requested with arguments:\n$encoded';
  }

  void _audit(
    ToolContext context,
    OllamaToolCall call, {
    required bool ok,
    required int durationMs,
  }) {
    var args = jsonEncode(call.arguments);
    if (args.length > _maxAuditArgsChars) {
      args = args.substring(0, _maxAuditArgsChars);
    }
    _services.database.db.execute(
      'INSERT INTO tool_audit_log (at, tool, caller, channel, args_json, ok, '
      'duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        DateTime.now().toUtc().toIso8601String(),
        call.name,
        context.userId,
        context.channelId,
        args,
        ok ? 1 : 0,
        durationMs,
      ],
    );
  }
}
