/** Brands: each one is its own owner (accounts, media, posts), picked with X-Brand-Id by the dashboard. */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { sqliteStorage } from "post-social-media-sync/sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Brands } from "../src/brands.js";
import type { DashboardConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { API_TOKEN, dashboardConfig, mockFetch, multipart, PASSWORD, PNG, removeTempDirs, SITE, tempDir } from "./helpers.js";

const apps: FastifyInstance[] = [];

async function start(overrides: Partial<DashboardConfig> = {}): Promise<FastifyInstance> {
  const app = await buildServer({ config: dashboardConfig({ demo: true, ...overrides }), storage: sqliteStorage(":memory:"), startWorker: false });
  apps.push(app);
  await app.ready();
  return app;
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
afterAll(removeTempDirs);

function setCookies(res: LightMyRequestResponse): string[] {
  const raw = res.headers["set-cookie"];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [String(raw)];
}

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return setCookies(res)[0].split(";")[0];
}

function api(app: FastifyInstance, method: InjectOptions["method"], url: string, headers: Record<string, string>, payload?: unknown) {
  return app.inject({ method, url: `/api${url}`, headers, ...(payload === undefined ? {} : { payload: payload as any }) });
}

async function createBrand(app: FastifyInstance, cookie: string, name: string): Promise<{ id: string; name: string }> {
  const res = await api(app, "POST", "/brands", { cookie }, { name });
  expect(res.statusCode).toBe(201);
  return res.json().brand;
}

async function addDemoAccounts(app: FastifyInstance, headers: Record<string, string>, name = "Shop") {
  const res = await api(app, "POST", "/connect/demo/credentials", headers, { fields: { name } });
  expect(res.statusCode).toBe(201);
  return res.json().accounts as { id: string; ownerId: string; platform: string }[];
}

describe("brands file", () => {
  it("is created on first run with the brand that owns everything connected before (\"default\")", async () => {
    const config = dashboardConfig({ demo: true });
    const file = path.join(config.dataDir, "brands.json");
    expect(fs.existsSync(file)).toBe(false);
    const app = await buildServer({ config, storage: sqliteStorage(":memory:"), startWorker: false });
    apps.push(app);
    await app.ready();

    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(stored).toEqual([{ id: "default", name: "My brand", createdAt: expect.any(Number) }]);
    expect(fs.readdirSync(config.dataDir).filter((f) => f.startsWith("brands.json."))).toEqual([]); // no temp files left

    // Accounts connected for owner "default" (e.g. before brands existed) show up in that brand.
    await addDemoAccounts(app, { authorization: `Bearer ${API_TOKEN}` });
    const cookie = await login(app);
    expect((await api(app, "GET", "/accounts", { cookie })).json().accounts).toHaveLength(8);
    expect((await api(app, "GET", "/accounts", { cookie, "x-brand-id": "default" })).json().accounts).toHaveLength(8);
  });

  it("keeps an existing file and survives a restart", async () => {
    const dataDir = tempDir();
    const brands = new Brands(dataDir);
    brands.list();
    const created = brands.create("Second brand");
    const app = await start({ dataDir });
    const cookie = await login(app);
    expect((await api(app, "GET", "/brands", { cookie })).json().brands.map((b: any) => [b.id, b.name])).toEqual([
      ["default", "My brand"],
      [created.id, "Second brand"],
    ]);
  });
});

describe("managing brands", () => {
  it("creates brands with ids derived from their names", async () => {
    const app = await start();
    const cookie = await login(app);
    expect(await createBrand(app, cookie, "  Acme Coffee ")).toMatchObject({ id: "acme-coffee", name: "Acme Coffee" });
    expect(await createBrand(app, cookie, "Shop.ai")).toMatchObject({ id: "shop-ai" });
    expect(await createBrand(app, cookie, "Shop ai")).toMatchObject({ id: "shop-ai-2" });
    expect(await createBrand(app, cookie, "Café Ünïcorn")).toMatchObject({ id: "cafe-unicorn" });
    expect(await createBrand(app, cookie, "東京")).toMatchObject({ id: "brand" });
    expect(await createBrand(app, cookie, "Default")).toMatchObject({ id: "default-2" });

    const list = (await api(app, "GET", "/brands", { cookie })).json().brands;
    expect(list.map((b: any) => b.id)).toEqual(["default", "acme-coffee", "shop-ai", "shop-ai-2", "cafe-unicorn", "brand", "default-2"]);
    for (const b of list) expect(b.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses bad and duplicate names", async () => {
    const app = await start();
    const cookie = await login(app);
    for (const name of ["", "   ", "x".repeat(61), "a\nb", 42, null]) {
      const res = await api(app, "POST", "/brands", { cookie }, { name });
      expect(res.statusCode, String(name)).toBe(400);
      expect(res.json().error).toEqual(expect.any(String));
    }
    expect((await api(app, "POST", "/brands", { cookie }, {})).statusCode).toBe(400);
    expect((await api(app, "POST", "/brands", { cookie }, { name: "x".repeat(60) })).statusCode).toBe(201);

    await createBrand(app, cookie, "Acme");
    const dup = await api(app, "POST", "/brands", { cookie }, { name: " acme " });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toMatch(/already a brand called/);
    expect((await api(app, "POST", "/brands", { cookie }, { name: "MY BRAND" })).statusCode).toBe(409);
  });

  it("renames a brand without changing its id", async () => {
    const app = await start();
    const cookie = await login(app);
    const acme = await createBrand(app, cookie, "Acme");
    const renamed = await api(app, "PATCH", `/brands/${acme.id}`, { cookie }, { name: "Acme Studio" });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().brand).toMatchObject({ id: "acme", name: "Acme Studio" });
    expect((await api(app, "PATCH", "/brands/default", { cookie }, { name: "Main" })).json().brand).toMatchObject({ id: "default", name: "Main" });
    // Its own name in another case is fine; another brand's name isn't.
    expect((await api(app, "PATCH", "/brands/acme", { cookie }, { name: "ACME studio" })).statusCode).toBe(200);
    expect((await api(app, "PATCH", "/brands/acme", { cookie }, { name: "main" })).statusCode).toBe(409);
    expect((await api(app, "PATCH", "/brands/acme", { cookie }, { name: "" })).statusCode).toBe(400);
    const missing = await api(app, "PATCH", "/brands/nope", { cookie }, { name: "X" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "Brand not found." });
  });

  it("deletes only brands without accounts or posts, and never the last one", async () => {
    const app = await start();
    const cookie = await login(app);
    const acme = await createBrand(app, cookie, "Acme");
    const headers = { cookie, "x-brand-id": acme.id };
    const account = (await addDemoAccounts(app, headers)).find((a) => a.platform === "x")!;

    const withAccounts = await api(app, "DELETE", `/brands/${acme.id}`, { cookie });
    expect(withAccounts.statusCode).toBe(409);
    expect(withAccounts.json().error).toBe("Acme still has 8 connected accounts. Disconnect its accounts and delete its posts first.");

    const post = await api(app, "POST", "/posts", headers, { text: "Hello", targets: [{ accountId: account.id }] });
    expect(post.statusCode).toBe(201);
    await app.postSync.worker.runDue();
    for (const a of (await api(app, "GET", "/accounts", headers)).json().accounts) {
      expect((await api(app, "DELETE", `/accounts/${a.id}`, headers)).statusCode).toBe(200);
    }
    const withPosts = await api(app, "DELETE", `/brands/${acme.id}`, { cookie });
    expect(withPosts.statusCode).toBe(409);
    expect(withPosts.json().error).toMatch(/^Acme still has posts\./);

    expect((await api(app, "DELETE", `/posts/${post.json().post.id}`, headers)).statusCode).toBe(200);
    const deleted = await api(app, "DELETE", `/brands/${acme.id}`, { cookie });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ ok: true });
    expect((await api(app, "GET", "/brands", { cookie })).json().brands.map((b: any) => b.id)).toEqual(["default"]);
    expect((await api(app, "DELETE", `/brands/${acme.id}`, { cookie })).statusCode).toBe(404);

    const last = await api(app, "DELETE", "/brands/default", { cookie });
    expect(last.statusCode).toBe(409);
    expect(last.json().error).toMatch(/only brand/);
  });

  it("needs a login, and blocks cross-site writes", async () => {
    const app = await start();
    expect((await api(app, "GET", "/brands", {})).statusCode).toBe(401);
    expect((await api(app, "POST", "/brands", {}, { name: "X" })).json()).toEqual({ error: "Not logged in." });
    expect((await api(app, "GET", "/brands", { authorization: "Bearer wrong-token-wrong-token" })).statusCode).toBe(401);

    const cookie = await login(app);
    const evil = await api(app, "POST", "/brands", { cookie, origin: "https://evil.example" }, { name: "X" });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error).toMatch(/Cross-origin/);
    expect((await api(app, "DELETE", "/brands/default", { cookie, origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await api(app, "PATCH", "/brands/default", { cookie, origin: "https://evil.example" }, { name: "Y" })).statusCode).toBe(403);
    expect((await api(app, "POST", "/brands", { cookie, origin: SITE }, { name: "X" })).statusCode).toBe(201);
  });
});

