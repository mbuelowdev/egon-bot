import { join } from "node:path";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { serveCatalog, stopCatalogServer } from "./catalog/serve.js";
import { loadConfig } from "./config.js";
import { configureCursorSdk } from "./cursor/client.js";
import { registerGuildCommands } from "./discord/commands.js";
import { handleInteraction } from "./discord/handlers.js";
import { bindPresence, refreshPresence } from "./discord/presence.js";
import { FeatureStore } from "./features/store.js";
import { configureGitIdentity } from "./git/accept.js";
import { setupGitHubGitAuth, syncGameRepo } from "./git/repo.js";
import { stopWebServer } from "./godot/serve.js";
import { createPipeline } from "./pipeline/orchestrator.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await setupGitHubGitAuth(config);
  await configureGitIdentity(config);
  await syncGameRepo(config);
  configureCursorSdk(config);

  const store = new FeatureStore(join(config.dataDir, "egon.sqlite"));
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  const pipeline = createPipeline({ client, store, config });
  bindPresence(client, store);

  await serveCatalog({
    store,
    config,
    onGithubEvent: (event) => pipeline.handleGithubEvent(event),
    syncGithub: () => pipeline.catchUpOpenPrs(),
    beforeDelete: (feature) => pipeline.interruptIfLocked(feature.id),
    retry: () => pipeline.retry(),
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    void refreshPresence().catch((error: unknown) => {
      console.error("initial presence refresh failed", error);
    });
    void pipeline.catchUpOpenPrs().catch((error: unknown) => {
      console.error("github catch-up failed", error);
    });
    void pipeline.resumeIfNeeded().catch((error: unknown) => {
      console.error("pipeline resume failed", error);
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, { store, config, client, pipeline }).catch(
      (error: unknown) => {
        console.error("interaction handler failed", error);
      },
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down`);
    await stopWebServer();
    await stopCatalogServer();
    client.destroy();
    store.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    await registerGuildCommands(config);
    await client.login(config.discordToken);
  } catch (error) {
    await stopCatalogServer();
    store.close();
    throw error;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
