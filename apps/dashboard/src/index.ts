import { loadConfig, loadDotEnv } from "./config.js";
import { buildServer } from "./server.js";

async function main() {
  // npm runs workspace scripts inside apps/dashboard: resolve .env and DATA_DIR from where npm was started.
  if (process.env.INIT_CWD) process.chdir(process.env.INIT_CWD);
  loadDotEnv();
  const config = loadConfig();
  const app = await buildServer({ config, logger: { level: process.env.LOG_LEVEL ?? "info" } });

  await app.listen({ port: config.port, host: config.host });

  const description = await app.postSync.describe();
  const ready = description.connectors.filter((c) => c.configured).map((c) => c.name);
  app.log.info(config.dashboard ? `Dashboard: ${config.siteUrl}` : `Headless mode: API at ${config.siteUrl}/api`);
  app.log.info(`Platforms ready to connect: ${ready.join(", ")}`);
  if (config.databaseUrl) app.log.info("Storage: PostgreSQL");
  if (!config.runWorker) app.log.info("WORKER=off: this process serves the API only; another one publishes.");
  if (!description.publicMediaReachable) {
    app.log.warn(
      "PUBLIC_BASE_URL points to a private address. Instagram photo posts and Threads media posts need a public URL (deploy, or use a tunnel such as cloudflared/ngrok).",
    );
  }
  if (!description.ffmpeg) app.log.warn("ffmpeg/ffprobe not found: video checks and automatic image conversion are disabled.");

  // First Ctrl+C: start nothing new and wait for posts that are publishing (a video can take minutes). Second: stop now.
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      if (stopping) {
        app.log.warn("Stopping now. Posts that were still publishing are reported as interrupted next time.");
        process.exit(1);
      }
      stopping = true;
      app.log.info(`${signal} received: waiting for posts that are publishing to finish (press Ctrl+C again to stop now)…`);
      await app.postSync.worker.stop(6 * 3600_000);
      await app.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
