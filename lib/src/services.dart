import 'dart:io';

import 'agent/approval_service.dart';
import 'config.dart';
import 'contacts/contacts_service.dart';
import 'discord/discord_search_api.dart';
import 'integrations/cursor_agents_client.dart';
import 'integrations/google_calendar_client.dart';
import 'integrations/obsidian_vault.dart';
import 'jobs/job_runner.dart';
import 'jobs/job_store.dart';
import 'llm/llm_gate.dart';
import 'media/attachments.dart';
import 'media/transcription.dart';
import 'memory/memory_service.dart';
import 'notices/notice_service.dart';
import 'process_exit.dart';
import 'scheduler/scheduler.dart';
import 'scheduler/task_store.dart';
import 'security/whitelist_service.dart';
import 'self_extension/self_extension_runner.dart';
import 'self_extension/self_extension_store.dart';
import 'storage/database.dart';
import 'time/timestamps.dart';
import 'tools/tool_registry.dart';
import 'web/browser_api.dart';
import 'web/fetch_api.dart';
import 'web/http_request_api.dart';
import 'web/image_search_api.dart';
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
    required this.imageSearchApi,
    required this.discordSearch,
    required this.fetchApi,
    required this.browserApi,
    required this.httpRequest,
    required this.memory,
    required this.tasks,
    required this.jobs,
    required this.selfExtensions,
    required this.notices,
    required this.vault,
    required this.attachments,
    required this.transcription,
    required this.contacts,
    required this.calendar,
    this.cursorAgents,
    DateTime? startedAt,
  }) : startedAt = startedAt ?? DateTime.now().toUtc();

  final Config config;

  /// Process start time (UTC), used for uptime in `bot_info`.
  final DateTime startedAt;
  final AppDatabase database;
  final WhitelistService whitelist;
  final LlmGate llmGate;
  final Timestamps timestamps;
  final SearchApi searchApi;
  final ImageSearchApi imageSearchApi;
  final DiscordSearchApi discordSearch;
  final FetchApi fetchApi;
  final BrowserApi browserApi;
  final HttpRequestApi httpRequest;
  final MemoryService memory;
  final TaskStore tasks;
  final JobStore jobs;
  final SelfExtensionStore selfExtensions;
  final NoticeService notices;
  final ObsidianVault vault;
  final AttachmentStore attachments;
  final TranscriptionService transcription;
  final ContactsService contacts;
  final GoogleCalendarClient calendar;

  /// Null when [Config.cursorApiKey] is unset.
  final CursorAgentsClient? cursorAgents;

  /// Set once after the registry has been built (tools like `list_tools`
  /// need to look back into it).
  late final ToolRegistry registry;

  /// Set once after construction — needs [registry] for approved execution.
  late final ApprovalService approvals;

  /// Set once after Agent/history exist — started when Discord connects.
  late final Scheduler scheduler;

  /// Set once after history exists — recovered/started when Discord connects.
  late final JobRunner jobRunner;

  /// Cursor-backed self-extension orchestrator (§6.4).
  late final SelfExtensionRunner selfExtensionRunner;

  /// When true, the process should exit with [ProcessExit.restart] after the
  /// current Discord reply is sent (§6.4).
  bool restartRequested = false;

  void requestRestart() {
    restartRequested = true;
  }

  /// Exits with code 42 when [requestRestart] was called. Safe to call after
  /// a turn or approval follow-up has finished posting.
  ///
  /// Queued interactive big-model jobs are lost across restart; notify their
  /// origin channels so the user can re-send (§5.1).
  void exitIfRestartRequested() {
    if (!restartRequested) return;
    for (final channelId in llmGate.queuedOriginChannels()) {
      notices.enqueue(
        channelId: channelId,
        message:
            "I'm restarting — please re-send your request when I'm back online.",
      );
    }
    stdout.writeln(
        'Restart requested — exiting with code ${ProcessExit.restart}.');
    exit(ProcessExit.restart);
  }
}
