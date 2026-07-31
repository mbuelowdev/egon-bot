import 'agent/approval_service.dart';
import 'config.dart';
import 'jobs/job_runner.dart';
import 'jobs/job_store.dart';
import 'llm/llm_gate.dart';
import 'memory/memory_service.dart';
import 'scheduler/scheduler.dart';
import 'scheduler/task_store.dart';
import 'security/whitelist_service.dart';
import 'storage/database.dart';
import 'time/timestamps.dart';
import 'tools/tool_registry.dart';
import 'web/fetch_api.dart';
import 'web/search_api.dart';

/// Shared dependencies handed to every tool via [ToolContext].
class Services {
  Services({
    required this.config,
    required this.database,
    required this.whitelist,
    required this.llmGate,
    required this.timestamps,
    required this.searchApi,
    required this.fetchApi,
    required this.memory,
    required this.tasks,
    required this.jobs,
  });

  final Config config;
  final AppDatabase database;
  final WhitelistService whitelist;
  final LlmGate llmGate;
  final Timestamps timestamps;
  final SearchApi searchApi;
  final FetchApi fetchApi;
  final MemoryService memory;
  final TaskStore tasks;
  final JobStore jobs;

  /// Set once after the registry has been built (tools like `list_tools`
  /// need to look back into it).
  late final ToolRegistry registry;

  /// Set once after construction — needs [registry] for approved execution.
  late final ApprovalService approvals;

  /// Set once after Agent/history exist — started when Discord connects.
  late final Scheduler scheduler;

  /// Set once after history exists — recovered/started when Discord connects.
  late final JobRunner jobRunner;
}
