/**
 * @librepublish/astro — an Astro site on LibrePublish CMS, on Cloudflare.
 *
 *   // astro.config.mjs
 *   import { defineConfig } from "astro/config";
 *   import cloudflare from "@astrojs/cloudflare";
 *   import cms from "@librepublish/astro";
 *
 *   export default defineConfig({ adapter: cloudflare(), integrations: [cms()] });
 *
 * With CMS_BASE_URL and CMS_API_TOKEN set (environment or .env), it:
 *
 *   - configures the site from the CMS: its URL (`site`), its locales (Astro
 *     i18n, every locale but the default a path prefix), the CMS's images as
 *     remote images, and the env schema for the connection;
 *   - generates TypeScript from the CMS's schema ("librepublish:types");
 *   - adds /sitemap.xml and /robots.txt, and, when pages render on demand,
 *     /_cms/webhook (signed cache purges) and a middleware that tags each
 *     response with the content it used (Cache-Tag);
 *   - writes the CMS's frontend guide and Site health's checklist into AGENTS.md;
 *
 * and after `astro build`:
 *
 *   - writes the CMS's redirects as Cloudflare's _redirects;
 *   - checks the site against Site health and its own basics;
 *   - tells the CMS the build ran, how the site renders (static, server or
 *     hybrid) and the content it was built from — so publishing rebuilds a
 *     static site and purges one that renders on demand.
 *
 * With the CMS's default plugins it also carries Forms (<Form>, getForm,
 * form emails in the site's design — @librepublish/astro/forms) and Media
 * (assets in `included.assets` and the cmsAssets() collection, <Image>);
 * with Commerce, <QuoteRequest> (@librepublish/astro/commerce).
 *
 * Content comes through the loaders (@librepublish/astro/loaders, and
 * /live for live collections) and the client (@librepublish/astro/client).
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { envField } from "astro/config";
import { writeAgentsMd } from "./agents-md.js";
import { healthFindings, siteFindings, type Finding } from "./build-checks.js";
import { createClient, type CmsClient } from "./client.js";
import { sendTemplates } from "./form-emails.js";
import { servedSitemap } from "./sitemap-filter.js";
import { cloudflareRedirects, LIMITS, shadowedPages } from "./redirects.js";
import { shapeSitemap, type TrailingSlash } from "./site-paths.js";
import { generateTypes } from "./codegen.js";
import { keepConnection, resolveConnection, type Connection } from "./connection.js";
import { lastCursor } from "./loaders.js";
import type { CmsSite, CmsSiteMeta } from "./types.js";

export const NAME = "librepublish";
/** This package's version, as package.json has it (reported with each build). */
export const VERSION: string = createRequire(import.meta.url)("../package.json").version;

export interface CmsOptions {
  /** The CMS's address. Default: CMS_BASE_URL. */
  url?: string;
  /** The site's service token. Default: CMS_API_TOKEN. Keep it out of source. */
  token?: string;
  /** Configure Astro's i18n from the CMS's locales. Default: true. */
  i18n?: boolean;
  /** Add /sitemap.xml and /robots.txt. Default: true. */
  sitemap?: boolean;
  /** Write the CMS's redirects to _redirects after a build. Default: true. */
  redirects?: boolean;
  /** What failing Site health checks do to a build. Default: "warn". */
  siteHealth?: "warn" | "error" | "off";
  /** Keep the CMS's guide and checklist in AGENTS.md. Default: true. */
  agentsMd?: boolean;
  /** Report each build to the CMS. Default: true. */
  report?: boolean;
  /**
   * Form emails in the site's design (the Forms plugin): after a build, send
   * the templates built under <route>/<form>/<kind> to the CMS and take them
   * out of the deployed site (unless `keep`). On when the CMS has Forms on.
   * Default: { route: "emails", keep: false }; false turns it off.
   */
  formEmails?: false | { route?: string; keep?: boolean };
}

