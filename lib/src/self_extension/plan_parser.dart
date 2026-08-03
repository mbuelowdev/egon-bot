/// Parsed structured plan from a Cursor plan-mode result.
class ParsedExtensionPlan {
  ParsedExtensionPlan({
    required this.markdown,
    required this.summary,
    required this.files,
    required this.risks,
    required this.testPlan,
  });

  final String markdown;
  final String summary;
  final List<String> files;
  final List<String> risks;
  final List<String> testPlan;

  Map<String, Object?> toJson() => {
        'summary': summary,
        'files': files,
        'risks': risks,
        'test_plan': testPlan,
      };
}

/// Extracts YAML-like frontmatter + body from Cursor plan output.
ParsedExtensionPlan parseExtensionPlan(String raw) {
  final text = _stripFences(raw).trim();
  if (text.isEmpty) {
    return ParsedExtensionPlan(
      markdown: '(empty plan)',
      summary: '',
      files: const [],
      risks: const [],
      testPlan: const [],
    );
  }

  final frontmatter = RegExp(
    r'^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$',
  ).firstMatch(text);

  if (frontmatter == null) {
    return ParsedExtensionPlan(
      markdown: text,
      summary: _firstLine(text),
      files: const [],
      risks: const [],
      testPlan: const [],
    );
  }

  final meta = frontmatter.group(1) ?? '';
  final body = (frontmatter.group(2) ?? '').trim();
  final summary = _metaScalar(meta, 'summary') ?? _firstLine(body);
  final testPlan = <String>{
    ..._metaList(meta, 'test_plan'),
    ..._metaList(meta, 'testPlan'),
  }.toList();
  return ParsedExtensionPlan(
    markdown: body.isEmpty ? text : body,
    summary: summary,
    files: _metaList(meta, 'files'),
    risks: _metaList(meta, 'risks'),
    testPlan: testPlan,
  );
}

String _stripFences(String raw) {
  final match = RegExp(
    r'^```(?:markdown|md|yaml|yml)?\s*\n([\s\S]*?)\n```\s*$',
  ).firstMatch(raw.trim());
  return match?.group(1) ?? raw;
}

String _firstLine(String text) {
  for (final line in text.split('\n')) {
    final t = line.trim();
    if (t.isEmpty || t.startsWith('#')) continue;
    return t.length > 200 ? '${t.substring(0, 197)}...' : t;
  }
  return '';
}

String? _metaScalar(String meta, String key) {
  final match = RegExp(
    '^$key:\\s*(.+?)\\s*\$',
    multiLine: true,
  ).firstMatch(meta);
  if (match == null) return null;
  var value = match.group(1)!.trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.substring(1, value.length - 1);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    final list = _parseInlineList(value);
    return list.isEmpty ? null : list.first;
  }
  return value.isEmpty ? null : value;
}

List<String> _metaList(String meta, String key) {
  final inline = RegExp(
    '^$key:\\s*\\[(.*?)\\]\\s*\$',
    multiLine: true,
  ).firstMatch(meta);
  if (inline != null) {
    return _parseInlineList('[${inline.group(1)}]');
  }

  final block = RegExp(
    '^$key:\\s*\\n((?:\\s*-\\s+.+(?:\\n|\$))+)',
    multiLine: true,
  ).firstMatch(meta);
  if (block == null) return [];
  final items = <String>[];
  for (final line in block.group(1)!.split('\n')) {
    final m = RegExp(r'^\s*-\s+(.+)\s*$').firstMatch(line);
    if (m != null) items.add(m.group(1)!.trim());
  }
  return items;
}

List<String> _parseInlineList(String raw) {
  final inner = raw.trim();
  if (!inner.startsWith('[') || !inner.endsWith(']')) return [];
  final body = inner.substring(1, inner.length - 1).trim();
  if (body.isEmpty) return [];
  return body
      .split(',')
      .map((s) {
        var t = s.trim();
        if ((t.startsWith('"') && t.endsWith('"')) ||
            (t.startsWith("'") && t.endsWith("'"))) {
          t = t.substring(1, t.length - 1);
        }
        return t;
      })
      .where((s) => s.isNotEmpty)
      .toList();
}
