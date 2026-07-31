// GENERATED — do not edit.
// dart run tool/generate_tool_registry.dart

import 'tool.dart';
import 'builtin/cancel_job_tool.dart';
import 'builtin/cancel_scheduled_task_tool.dart';
import 'builtin/create_tool_tool.dart';
import 'builtin/fetch_url_tool.dart';
import 'builtin/forget_memory_tool.dart';
import 'builtin/list_memories_tool.dart';
import 'builtin/list_scheduled_tasks_tool.dart';
import 'builtin/list_tools_tool.dart';
import 'builtin/obsidian_append_note_tool.dart';
import 'builtin/obsidian_delete_note_tool.dart';
import 'builtin/obsidian_list_notes_tool.dart';
import 'builtin/obsidian_read_note_tool.dart';
import 'builtin/obsidian_search_notes_tool.dart';
import 'builtin/obsidian_write_note_tool.dart';
import 'builtin/recall_memories_tool.dart';
import 'builtin/remember_tool.dart';
import 'builtin/restart_self_tool.dart';
import 'builtin/schedule_task_tool.dart';
import 'builtin/start_job_tool.dart';
import 'builtin/status_overview_tool.dart';
import 'builtin/unwhitelist_user_tool.dart';
import 'builtin/web_search_tool.dart';
import 'builtin/whitelist_user_tool.dart';

/// All tools discovered under builtin/ + generated/.
List<Tool> buildAllTools() => [
      CancelJobTool(),
      CancelScheduledTaskTool(),
      CreateToolTool(),
      FetchUrlTool(),
      ForgetMemoryTool(),
      ListMemoriesTool(),
      ListScheduledTasksTool(),
      ListToolsTool(),
      ObsidianAppendNoteTool(),
      ObsidianDeleteNoteTool(),
      ObsidianListNotesTool(),
      ObsidianReadNoteTool(),
      ObsidianSearchNotesTool(),
      ObsidianWriteNoteTool(),
      RecallMemoriesTool(),
      RememberTool(),
      RestartSelfTool(),
      ScheduleTaskTool(),
      StartJobTool(),
      StatusOverviewTool(),
      UnwhitelistUserTool(),
      WebSearchTool(),
      WhitelistUserTool(),
    ];