describe("acting for a brand", () => {
  it("keeps accounts, media and posts of one brand invisible to another", async () => {
    const app = await start();
    const cookie = await login(app);
    const a = await createBrand(app, cookie, "Brand A");
    const b = await createBrand(app, cookie, "Brand B");
    const asA = { cookie, "x-brand-id": a.id };
    const asB = { cookie, "x-brand-id": b.id };

    const accounts = await addDemoAccounts(app, asA);
    expect(accounts.every((x) => x.ownerId === a.id)).toBe(true);
    expect((await api(app, "GET", "/accounts", asA)).json().accounts).toHaveLength(8);
    expect((await api(app, "GET", "/accounts", asB)).json().accounts).toEqual([]);
    expect((await api(app, "GET", "/accounts", { cookie })).json().accounts).toEqual([]); // the first brand
    expect((await api(app, "GET", `/accounts/${accounts[0].id}`, asB)).statusCode).toBe(404);
    expect((await api(app, "DELETE", `/accounts/${accounts[0].id}`, asB)).statusCode).toBe(404);

    const form = new FormData();
    form.append("file", new Blob([PNG], { type: "image/png" }), "a.png");
    const { payload, contentType } = await multipart(form);
    const uploaded = await app.inject({ method: "POST", url: "/api/media", headers: { ...asA, "content-type": contentType }, payload });
    expect(uploaded.statusCode).toBe(201);
    const mediaId = uploaded.json().media[0].id;
    expect((await api(app, "GET", `/media/${mediaId}`, asB)).statusCode).toBe(404);

    // Brand B can't post to brand A's accounts or use its media.
    const x = accounts.find((acc) => acc.platform === "x")!;
    const foreign = await api(app, "POST", "/posts", asB, { text: "Hello", targets: [{ accountId: x.id }] });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().error).toMatch(/isn't connected/);
    expect((await api(app, "POST", "/posts", asB, { text: "Hello", platforms: ["x"] })).statusCode).toBe(400);
    const [bx] = (await addDemoAccounts(app, asB, "Other")).filter((acc) => acc.platform === "x");
    expect((await api(app, "POST", "/posts", asB, { text: "Hi", mediaIds: [mediaId], targets: [{ accountId: bx.id }] })).statusCode).toBe(400);

    const created = await api(app, "POST", "/posts", asA, { text: "Hello", mediaIds: [mediaId], targets: [{ accountId: x.id }] });
    expect(created.statusCode).toBe(201);
    const postId = created.json().post.id;
    expect((await api(app, "GET", "/posts", asA)).json().posts.map((p: any) => p.id)).toEqual([postId]);
    expect((await api(app, "GET", "/posts", asB)).json().posts).toEqual([]);
    expect((await api(app, "GET", `/posts/${postId}`, asB)).statusCode).toBe(404);
    expect((await api(app, "DELETE", `/posts/${postId}`, asB)).statusCode).toBe(404);
  });

  it("answers 400 for an unknown brand", async () => {
    const app = await start();
    const cookie = await login(app);
    for (const url of ["/accounts", "/posts", "/meta"]) {
      const res = await api(app, "GET", url, { cookie, "x-brand-id": "nope" });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error).toMatch(/Unknown brand/);
    }
    expect((await api(app, "POST", "/connect/demo/credentials", { cookie, "x-brand-id": "nope" }, { fields: {} })).statusCode).toBe(400);
    expect((await api(app, "GET", "/connect/demo?brand=nope", { cookie })).statusCode).toBe(400);
    // Brands themselves don't depend on the selected brand.
    expect((await api(app, "GET", "/brands", { cookie, "x-brand-id": "nope" })).statusCode).toBe(200);
  });

  it("ignores X-Brand-Id for API_TOKEN callers: X-Owner-Id works as before", async () => {
    const app = await start();
    const cookie = await login(app);
    const a = await createBrand(app, cookie, "Brand A");
    const bearer = { authorization: `Bearer ${API_TOKEN}` };

    await addDemoAccounts(app, { ...bearer, "x-owner-id": "u1" });
    expect((await api(app, "GET", "/accounts", { ...bearer, "x-owner-id": "u1", "x-brand-id": a.id })).json().accounts).toHaveLength(8);
    expect((await api(app, "GET", "/accounts", { ...bearer, "x-owner-id": "u1", "x-brand-id": "nope" })).statusCode).toBe(200);
    expect((await api(app, "GET", "/accounts", { ...bearer, "x-brand-id": a.id })).json().accounts).toEqual([]); // owner "default"
    expect((await api(app, "GET", "/accounts", { ...bearer, "x-owner-id": "has space" })).statusCode).toBe(400);
    expect((await api(app, "GET", "/accounts", { cookie, "x-brand-id": a.id })).json().accounts).toEqual([]); // u1 isn't a brand

    // A backend can act for a brand with its id as the owner, and manage brands.
    await addDemoAccounts(app, { cookie, "x-brand-id": a.id });
    expect((await api(app, "GET", "/accounts", { ...bearer, "x-owner-id": a.id })).json().accounts).toHaveLength(8);
    expect((await api(app, "GET", "/brands", bearer)).json().brands).toHaveLength(2);
    expect((await api(app, "POST", "/brands", bearer, { name: "From a script" })).statusCode).toBe(201);
  });
});