export default function cms(options: CmsOptions = {}): AstroIntegration {
  const { i18n = true, sitemap = true, redirects = true, siteHealth = "warn", agentsMd = true, report = true } = options;
  const formEmails = options.formEmails === false ? null : { route: "emails", keep: false, ...options.formEmails };
  let connection: Connection | null = null;
  let client: CmsClient | null = null;
  let site: CmsSite | null = null;
  let siteMeta: CmsSiteMeta | null = null;
  let siteUrl: string | undefined;
  let clientDir: URL | undefined;
  let trailingSlash: TrailingSlash | undefined;
  let onDemand = false;
  let render: "static" | "server" | "hybrid" = "static";
  let onDemandPatterns: RegExp[] = [];
  let startedAt = 0;

  return {
    name: NAME,
    hooks: {
      "astro:config:setup": async ({ config, command, updateConfig, injectRoute, addMiddleware, logger }) => {
        startedAt = Date.now();
        const root = fileURLToPath(config.root);
        connection = resolveConnection(root, command === "build" ? "production" : "development", options);

        updateConfig({
          env: {
            schema: {
              CMS_BASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
              CMS_API_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
              CMS_WEBHOOK_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
              CLOUDFLARE_ZONE_ID: envField.string({ context: "server", access: "secret", optional: true }),
              CLOUDFLARE_API_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
            },
          },
        });

        if (!connection) {
          const message = "CMS_BASE_URL and CMS_API_TOKEN aren't set (environment or .env), so the site can't read the CMS.";
          if (command === "build") throw new Error(message);
          // A preview serves what a build made; the server reads its own variables.
          if (command !== "preview") logger.warn(message);
          return;
        }
        keepConnection(connection);
        client = createClient(connection);

        try {
          ({ data: site, meta: siteMeta } = await client.site());
        } catch (error) {
          if (command === "build") throw error;
          logger.warn(`Couldn't reach the CMS at ${connection.url}: ${(error as Error).message}`);
        }

        // Asset URLs start with the CMS's own address (its APP_HOST), which can
        // differ from the one the build reaches the API at.
        const imageHosts = [new URL(connection.url)];
        if (siteMeta?.cms_url && new URL(siteMeta.cms_url).host !== imageHosts[0].host) imageHosts.push(new URL(siteMeta.cms_url));
        siteUrl = config.site ?? (site?.url || undefined);
        const locales = site?.locales ?? [];
        updateConfig({
          site: siteUrl,
          image: { remotePatterns: imageHosts.map((host) => ({ protocol: host.protocol.replace(":", ""), hostname: host.hostname })) },
          ...(i18n && !config.i18n && site && locales.length > 1
            ? { i18n: { locales, defaultLocale: site.default_locale, routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false, fallbackType: "redirect" as const } } }
            : {}),
        });

        if (sitemap) {
          injectRoute({ pattern: "/sitemap.xml", entrypoint: "@librepublish/astro/runtime/sitemap", prerender: true });
          if (!(await exists(new URL("robots.txt", config.publicDir)))) {
            injectRoute({ pattern: "/robots.txt", entrypoint: "@librepublish/astro/runtime/robots", prerender: true });
          }
        }

        // Pages can render on demand only with an adapter (Cloudflare's).
        onDemand = Boolean(config.adapter);
        if (onDemand) {
          injectRoute({ pattern: "/_cms/webhook", entrypoint: "@librepublish/astro/runtime/webhook", prerender: false });
          addMiddleware({ entrypoint: "@librepublish/astro/runtime/middleware", order: "pre" });
        }

        if (agentsMd && client && command !== "preview") {
          try {
            const [guide, health] = await Promise.all([
              fetch(`${connection.url}/frontend/AGENTS.md`).then((response) => (response.ok ? response.text() : "")),
              client.siteHealth(),
            ]);
            await writeAgentsMd(root, guide, health.data);
          } catch (error) {
            logger.warn(`Couldn't update AGENTS.md: ${(error as Error).message}`);
          }
        }
      },

      "astro:config:done": async ({ config, injectTypes, logger }) => {
        clientDir = config.build.client;
        trailingSlash = config.trailingSlash;
        if (!client) return;
        try {
          const { data: schema } = await client.schema();
          injectTypes({ filename: "cms.d.ts", content: generateTypes(schema) });
        } catch (error) {
          logger.warn(`Couldn't generate types from the CMS's schema: ${(error as Error).message}`);
        }
      },

      "astro:routes:resolved": ({ routes }) => {
        const own = (route: { entrypoint: string }) => route.entrypoint.includes("@librepublish/astro");
        const pages = routes.filter((route) => !own(route) && route.origin !== "internal");
        const prerendered = pages.filter((route) => route.isPrerendered).length;
        render = prerendered === pages.length ? "static" : prerendered === 0 ? "server" : "hybrid";
        onDemandPatterns = pages.filter((route) => !route.isPrerendered && route.type === "page").map((route) => route.patternRegex);
      },

      "astro:build:done": async ({ dir, pages, logger }) => {
        if (!client || !connection) return;
        // With an adapter the static files (and _redirects) go to the client directory.
        const assetsDir = onDemand && clientDir ? clientDir : dir;

        if (redirects) {
          const rules = cloudflareRedirects(await client.redirectsFile(), trailingSlash);
          const file = new URL("_redirects", assetsDir);
          const own = await readFile(file, "utf8").catch(() => "");
          const marker = "# From the CMS (Tools › Redirects)";
          const kept = own.split(marker)[0].trimEnd();
          await writeFile(file, `${kept}${kept ? "\n\n" : ""}${marker}\n${rules.text}`);
          logger.info(`_redirects: ${rules.static + rules.dynamic} rules from the CMS (each path with and without its trailing slash)`);
          const shadowed = shadowedPages(rules.text, pages.map((page) => page.pathname));
          if (shadowed.length) {
            const examples = shadowed.slice(0, 3).join(", ");
            logger.warn(`_redirects: ${shadowed.length} CMS redirect${shadowed.length === 1 ? "" : "s"} send visitors away from a page this site built (${examples}${shadowed.length > 3 ? ", …" : ""}), so the page is never seen. Remove the rule in the CMS (Tools › Redirects) if the page is meant to be there.`);
          }
          if (rules.static > LIMITS.static || rules.dynamic > LIMITS.dynamic) {
            logger.warn(`_redirects: Cloudflare takes ${LIMITS.static} static and ${LIMITS.dynamic} dynamic rules; this has ${rules.static} and ${rules.dynamic}, so the rest are ignored.`);
          }
        }

        if (sitemap) {
          const file = new URL("sitemap.xml", assetsDir);
          const xml = await readFile(file, "utf8").catch(() => null);
          if (xml) {
            const served = servedSitemap(xml, pages.map((page) => page.pathname), onDemandPatterns);
            // Absolute on the site, in the form it serves (trailingSlash).
            const shaped = shapeSitemap(served.xml, siteUrl, trailingSlash);
            if (shaped !== xml) await writeFile(file, shaped);
            if (served.removed.length) {
              const examples = served.removed.slice(0, 3).join(", ");
              logger.warn(`sitemap.xml: left out ${served.removed.length} URL${served.removed.length === 1 ? "" : "s"} the CMS lists but this site has no page for (${examples}${served.removed.length > 3 ? ", …" : ""}). Give them a route, or mark them noindex in the CMS.`);
            }
          }
        }

        if (formEmails) {
          const forms = site?.plugins.includes("forms") ?? false;
          if (forms) {
            const sent = await sendTemplates(client, assetsDir, formEmails, logger);
            if (sent === 0) logger.info(`No form email templates under ${formEmails.route}/ (add src/pages/${formEmails.route}/[form]/[kind].astro to design them).`);
          }
        }

        if (siteHealth !== "off") {
          const findings: Finding[] = [...(await siteFindings(assetsDir))];
          try {
            findings.push(...healthFindings((await client.siteHealth()).data));
          } catch (error) {
            logger.warn(`Couldn't read Site health: ${(error as Error).message}`);
          }
          for (const finding of findings) logger.warn(`Site health: ${finding.title} — ${finding.detail}`);
          if (findings.length && siteHealth === "error") {
            throw new Error(`${findings.length} Site health check${findings.length === 1 ? "" : "s"} failed (siteHealth: "error").`);
          }
          if (!findings.length) logger.info("Site health: everything checks out");
        }

        if (report) {
          const body = {
            integration: NAME,
            integration_version: VERSION,
            framework: "astro",
            framework_version: await astroVersion(),
            pages: pages.length,
            site_url: siteUrl,
            duration_ms: Date.now() - startedAt,
            render,
            webhook_url: onDemand && siteUrl ? new URL("/_cms/webhook", siteUrl).href : undefined,
            content_cursor: lastCursor,
          };
          const response = await fetch(`${connection.url}/api/frontend/builds`, {
            method: "POST",
            headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).catch((error: Error) => ({ ok: false, status: 0, statusText: error.message }) as Response);
          if (response.ok) logger.info(`Reported the build to the CMS (${render}).`);
          else logger.warn(`Couldn't report the build to the CMS: ${response.status} ${response.statusText}`);
        }
      },
    },
  };
}

export { cms };
export type { CmsClient } from "./client.js";

async function exists(url: URL) {
  return access(url).then(() => true, () => false);
}

async function astroVersion(): Promise<string | undefined> {
  try {
    return (createRequire(import.meta.url)("astro/package.json") as { version: string }).version;
  } catch {
    return undefined;
  }
}
