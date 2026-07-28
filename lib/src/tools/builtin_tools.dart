import 'builtin/fetch_url_tool.dart';
import 'builtin/list_tools_tool.dart';
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
    ];