const META_KEYS = { meta: { appId: "meta-app", appSecret: "meta-secret" } };

function mockMeta() {
  return mockFetch([
    { method: "GET", match: "https://graph.facebook.com/v26.0/oauth/access_token", reply: () => ({ json: { access_token: "T" } }) },
    {
      method: "GET",
      match: "https://graph.facebook.com/v26.0/me/permissions",
      reply: () => ({ json: { data: ["pages_show_list", "pages_manage_posts"].map((permission) => ({ permission, status: "granted" })) } }),
    },
    {
      method: "GET",
      match: "https://graph.facebook.com/v26.0/me/accounts",
      reply: () => ({ json: { data: [{ id: "page-1", name: "My Page", access_token: "PT", tasks: ["CREATE_CONTENT"] }] } }),
    },
  ]);
}

describe("connecting accounts for a brand", () => {
  it("saves an OAuth login started with ?brand= for that brand and returns to it", async () => {
    const app = await start({ platforms: META_KEYS });
    const cookie = await login(app);
    const b = await createBrand(app, cookie, "Brand B");
    const returnTo = encodeURIComponent(`/?brand=${b.id}#accounts`);

    const res = await api(app, "GET", `/connect/meta?returnTo=${returnTo}&brand=${b.id}`, { cookie });
    expect(res.statusCode).toBe(302);
    const binding = setCookies(res)[0].split(";")[0];
    const state = new URL(String(res.headers.location)).searchParams.get("state");

    mockMeta();
    // The browser comes back with its session and the binding cookie, but nothing naming the brand.
    const callback = await app.inject({ url: `/api/oauth/meta/callback?code=CODE&state=${state}`, headers: { cookie: `${cookie}; ${binding}` } });
    expect(callback.statusCode).toBe(302);
    const back = new URL(String(callback.headers.location));
    expect(back.origin + back.pathname + back.hash).toBe(`${SITE}/#accounts`);
    expect(Object.fromEntries(back.searchParams)).toEqual({ brand: b.id, postsync: "connected", connector: "Facebook & Instagram", count: "1" });

    expect((await api(app, "GET", "/accounts", { cookie, "x-brand-id": b.id })).json().accounts).toEqual([
      expect.objectContaining({ platform: "facebook", ownerId: b.id }),
    ]);
    expect((await api(app, "GET", "/accounts", { cookie })).json().accounts).toEqual([]);
  });

  it("refuses to confirm a login for another brand than the one that started it", async () => {
    const app = await start({ platforms: META_KEYS });
    const cookie = await login(app);
    const b = await createBrand(app, cookie, "Brand B");
    const started = await api(app, "POST", "/connect/meta", { cookie, "x-brand-id": b.id }, { returnTo: `/?brand=${b.id}#accounts` });
    expect(started.statusCode).toBe(200);
    const state = new URL(started.json().url).searchParams.get("state");

    mockMeta();
    const callback = await app.inject({ url: `/api/oauth/meta/callback?code=CODE&state=${state}` });
    const back = new URL(String(callback.headers.location));
    expect(back.searchParams.get("brand")).toBe(b.id);
    expect(back.searchParams.get("postsync")).toBe("confirm");
    const confirm = back.searchParams.get("confirm")!;

    // The first brand can't take it (which uses the token up).
    expect((await api(app, "POST", "/connect/confirm", { cookie }, { confirm })).statusCode).toBe(403);
    expect((await api(app, "GET", "/accounts", { cookie })).json().accounts).toEqual([]);
  });

  it("confirms a login the callback couldn't tie to this browser for the brand that started it", async () => {
    const app = await start({ platforms: META_KEYS });
    const cookie = await login(app);
    const b = await createBrand(app, cookie, "Brand B");
    const started = await api(app, "POST", "/connect/meta", { cookie, "x-brand-id": b.id }, { returnTo: `/?brand=${b.id}#accounts` });
    const state = new URL(started.json().url).searchParams.get("state");
    mockMeta();
    const callback = await app.inject({ url: `/api/oauth/meta/callback?code=CODE&state=${state}` });
    const confirm = new URL(String(callback.headers.location)).searchParams.get("confirm")!;
    const confirmed = await api(app, "POST", "/connect/confirm", { cookie, "x-brand-id": b.id }, { confirm });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().accounts).toEqual([expect.objectContaining({ platform: "facebook", ownerId: b.id })]);
  });
});
