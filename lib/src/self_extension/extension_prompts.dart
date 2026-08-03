/// Prompts sent to Cursor Cloud Agents for self-extension.
library;

String buildPlanPrompt({
  required String description,
  String? title,
}) {
  final label = (title != null && title.trim().isNotEmpty)
      ? '**${title.trim()}**\n\n'
      : '';
  return '''
You are planning a self-extension for the Egon Discord bot (Dart).

## Request
$label$description

## Your task
Explore the repository and produce an implementation PLAN only.
Do NOT write code, commit, push, open a PR, or edit `deployment.json`.

## Output format (mandatory)
Return ONLY markdown in this shape (no commentary outside it):

---
summary: one-line summary
files: [path1, path2]
risks: [risk1]
test_plan: [check1, check2]
---
# Plan
Concrete steps, files to touch, and how it fits existing patterns
(Tool interface, registry codegen, tests, prompts).

## Path policy
- Prefer `lib/src/tools/**`, `test/**`, and docs.
- Do not touch secrets, credentials, or host env files.
- Do not change `supervisor/` unless the request explicitly requires it.
- Do not bump `deployment.json` in this plan phase.
''';
}

String buildRevisePlanPrompt({
  required String revisionNotes,
  required String previousPlan,
}) {
  return '''
Revise the self-extension plan based on the owner's feedback.
Still PLAN ONLY — no code, no commits, no PR, no `deployment.json` bump.

## Owner feedback
$revisionNotes

## Previous plan
$previousPlan

## Output format (mandatory)
Return ONLY markdown:

---
summary: one-line summary
files: [path1, path2]
risks: [risk1]
test_plan: [check1, check2]
---
# Plan
Updated plan incorporating the feedback.
''';
}

String buildExecutePrompt({
  required String approvedPlan,
  required String targetVersion,
}) {
  return '''
The owner APPROVED the following plan. Implement it now.

## Approved plan
$approvedPlan

## Hard requirements
1. Implement the plan fully, following existing repo conventions
   (Dart Tool classes, registry codegen via
   `dart run tool/generate_tool_registry.dart`, tests).
2. Run `dart analyze` / relevant tests and fix issues before finishing.
3. Set `deployment.json` `"version"` exactly to `$targetVersion`
   (this triggers production deploy when merged to master).
4. Open a pull request against `master` (mark ready for review, not draft).
   PR title/body must summarize the change and include the test plan.
5. Do not change unrelated files or secrets.

When done, reply with a short summary and the PR URL.
''';
}
