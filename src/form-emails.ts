/**
 * After `astro build`: the form email templates the site built (its route at
 * src/pages/<route>/[form]/[kind].astro) go to the CMS, which sends each one
 * while the digest stamped in it still matches the email's blocks — until a
 * newer build lands, an email goes out in the CMS's own layout, so it never
 * waits. The built templates are then taken out of the deployed site.
 *
 * A failed send fails the build, so a site never deploys believing its
 * emails are current. The token needs forms:templates (the Production site
 * role has it).
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CmsClient } from "./client.js";
import { DIGEST_META, type CmsFormEmail } from "./forms/types.js";

const KINDS: CmsFormEmail["kind"][] = ["notification", "confirmation"];

export interface Template { form: string; kind: CmsFormEmail["kind"]; file: string }

/** <route>/<form>/<kind>/index.html (build.format "directory") or <route>/<form>/<kind>.html ("file"). */
export async function findTemplates(root: string): Promise<Template[]> {
  const forms = await readdir(root).catch(() => [] as string[]);
  const found: Template[] = [];
  for (const form of forms) {
    const entries = await readdir(join(root, form)).catch(() => [] as string[]);
    for (const kind of KINDS) {
      if (entries.includes(kind)) found.push({ form, kind, file: join(root, form, kind, "index.html") });
      else if (entries.includes(`${kind}.html`)) found.push({ form, kind, file: join(root, form, `${kind}.html`) });
    }
  }
  return found;
}

export function readDigest(html: string): string | null {
  const tag = html.match(new RegExp(`<meta[^>]+name=["']${DIGEST_META}["'][^>]*>`, "i"))?.[0];
  return tag?.match(/content=["']([^"']+)["']/i)?.[1] ?? null;
}

export async function sendTemplates(
  client: CmsClient,
  dir: URL,
  { route, keep }: { route: string; keep: boolean },
  logger: { info(message: string): void },
): Promise<number> {
  const root = join(fileURLToPath(dir), route);
  const templates = await findTemplates(root);
  for (const { form, kind, file } of templates) {
    const html = await readFile(file, "utf8");
    const digest = readDigest(html);
    if (!digest) throw new Error(`${file} has no <meta name="${DIGEST_META}">; add digestMeta(email) to its <head>.`);
    const answer = await client.admin<{ status?: string; site_template?: { status?: string } }>(
      `/forms/${encodeURIComponent(form)}/emails/${kind}/template`,
      { method: "PUT", body: JSON.stringify({ html, digest }) },
    );
    logger.info(`${form} ${kind} email → CMS (${answer.status ?? answer.site_template?.status ?? "received"})`);
  }
  if (templates.length && !keep) await rm(root, { recursive: true, force: true });
  return templates.length;
}
