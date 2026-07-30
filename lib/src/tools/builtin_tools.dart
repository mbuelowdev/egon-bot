import 'builtin/cancel_scheduled_task_tool.dart';
import 'builtin/fetch_url_tool.dart';
import 'builtin/forget_memory_tool.dart';
import 'builtin/list_memories_tool.dart';
import 'builtin/list_scheduled_tasks_tool.dart';
import 'builtin/list_tools_tool.dart';
import 'builtin/recall_memories_tool.dart';
import 'builtin/remember_tool.dart';
import 'builtin/schedule_task_tool.dart';
import 'builtin/unwhitelist_user_tool.dart';
import 'builtin/web_search_tool.dart';
import 'builtin/whitelist_user_tool.dart';
import 'tool.dart';

/// Hand-written tool list. Replaced by generated registration
/// (`tool_registry.g.dart`) in Phase 5 when self-written tools arrive.
List<Tool> buildBuiltinTools() => [
      ListToolsTool(),
      WebSearchTool(),
      FetchUrlTool(),
      WhitelistUserTool(),
      UnwhitelistUserTool(),
      RememberTool(),
      RecallMemoriesTool(),
      ForgetMemoryTool(),
      ListMemoriesTool(),
      ScheduleTaskTool(),
      ListScheduledTasksTool(),
      CancelScheduledTaskTool(),
    ];
