import 'package:egon_bot/src/agent/approval_service.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('ApprovalService', () {
    test('expireStale marks old pending rows expired', () async {
      final tool = StubTool(preview: 'change me');
      final services = testServices(
        tools: [tool],
        approvalTtl: const Duration(milliseconds: 1),
      );

      final pending = await services.approvals.requestApproval(
        context: contextFor(services, owner: true),
        toolName: tool.name,
        args: const {},
        preview: 'change me',
      );
      final id = pending.json['approval_id'] as int;

      await Future<void>.delayed(const Duration(milliseconds: 5));
      final expired = services.approvals.expireStale();
      expect(expired, 1);
      expect(services.approvals.byId(id)!.status, ApprovalStatus.expired);

      final decision = await services.approvals.decide(
        id: id,
        approved: true,
        actorId: ownerId,
      );
      expect(decision, ApprovalDecisionResult.ignored);
      expect(tool.executions, 0);
    });

    test('non-owner decide is forbidden and leaves status pending', () async {
      final tool = StubTool(preview: 'secret');
      final services = testServices(tools: [tool]);
      final pending = await services.approvals.requestApproval(
        context: contextFor(services, owner: false),
        toolName: tool.name,
        args: const {'x': 1},
        preview: 'secret',
      );
      final id = pending.json['approval_id'] as int;

      final decision = await services.approvals.decide(
        id: id,
        approved: true,
        actorId: strangerId,
      );
      expect(decision, ApprovalDecisionResult.forbidden);
      expect(services.approvals.byId(id)!.status, ApprovalStatus.pending);
      expect(tool.executions, 0);
    });

    test('owner approve executes the tool; reject does not', () async {
      final tool = StubTool(preview: 'do it');
      final services = testServices(tools: [tool]);

      final first = await services.approvals.requestApproval(
        context: contextFor(services, owner: true),
        toolName: tool.name,
        args: const {},
        preview: 'do it',
      );
      await services.approvals.decide(
        id: first.json['approval_id'] as int,
        approved: true,
        actorId: ownerId,
      );
      expect(tool.executions, 1);
      expect(
        services.approvals.byId(first.json['approval_id'] as int)!.status,
        ApprovalStatus.approved,
      );

      final second = await services.approvals.requestApproval(
        context: contextFor(services, owner: true),
        toolName: tool.name,
        args: const {},
        preview: 'do it again',
      );
      await services.approvals.decide(
        id: second.json['approval_id'] as int,
        approved: false,
        actorId: ownerId,
      );
      expect(tool.executions, 1);
      expect(
        services.approvals.byId(second.json['approval_id'] as int)!.status,
        ApprovalStatus.rejected,
      );
    });

    test('approvals survive conceptually across service rebuilds via DB',
        () async {
      final tool = StubTool(preview: 'persist');
      final services = testServices(tools: [tool]);
      final pending = await services.approvals.requestApproval(
        context: contextFor(services, owner: true),
        toolName: tool.name,
        args: const {'k': 'v'},
        preview: 'persist',
      );
      final id = pending.json['approval_id'] as int;

      // Simulate restart: new ApprovalService on the same DB + registry.
      final restarted = ApprovalService(
        database: services.database,
        config: services.config,
        services: () => services,
      );
      final row = restarted.byId(id);
      expect(row, isNotNull);
      expect(row!.status, ApprovalStatus.pending);
      expect(row.args['k'], 'v');

      final decision = await restarted.decide(
        id: id,
        approved: true,
        actorId: ownerId,
      );
      expect(decision, ApprovalDecisionResult.handled);
      expect(tool.executions, 1);
    });
  });
}
