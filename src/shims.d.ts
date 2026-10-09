// Astro's virtual env module, as the runtime code uses it (the real types
// come from astro/client in a site; this keeps the package's own build honest).
declare module "astro:env/server" {
  export function getSecret(key: string): string | undefined;
}

declare module "astro:middleware" {
  import type { MiddlewareHandler } from "astro";
  export function defineMiddleware(handler: MiddlewareHandler): MiddlewareHandler;
}

declare namespace App {
  interface Locals {
    /** A client for this request (pages rendered on demand); its answers' cache tags go out as Cache-Tag. */
    cms: import("./client.js").CmsClient;
    /** The cache tags this response will carry. */
    cmsTags: Set<string>;
  }
}
