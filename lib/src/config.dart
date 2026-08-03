/// Typed access to all environment configuration (ARCHITECTURE.md §15).
class Config {
  Config({
    required this.discordBotToken,
    required this.ownerUserId,
    required this.allowedChannelIds,
    required this.ollamaBaseUrl,
    required this.ollamaModel,
    required this.ollamaUtilityModel,
    required this.ollamaVisionModel,
    required this.browserApiBaseUrl,
    required this.browserUserAgent,
    required this.windowsMonitorBaseUrl,
    required this.gpuBusyThresholdPercent,
    required this.gpuPollInterval,
    required this.dataDir,
    required this.botTimezone,
    required this.obsidianEmail,
    required this.obsidianPassword,
    required this.obsidianVaultName,
    required this.obsidianE2eePassword,
    required this.obsidianVaultDir,
    required this.whisperModel,
    required this.maxAttachmentMb,
    required this.googleCalendarId,
    required this.cursorApiKey,
    required this.cursorRepoUrl,
    required this.cursorStartingRef,
    required this.cursorModel,
  });

  final String discordBotToken;
  final String ownerUserId;
  final Set<String> allowedChannelIds;
  final Uri ollamaBaseUrl;
  final String ollamaModel;

  /// CPU-only fallback model used while the GPU is busy (§5.1).
  /// Null = utility tier disabled.
  final String? ollamaUtilityModel;

  /// Multimodal model for screenshot description (`browse_url`). Null = vision
  /// summaries disabled.
  final String? ollamaVisionModel;

  /// Chromium CDP HTTP base (`http://host:9222`). Null = browse tools unavailable.
  final Uri? browserApiBaseUrl;

  /// UA applied via CDP for browse/screenshot (default = Chrome desktop).
  final String browserUserAgent;

  /// GPU monitor sidecar on the machine hosting Ollama. Null = gating
  /// disabled (local development).
  final Uri? windowsMonitorBaseUrl;

  final double gpuBusyThresholdPercent;
  final Duration gpuPollInterval;
  final String dataDir;
  final String botTimezone;

  /// Obsidian Headless credentials (§13). All three required for sync.
  final String? obsidianEmail;
  final String? obsidianPassword;
  final String? obsidianVaultName;
  final String? obsidianE2eePassword;

  /// Local vault sync target (default `$DATA_DIR/vault`).
  final String obsidianVaultDir;

  /// whisper.cpp model name without `ggml-` / `.bin` (§10), default `small`.
  final String whisperModel;

  /// Max attachment download size in megabytes (§10).
  final int maxAttachmentMb;

  /// Optional override for the Egon write calendar id (§12).
  final String? googleCalendarId;

  /// Cursor Cloud Agents API key (§6.4). Null = `extend_self` unavailable.
  final String? cursorApiKey;

  /// GitHub repo URL for cloud self-extension agents.
  final String cursorRepoUrl;

  /// Branch / ref cloud agents start from (deploy watches `master`).
  final String cursorStartingRef;

  /// Optional Cursor model id for cloud agents. Null = account default.
  final String? cursorModel;

  /// True when email, password, and vault name are all set.
  bool get obsidianSyncConfigured =>
      obsidianEmail != null &&
      obsidianPassword != null &&
      obsidianVaultName != null;

  /// True when Cursor Cloud Agents can be used for `extend_self`.
  bool get cursorConfigured => cursorApiKey != null && cursorApiKey!.isNotEmpty;

