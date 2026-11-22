/**
 * Demo mode: simulated accounts for trying the whole flow (connect, compose, publish, history, retry, events,
 * webhooks) before you have real social accounts or app keys. Nothing here calls the network.
 *
 * Captions can steer the simulation: "#fail" fails for good, "#flaky" fails with a temporary error on the first
 * attempt (so the queue retries it) and then succeeds.
 */
import { randomToken } from "../crypto.js";
import { ApiError, UserError } from "../http.js";
import { publicMediaProblem } from "./common.js";
import { PLATFORMS } from "./index.js";
import type { AccountDraft, CheckContext, Connector, Platform, PublishContext, PublishResult } from "./types.js";

export const DEMO_CONNECTOR_ID = "demo";
export const DEMO_OFF_MESSAGE = "This is a demo account, and demo mode is off. Turn demo mode on to use it, or disconnect it.";
/** Host of the fake post links (".invalid" never resolves). */
export const DEMO_URL_BASE = "https://demo.post-sync.invalid";

const MAX_NAME_LENGTH = 60;

/** Whether an account (a stored row or its public form) is a simulated demo account. */
export function isDemoAccount(account: { connector: string }): boolean {
  return account.connector === DEMO_CONNECTOR_ID;
}

const hashtag = (text: string, tag: string) => new RegExp(`(^|[^\\p{L}\\p{N}_])#${tag}(?![\\p{L}\\p{N}_])`, "iu").test(text);

export const demoConnector: Connector = {
  id: DEMO_CONNECTOR_ID,
  name: "Demo accounts",
  platforms: Object.keys(PLATFORMS) as Platform["id"][],
  kind: "credentials",
  isConfigured: () => true,
  credentialFields: [
    {
      key: "name",
      label: "Name (optional)",
      type: "text",
      placeholder: "Demo",
      help: 'Adds one simulated account per platform. Nothing is ever posted. Put "#fail" in a caption to see a failure, "#flaky" to see a retry.',
    },
  ],

  async connectWithCredentials(_config, fields) {
    const name = String(fields.name ?? "").trim().slice(0, MAX_NAME_LENGTH) || "Demo";
    return Object.values(PLATFORMS).map(
      (p): AccountDraft => ({
        platform: p.id,
        externalId: `demo-${p.id}-${randomToken(6)}`,
        name: `${name} (${p.name})`,
        username: null,
        credentials: {},
        meta: { demo: true },
      }),
    );
  },
};

/**
 * Simulates publishing to `platform`: reports a few progress steps and returns a fake post id and link.
 * `attempt` is the job's attempt number (1 for the first).
 */
export async function publishDemo(platform: Platform, ctx: PublishContext, attempt: number): Promise<PublishResult> {
  const { input } = ctx;
  if (!ctx.config.demo) throw new UserError(DEMO_OFF_MESSAGE);
  const step = async (message: string, ms: number) => {
    ctx.progress(`Demo: ${message}`);
    await ctx.sleep(ms);
  };

  await step(`connecting to ${platform.name}…`, 400);
  if (input.media.length) {
    const what = input.media.length === 1 ? (input.media[0].kind === "video" ? "the video" : "the photo") : `${input.media.length} files`;
    await step(`uploading ${what}…`, 800);
  }
  if (hashtag(input.text, "flaky") && attempt <= 1) {
    throw new ApiError(`Demo: ${platform.name} is temporarily unavailable (simulated by #flaky)`, 503, null, true);
  }
  if (hashtag(input.text, "fail")) {
    throw new ApiError(`Demo: ${platform.name} rejected the post (simulated by #fail)`, 400, null, false);
  }
  if (input.media.some((m) => m.kind === "video")) await step(`waiting for ${platform.name} to process the video…`, 1200);
  await step("publishing…", 400);

  const remoteId = `demo_${randomToken(9)}`;
  // What a real account would run into: the platform couldn't download media from a private address.
  const warning = publicMediaProblem(platform, input, ctx.config);
  return {
    remoteId,
    url: `${DEMO_URL_BASE}/${platform.id}/${remoteId}`,
    note: `Demo post: nothing was published to ${platform.name}.${warning ? ` A real account would fail here: ${warning}` : ""}`,
  };
}

/** The connection check for a demo account. */
export async function checkDemo(platform: Platform, ctx: CheckContext): Promise<string> {
  if (!ctx.config.demo) throw new UserError(DEMO_OFF_MESSAGE);
  return `Demo account: posts to ${platform.name} are simulated, nothing is published.`;
}
