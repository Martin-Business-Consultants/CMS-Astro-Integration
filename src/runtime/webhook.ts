/**
 * POST /_cms/webhook — the CMS telling an on-demand site what a publish
 * changed (`event: "cms.purge"`, `tags`, `changes`, or `all: true`), signed
 * with CMS_WEBHOOK_SECRET (X-CMS-Signature: sha256=<hex HMAC of the body>).
 * With CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN set, it purges those
 * cache tags (or everything) from Cloudflare's cache; either way it answers
 * what it did, and the CMS logs it.
 */
import type { APIRoute } from "astro";
import { getSecret } from "astro:env/server";
import { verify } from "./signature.js";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const secret = getSecret("CMS_WEBHOOK_SECRET");
  if (!secret) return json({ error: "CMS_WEBHOOK_SECRET isn't set" }, 500);

  const body = await request.text();
  if (!(await verify(body, request.headers.get("X-CMS-Signature"), secret))) {
    return json({ error: "bad signature" }, 401);
  }

  const payload = JSON.parse(body) as { event?: string; all?: boolean; tags?: string[] };
  if (payload.event !== "cms.purge") return json({ ignored: payload.event ?? null });

  const zone = getSecret("CLOUDFLARE_ZONE_ID");
  const token = getSecret("CLOUDFLARE_API_TOKEN");
  if (!zone || !token) return json({ purged: false, reason: "CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN aren't set" });

  const tags = payload.tags ?? [];
  // Cloudflare takes at most 100 tags a request.
  const batches = payload.all ? [{ purge_everything: true }] : chunk(tags, 100).map((part) => ({ tags: part }));
  for (const batch of batches) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!response.ok) return json({ purged: false, status: response.status, cloudflare: await response.text() }, 502);
  }
  return json({ purged: true, all: Boolean(payload.all), tags: payload.all ? [] : tags });
};

function chunk<T>(list: T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts.length ? parts : [[]];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
