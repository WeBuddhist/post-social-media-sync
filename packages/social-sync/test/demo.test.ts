/**
 * Demo mode: simulated accounts that go through the whole flow (connect, publish, retry, check, events) without
 * calling any platform.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostSync, type PostSync, type PostSyncEventName, type PostSyncOptions, type PublicAccount } from "../src/index.js";
import { DEMO_OFF_MESSAGE } from "../src/platforms/demo.js";
import { sqliteStorage } from "../src/storage/sqlite.js";
import { tempDir, TEST_SECRET } from "./helpers.js";

const OWNER = "alice";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const engines: PostSync[] = [];
let sleeps: number[];
let fetchSpy: ReturnType<typeof vi.fn>;

async function makeEngine(overrides: Partial<PostSyncOptions> = {}): Promise<PostSync> {
  const engine = await createPostSync({
    secret: TEST_SECRET,
    publicUrl: "https://posts.example.com",
    storage: sqliteStorage(":memory:"),
    mediaDir: tempDir(),
    logger: false,
    worker: { autoStart: false },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    demo: true,
    ...overrides,
  });
  engines.push(engine);
  return engine;
}

const realNow = Date.now;
let clockOffset = 0;
function advanceClock(ms: number): void {
  clockOffset += ms;
  vi.spyOn(Date, "now").mockImplementation(() => realNow.call(Date) + clockOffset);
}

function record(sync: PostSync, names: PostSyncEventName[]) {
  const events: Array<{ name: PostSyncEventName; payload: any }> = [];
  for (const name of names) sync.on(name, (payload) => events.push({ name, payload }));
  return events;
}

async function connectDemo(sync: PostSync, name?: string): Promise<PublicAccount[]> {
  return sync.connect.withCredentials(OWNER, "demo", name === undefined ? {} : { name });
}

const byPlatform = (accounts: PublicAccount[], platform: string) => accounts.find((a) => a.platform === platform)!;

beforeEach(() => {
  sleeps = [];
  // Demo mode must never reach the network.
  fetchSpy = vi.fn(async () => {
    throw new Error("demo mode called fetch");
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  expect(fetchSpy).not.toHaveBeenCalled();
  clockOffset = 0;
  await Promise.all(engines.splice(0).map((e) => e.close()));
});

describe("demo mode", () => {
  it("is off by default and then offers no demo connector", async () => {
    const sync = await makeEngine({ demo: undefined });
    const d = await sync.describe();
    expect(d.demo).toBe(false);
    expect(d.connectors.map((c) => c.id)).not.toContain("demo");
    await expect(connectDemo(sync)).rejects.toThrow(/Unknown connector "demo"/);
  });

  it("describes the demo connector for the enabled platforms", async () => {
    const sync = await makeEngine({ enabledPlatforms: ["instagram", "x"] });
    const d = await sync.describe();
    expect(d.demo).toBe(true);
    expect(d.connectors.find((c) => c.id === "demo")).toMatchObject({
      name: "Demo accounts",
      kind: "credentials",
      configured: true,
      platforms: ["instagram", "x"],
      redirectUri: null,
      credentialFields: [expect.objectContaining({ key: "name", type: "text" })],
    });
    expect(d.connectors.find((c) => c.id === "demo")!.credentialFields![0].required).toBeFalsy();
    // Real connectors are still listed.
    expect(d.connectors.map((c) => c.id)).toContain("meta");
  });

  it("connects one simulated account per enabled platform", async () => {
    const sync = await makeEngine({ enabledPlatforms: ["instagram", "x", "bluesky"] });
    const connected = record(sync, ["account.connected"]);
    const accounts = await connectDemo(sync, "  Acme  ");
    expect(accounts.map((a) => a.platform).sort()).toEqual(["bluesky", "instagram", "x"]);
    for (const a of accounts) expect(a).toMatchObject({ connector: "demo", status: "active", ownerId: OWNER, expiresAt: null });
    expect(byPlatform(accounts, "instagram").name).toBe("Acme (Instagram)");
    expect(connected).toHaveLength(1);

    const row = await sync.db.getAccount(OWNER, byPlatform(accounts, "x").id);
    expect(row!.external_id).toMatch(/^demo-x-[\w-]+$/);
    expect(JSON.parse(row!.meta)).toEqual({ demo: true });
    expect(sync.secrets.decrypt(row!.credentials)).toEqual({});

    // Without a name: "Demo (…)". Connecting again adds another set.
    const more = await connectDemo(sync);
    expect(byPlatform(more, "x").name).toBe("Demo (X)");
    expect(await sync.accounts.list(OWNER)).toHaveLength(6);
  });

  it("publishes to demo accounts with progress, a fake link and the usual events", async () => {
    const sync = await makeEngine();
    const accounts = await connectDemo(sync);
    const events = record(sync, ["post.created", "target.started", "target.progress", "target.succeeded", "target.failed"]);
    const media = await sync.media.fromBuffer(OWNER, PNG, "dot.png");
    const targets = ["instagram", "x", "bluesky"].map((p) => ({ accountId: byPlatform(accounts, p).id }));
    const post = await sync.posts.create(OWNER, { text: "Hello from the demo", mediaIds: [media.id], targets });

    expect(await sync.worker.runDue()).toEqual({ processed: 3 });
    const done = (await sync.posts.get(OWNER, post.id))!;
    for (const t of done.targets) {
      expect(t.status).toBe("succeeded");
      expect(t.remoteId).toMatch(/^demo_/);
      expect(t.remoteUrl).toBe(`https://demo.post-sync.invalid/${t.platform}/${t.remoteId}`);
      expect(t.progress).toMatch(/^Demo post: nothing was published to /);
    }
    expect(events.filter((e) => e.name === "target.succeeded")).toHaveLength(3);
    expect(events.filter((e) => e.name === "target.failed")).toHaveLength(0);
    const progress = events.filter((e) => e.name === "target.progress").map((e) => e.payload.message);
    expect(progress).toContain("Demo: uploading the photo…");
    expect(progress.every((m) => m.startsWith("Demo: "))).toBe(true);
    // The waits go through the (stubbed) sleep, so tests stay instant.
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it("still applies each platform's rules when the post is created", async () => {
    const sync = await makeEngine();
    const accounts = await connectDemo(sync);
    const instagram = byPlatform(accounts, "instagram");
    // Instagram needs a photo or video.
    const issues = await sync.posts.validate(OWNER, { text: "no media", targets: [{ accountId: instagram.id }] });
    expect(issues[0].errors.join(" ")).toMatch(/Instagram needs a photo or video/);
    await expect(sync.posts.create(OWNER, { text: "x".repeat(400), targets: [{ accountId: byPlatform(accounts, "bluesky").id }] })).rejects.toThrow(
      /Bluesky allows 300 characters/,
    );
  });

  it("works on a private address, noting what a real account would run into", async () => {
    const sync = await makeEngine({ publicUrl: "http://localhost:3000/api" });
    const instagram = byPlatform(await connectDemo(sync), "instagram");
    const media = await sync.media.fromBuffer(OWNER, PNG, "dot.png");
    expect((await sync.posts.validate(OWNER, { text: "hi", mediaIds: [media.id], targets: [{ accountId: instagram.id }] }))[0].errors).toEqual([]);
    const post = await sync.posts.create(OWNER, { text: "hi", mediaIds: [media.id], targets: [{ accountId: instagram.id }] });
    await sync.worker.runDue();
    const [t] = (await sync.posts.get(OWNER, post.id))!.targets;
    expect(t.status).toBe("succeeded");
    expect(t.progress).toMatch(/A real account would fail here: Instagram downloads photos from this server/);
  });

  it('fails for good with "#fail" in the caption', async () => {
    const sync = await makeEngine();
    const x = byPlatform(await connectDemo(sync), "x");
    const failed = record(sync, ["target.failed"]);
    const post = await sync.posts.create(OWNER, { text: "This one breaks #fail", targets: [{ accountId: x.id }] });
    await sync.worker.runDue();
    const [t] = (await sync.posts.get(OWNER, post.id))!.targets;
    expect(t).toMatchObject({ status: "failed", attempts: 1, remoteId: null });
    expect(t.error).toMatch(/simulated by #fail/);
    expect(failed[0].payload).toMatchObject({ willRetry: false, retryAt: null });

    // "#failure" is another hashtag.
    const ok = await sync.posts.create(OWNER, { text: "No #failure here", targets: [{ accountId: x.id }] });
    await sync.worker.runDue();
    expect((await sync.posts.get(OWNER, ok.id))!.targets[0].status).toBe("succeeded");
  });

  it('retries "#flaky" posts after a temporary failure, and manual retry works after "#fail"', async () => {
    const sync = await makeEngine();
    const bluesky = byPlatform(await connectDemo(sync), "bluesky");
    const failed = record(sync, ["target.failed"]);
    const post = await sync.posts.create(OWNER, { text: "Sometimes works #Flaky", targets: [{ accountId: bluesky.id }] });

    await sync.worker.runDue();
    let [t] = (await sync.posts.get(OWNER, post.id))!.targets;
    expect(t).toMatchObject({ status: "queued", attempts: 1 });
    expect(t.error).toMatch(/temporarily unavailable \(simulated by #flaky\) — retrying in 1 min/);
    expect(failed[0].payload.willRetry).toBe(true);

    // Not due yet.
    expect(await sync.worker.runDue()).toEqual({ processed: 0 });
    advanceClock(62_000);
    expect(await sync.worker.runDue()).toEqual({ processed: 1 });
    [t] = (await sync.posts.get(OWNER, post.id))!.targets;
    expect(t).toMatchObject({ status: "succeeded", attempts: 2, error: null });

    // A permanent failure can be retried by hand (it fails again: the caption still says #fail).
    const bad = await sync.posts.create(OWNER, { text: "#fail", targets: [{ accountId: bluesky.id }] });
    await sync.worker.runDue();
    const [b] = (await sync.posts.get(OWNER, bad.id))!.targets;
    const before = failed.length;
    expect(await sync.targets.retry(OWNER, b.id)).toBe(true);
    expect(await sync.worker.runDue()).toEqual({ processed: 1 });
    expect((await sync.posts.get(OWNER, bad.id))!.targets[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(failed).toHaveLength(before + 1);
  });

  it("checks demo accounts without the network", async () => {
    const sync = await makeEngine();
    const tiktok = byPlatform(await connectDemo(sync), "tiktok");
    expect(await sync.accounts.check(OWNER, tiktok.id)).toEqual({
      ok: true,
      detail: "Demo account: posts to TikTok are simulated, nothing is published.",
    });
  });

  it("refuses to use demo accounts while demo mode is off", async () => {
    const file = path.join(tempDir(), "post-sync.db");
    const on = await makeEngine({ storage: sqliteStorage(file) });
    const accounts = await connectDemo(on);
    const x = byPlatform(accounts, "x");
    // Queued while demo mode was on, published after it was turned off.
    const queued = await on.posts.create(OWNER, { text: "queued earlier", targets: [{ accountId: x.id }] });

    const off = await makeEngine({ storage: sqliteStorage(file), demo: false });
    // Still listed (and labelled by their connector), but unusable.
    expect((await off.accounts.list(OWNER)).every((a) => a.connector === "demo")).toBe(true);
    expect(await off.accounts.check(OWNER, x.id)).toEqual({ ok: false, error: DEMO_OFF_MESSAGE, needsReconnect: false });
    expect((await off.accounts.get(OWNER, x.id))!.status).toBe("active");

    const issues = await off.posts.validate(OWNER, { text: "hi", targets: [{ accountId: x.id }] });
    expect(issues[0].errors).toContain(DEMO_OFF_MESSAGE);
    await expect(off.posts.create(OWNER, { text: "hi", targets: [{ accountId: x.id }] })).rejects.toThrow(/demo mode is off/);

    await off.worker.runDue();
    const [t] = (await off.posts.get(OWNER, queued.id))!.targets;
    expect(t).toMatchObject({ status: "failed", error: DEMO_OFF_MESSAGE, remoteId: null });

    // Disconnecting still works.
    expect(await off.accounts.remove(OWNER, byPlatform(accounts, "bluesky").id)).toBe("deleted");
  });
});
