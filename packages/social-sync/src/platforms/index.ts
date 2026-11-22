import { bluesky, blueskyConnector } from "./bluesky.js";
import { facebook } from "./facebook.js";
import { instagram } from "./instagram.js";
import { linkedin, linkedinConnector } from "./linkedin.js";
import { metaConnector } from "./meta.js";
import { threads, threadsConnector } from "./threads.js";
import { tiktokConnector, tiktokPlatform } from "./tiktok.js";
import type { Connector, Platform, PlatformConnectorId, PlatformId } from "./types.js";
import { x, xConnector } from "./x.js";
import { googleConnector, youtube } from "./youtube.js";

export const PLATFORMS: Record<PlatformId, Platform> = {
  instagram,
  facebook,
  tiktok: tiktokPlatform,
  youtube,
  linkedin,
  threads,
  x,
  bluesky,
};

/** The real platforms' connectors (the demo connector lives in demo.ts and is only offered in demo mode). */
export const CONNECTORS: Record<PlatformConnectorId, Connector> = {
  meta: metaConnector,
  tiktok: tiktokConnector,
  google: googleConnector,
  linkedin: linkedinConnector,
  threads: threadsConnector,
  x: xConnector,
  bluesky: blueskyConnector,
};

export function getPlatform(id: string): Platform | undefined {
  return Object.hasOwn(PLATFORMS, id) ? PLATFORMS[id as PlatformId] : undefined;
}

export function getConnector(id: string): Connector | undefined {
  return Object.hasOwn(CONNECTORS, id) ? CONNECTORS[id as PlatformConnectorId] : undefined;
}
