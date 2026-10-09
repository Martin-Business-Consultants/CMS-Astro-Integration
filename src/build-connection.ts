/**
 * The connection the integration resolved for this build, kept on globalThis
 * for the code that runs in the same process: the content loaders, the
 * prerendering pages, and the form email helpers. Free of Vite and Node
 * imports, so it can sit in code that's bundled for a Worker too.
 */
import { createClient, type CmsClient } from "./client.js";

export interface Connection { url: string; token: string }

const KEY = Symbol.for("librepublish.astro.connection");
type Holder = { [KEY]?: Connection };

export function keepConnection(connection: Connection) {
  (globalThis as Holder)[KEY] = connection;
}

/** The build's connection, or null outside a build that has one. */
export function heldConnection(): Connection | null {
  return (globalThis as Holder)[KEY] ?? null;
}

/** The build's connection; throws outside a build that has one. */
export function buildConnection(): Connection {
  const connection = heldConnection();
  if (!connection) {
    throw new Error("@librepublish/astro: no CMS connection. Add cms() to astro.config's integrations and set CMS_BASE_URL and CMS_API_TOKEN.");
  }
  return connection;
}

export function buildClient(): CmsClient {
  return createClient(buildConnection());
}
