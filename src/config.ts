import { featureSlug } from "./features/slug.js";

const REQUIRED_KEYS = [
  "DISCORD_TOKEN",
  "DISCORD_APP_ID",
  "DISCORD_CHANNEL_ID",
  "DISCORD_GUILD_ID",
  "CURSOR_API_KEY",
  "GAME_REPO_HTTPS_URL",
  "GITHUB_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
] as const;

export type Config = {
  discordToken: string;
  discordAppId: string;
  discordChannelId: string;
  discordGuildId: string;
  cursorApiKey: string;
  gameRepoHttpsUrl: string;
  githubToken: string;
  githubWebhookSecret: string;
  gameRepoDir: string;
  gameRepoBranch: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  cursorModel: string;
  cursorModelParams: Array<{ id: string; value: string }>;
  dataDir: string;
  webServePort: number;
  featuresHttpPort: number;
  featuresPublicUrl: string | undefined;
  gamePublicUrl: string;
  cursorAdminApiKey: string | undefined;
  cursorOrganizationId: string | undefined;
};

function required(env: NodeJS.ProcessEnv, key: (typeof REQUIRED_KEYS)[number]): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return value;
}

function requiredHttpsGitUrl(env: NodeJS.ProcessEnv, key: "GAME_REPO_HTTPS_URL"): string {
  const value = required(env, key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an HTTPS git URL (e.g. https://github.com/org/game.git)`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${key} must be an HTTPS git URL (e.g. https://github.com/org/game.git)`);
  }
  return value;
}

function optionalPort(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${key}: expected an integer port 1-65535`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cursorAdminApiKey = env.CURSOR_ADMIN_API_KEY?.trim();
  const cursorOrganizationId = env.CURSOR_ORGANIZATION_ID?.trim();
  const featuresPublicUrl = env.FEATURES_PUBLIC_URL?.trim();
  const gamePublicUrl = optional(env, "GAME_PUBLIC_URL", "https://lets-vibe-together.mbuelow.dev");
  return {
    discordToken: required(env, "DISCORD_TOKEN"),
    discordAppId: required(env, "DISCORD_APP_ID"),
    discordChannelId: required(env, "DISCORD_CHANNEL_ID"),
    discordGuildId: required(env, "DISCORD_GUILD_ID"),
    cursorApiKey: required(env, "CURSOR_API_KEY"),
    gameRepoHttpsUrl: requiredHttpsGitUrl(env, "GAME_REPO_HTTPS_URL"),
    githubToken: required(env, "GITHUB_TOKEN"),
    githubWebhookSecret: required(env, "GITHUB_WEBHOOK_SECRET"),
    gameRepoDir: optional(env, "GAME_REPO_DIR", "/game"),
    gameRepoBranch: optional(env, "GAME_REPO_BRANCH", "master"),
    gitAuthorName: optional(env, "GIT_AUTHOR_NAME", "Egon"),
    gitAuthorEmail: optional(env, "GIT_AUTHOR_EMAIL", "egon@localhost"),
    cursorModel: optional(env, "CURSOR_MODEL", "grok-4.6"),
    cursorModelParams: [{ id: "reasoning", value: "high" }],
    dataDir: optional(env, "DATA_DIR", "/data"),
    webServePort: optionalPort(env, "WEB_SERVE_PORT", 8080),
    featuresHttpPort: optionalPort(env, "FEATURES_HTTP_PORT", 10001),
    featuresPublicUrl: featuresPublicUrl ? featuresPublicUrl.replace(/\/+$/, "") : undefined,
    gamePublicUrl: gamePublicUrl.replace(/\/+$/, ""),
    cursorAdminApiKey: cursorAdminApiKey ? cursorAdminApiKey : undefined,
    cursorOrganizationId: cursorOrganizationId ? cursorOrganizationId : undefined,
  };
}

export function catalogUrl(config: Config, path = "/"): string | undefined {
  if (!config.featuresPublicUrl) {
    return undefined;
  }
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${config.featuresPublicUrl}${suffix}`;
}

/** Catalog page for a feature, when FEATURES_PUBLIC_URL is set. */
export function featurePageUrl(config: Config, name: string): string | undefined {
  return catalogUrl(config, `/features/${featureSlug(name)}`);
}

export function githubRepoWebUrl(gitHttpsUrl: string): string {
  return gitHttpsUrl.replace(/\.git$/i, "").replace(/\/+$/, "");
}
