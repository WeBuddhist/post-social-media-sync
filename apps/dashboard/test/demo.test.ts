/** DEMO_MODE: simulated accounts through the server's HTTP API, with webhooks, and no platform calls. */
import type { FastifyInstance } from "fastify";
import { sqliteStorage } from "post-social-media-sync/sqlite";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type DashboardConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { API_TOKEN, dashboardConfig, mockFetch, removeTempDirs, tempDir } from "./helpers.js";

const HOOK = "https://hooks.example.com/in";
const headers = { authorization: `Bearer ${API_TOKEN}`, "x-owner-id": "u1" };
const apps: FastifyInstance[] = [];

async function start(overrides: Partial<DashboardConfig> = {}): Promise<FastifyInstance> {
  const app = await buildServer({ config: dashboardConfig(overrides), storage: sqliteStorage(":memory:"), startWorker: false, sleep: async () => {} });
  apps.push(app);
  await app.ready();
  return app;
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  vi.unstubAllEnvs();
});
afterAll(removeTempDirs);

describe("DEMO_MODE", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_DIR", tempDir());
    vi.stubEnv("ADMIN_PASSWORD", "hunter22");
    vi.stubEnv("APP_SECRET", "s".repeat(40));
  });

  it("is off by default and reads on/off", () => {
    vi.stubEnv("DEMO_MODE", undefined);
    expect(loadConfig().demo).toBe(false);
    vi.stubEnv("DEMO_MODE", "on");
    expect(loadConfig().demo).toBe(true);
    vi.stubEnv("DEMO_MODE", "off");
    expect(loadConfig().demo).toBe(false);
    vi.stubEnv("DEMO_MODE", "maybe");
    expect(() => loadConfig()).toThrow(/DEMO_MODE must be on or off/);
  });

  it("offers no demo connector when off", async () => {
    const app = await start();
    const meta = (await app.inject({ url: "/api/meta", headers })).json();
    expect(meta.demo).toBe(false);
    expect(meta.connectors.map((c: any) => c.id)).not.toContain("demo");
    const res = await app.inject({ method: "POST", url: "/api/connect/demo/credentials", headers, payload: { fields: {} } });
    expect(res.statusCode).toBe(400);
  });

  it("connects demo accounts, publishes and delivers webhooks without calling any platform", async () => {
    const { calls } = mockFetch([{ method: "POST", match: HOOK, reply: () => ({ status: 200, json: { ok: true } }) }]);
    const app = await start({ demo: true, webhook: { url: HOOK, secret: "whsec", events: null } });

    const meta = (await app.inject({ url: "/api/meta", headers })).json();
    expect(meta.demo).toBe(true);
    expect(meta.connectors.find((c: any) => c.id === "demo")).toMatchObject({ kind: "credentials", configured: true, envVars: ["DEMO_MODE"] });

    const connected = await app.inject({ method: "POST", url: "/api/connect/demo/credentials", headers, payload: { fields: { name: "Shop" } } });
    expect(connected.statusCode).toBe(201);
    const accounts = connected.json().accounts as any[];
    expect(accounts).toHaveLength(8);
    expect(accounts.every((a) => a.connector === "demo")).toBe(true);
    const x = accounts.find((a) => a.platform === "x");
    expect(x.name).toBe("Shop (X)");

    const check = await app.inject({ method: "POST", url: `/api/accounts/${x.id}/check`, headers });
    expect(check.json()).toMatchObject({ ok: true });

    const created = await app.inject({ method: "POST", url: "/api/posts", headers, payload: { text: "Hello #flaky", targets: [{ accountId: x.id }] } });
    expect(created.statusCode).toBe(201);
    const postId = created.json().post.id;

    await app.postSync.worker.runDue();
    const targetOf = async () => (await app.inject({ url: `/api/posts/${postId}`, headers })).json().post.targets[0];
    let target = await targetOf();
    expect(target.status).toBe("queued");
    expect(target.error).toMatch(/#flaky/);

    // The retry is due a minute later.
    const now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now + 62_000);
    await app.postSync.worker.runDue();
    target = await targetOf();
    expect(target).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(target.remoteUrl).toMatch(/^https:\/\/demo\.post-sync\.invalid\/x\//);

    await vi.waitFor(() => expect(calls.map((c) => c.headers.get("x-post-sync-event"))).toContain("target.succeeded"));
    const events = calls.map((c) => c.headers.get("x-post-sync-event"));
    expect(events).toEqual(expect.arrayContaining(["account.connected", "post.created", "target.started", "target.failed", "target.succeeded"]));
    // Only the webhook was called.
    expect(calls.every((c) => c.url.href === HOOK)).toBe(true);
  });
});
