import '../../package_meta.dart';
import '../tool.dart';

/// Identity and non-secret runtime config (distinct from [StatusOverviewTool]).
class BotInfoTool extends Tool {
  BotInfoTool({PackageMeta? packageMeta})
      : _packageMeta = packageMeta ?? PackageMeta();

  final PackageMeta _packageMeta;

  static const repositoryUrl = 'https://github.com/mbuelowdev/egon-bot';

  @override
  String get name => 'bot_info';

  @override
  String get description =>
      'Returns bot identity and non-secret runtime config: package/'
      'deployment version, uptime, timezone, models, GPU gate, and which '
      'integrations are configured. Use when asked which version you are, '
      'how you are configured, or for about/identity questions. '
      'For live jobs/tasks/approvals use status_overview instead.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': <String, Object?>{},
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final services = context.services;
    final config = services.config;
    final now = DateTime.now().toUtc();
    final gpuFree = await services.llmGate.isGpuFree();
    final gate = services.llmGate;

    return ToolResult.ok({
      'package_version': _packageMeta.packageVersion(),
      'deployment_version': _packageMeta.deploymentVersion(),
      'repository': repositoryUrl,
      'started_at': services.startedAt.toIso8601String(),
      'uptime_seconds': now.difference(services.startedAt).inSeconds,
      'timezone': config.botTimezone,
      'local_now': services.timestamps.now(),
      'owner_user_id': config.ownerUserId,
      'allowed_channel_ids': config.allowedChannelIds.toList()..sort(),
      'data_dir': config.dataDir,
      'ollama': {
        'base_url': config.ollamaBaseUrl.toString(),
        'model': config.ollamaModel,
        'utility_model': config.ollamaUtilityModel,
        'vision_model': config.ollamaVisionModel,
      },
      'gpu_gate': {
        'enabled': config.windowsMonitorBaseUrl != null,
        'free': gpuFree,
        'utility_tier': gate.hasUtilityTier,
        'busy_threshold_percent': config.gpuBusyThresholdPercent,
      },
      'integrations': {
        'browser_api': config.browserApiBaseUrl?.toString(),
        'obsidian_sync_configured': config.obsidianSyncConfigured,
        'vault_available': services.vault.isAvailable,
        'calendar_configured': services.calendar.isConfigured,
        'whisper_model': config.whisperModel,
        'max_attachment_mb': config.maxAttachmentMb,
      },
      'tool_count': services.registry.all.length,
    });
  }
}