  /// Builds a config from an env lookup. Throws [ConfigError] when a
  /// required variable is missing.
  factory Config.fromEnv(String? Function(String key) env) {
    final token = env('DISCORD_BOT_TOKEN');
    if (token == null || token.isEmpty) {
      throw ConfigError('Missing DISCORD_BOT_TOKEN.');
    }
    final owner = env('OWNER_USER_ID');
    if (owner == null || owner.isEmpty) {
      throw ConfigError('Missing OWNER_USER_ID.');
    }

    final channels = (env('ALLOWED_CHANNEL_IDS') ?? '')
        .split(',')
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toSet();

    final rawUtility = env('OLLAMA_UTILITY_MODEL') ?? 'llama3.2:3b';
    final rawMonitor = env('WINDOWS_MONITOR_API_BASE_URL');
    final rawBrowser = env('BROWSER_API_BASE_URL');
    final dataDir = env('DATA_DIR') ?? '/data';

    String? optional(String key) {
      final v = env(key)?.trim();
      if (v == null || v.isEmpty) return null;
      return v;
    }

    return Config(
      discordBotToken: token,
      ownerUserId: owner,
      allowedChannelIds: channels,
      ollamaBaseUrl: Uri.parse(
        env('OLLAMA_API_BASE_URL') ?? 'http://127.0.0.1:11434',
      ),
      ollamaModel: env('OLLAMA_MODEL') ?? 'gpt-oss:20b',
      ollamaUtilityModel: rawUtility.isEmpty ? null : rawUtility,
      ollamaVisionModel: optional('OLLAMA_VISION_MODEL'),
      browserApiBaseUrl: rawBrowser == null || rawBrowser.isEmpty
          ? null
          : Uri.parse(rawBrowser),
      browserUserAgent: optional('BROWSER_USER_AGENT') ??
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      windowsMonitorBaseUrl: rawMonitor == null || rawMonitor.isEmpty
          ? null
          : Uri.parse(rawMonitor),
      gpuBusyThresholdPercent:
          double.tryParse(env('GPU_BUSY_THRESHOLD_PERCENT') ?? '') ?? 40.0,
      gpuPollInterval: Duration(
        seconds: int.tryParse(env('GPU_POLL_INTERVAL_SECONDS') ?? '') ?? 60,
      ),
      dataDir: dataDir,
      botTimezone: env('BOT_TIMEZONE') ?? 'Europe/Berlin',
      obsidianEmail: optional('OBSIDIAN_EMAIL'),
      obsidianPassword: optional('OBSIDIAN_PASSWORD'),
      obsidianVaultName: optional('OBSIDIAN_VAULT_NAME'),
      obsidianE2eePassword: optional('OBSIDIAN_E2EE_PASSWORD'),
      obsidianVaultDir: optional('OBSIDIAN_VAULT_DIR') ?? '$dataDir/vault',
      whisperModel: optional('WHISPER_MODEL') ?? 'small',
      maxAttachmentMb: int.tryParse(env('MAX_ATTACHMENT_MB') ?? '') ?? 25,
      googleCalendarId: optional('GOOGLE_CALENDAR_ID'),
      cursorApiKey: optional('CURSOR_API_KEY'),
      cursorRepoUrl: optional('CURSOR_REPO_URL') ??
          'https://github.com/mbuelowdev/egon-bot',
      cursorStartingRef: optional('CURSOR_STARTING_REF') ?? 'master',
      cursorModel: optional('CURSOR_MODEL'),
    );
  }

  @override
  String toString() =>
      'Config(owner: $ownerUserId, channels: ${allowedChannelIds.length}, '
      'ollama: $ollamaBaseUrl model: $ollamaModel utility: '
      '${ollamaUtilityModel ?? '-'}, vision: ${ollamaVisionModel ?? '-'}, '
      'browser: ${browserApiBaseUrl ?? '-'}, '
      'monitor: ${windowsMonitorBaseUrl ?? '-'}, '
      'dataDir: $dataDir, tz: $botTimezone, vault: $obsidianVaultDir, '
      'obsidianSync: ${obsidianSyncConfigured ? 'configured' : 'off'}, '
      'whisper: $whisperModel, maxAttachMb: $maxAttachmentMb, '
      'googleCal: ${googleCalendarId ?? 'auto'}, '
      'cursor: ${cursorConfigured ? 'configured' : 'off'}, '
      'token: <redacted>, obsidianPassword: <redacted>, '
      'cursorApiKey: <redacted>)';
}

class ConfigError implements Exception {
  ConfigError(this.message);
  final String message;

  @override
  String toString() => 'ConfigError: $message';
}
