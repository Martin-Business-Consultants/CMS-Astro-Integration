/**
 * What a build holds the site to: Site health's checks from the CMS (the
 * business's details, the pages a site needs, alt text…), and the built
 * site's own (a sitemap, robots.txt, a 404 page). Failing ones are warned
 * about — or stop the build with `siteHealth: "error"`.
 */
import { access } from "node:fs/promises";
import type { CmsHealthCheck } from "./types.js";

export interface Finding { title: string; detail: string }

export async function siteFindings(dir: URL): Promise<Finding[]> {
  const exists = async (file: string) => access(new URL(file, dir)).then(() => true, () => false);
  const findings: Finding[] = [];
  if (!(await exists("sitemap.xml"))) findings.push({ title: "No sitemap.xml", detail: "Search engines read it to find every page. cms() adds one unless sitemap: false." });
  if (!(await exists("robots.txt"))) findings.push({ title: "No robots.txt", detail: "It tells crawlers where the sitemap is." });
  if (!(await exists("404.html"))) findings.push({ title: "No 404 page", detail: "Add src/pages/404.astro so a missing page looks like the site." });
  return findings;
}

export function healthFindings(checks: CmsHealthCheck[]): Finding[] {
  return checks.filter((check) => check.for_site !== false && check.ok === false).map((check) => ({ title: check.title, detail: check.detail }));
}

/** The checks as a Markdown checklist, for AGENTS.md. */
export function healthChecklist(checks: CmsHealthCheck[]): string {
  const groups = new Map<string, CmsHealthCheck[]>();
  for (const check of checks.filter((check) => check.for_site !== false)) groups.set(check.group, [...(groups.get(check.group) ?? []), check]);
  return [...groups].map(([group, list]) => [
    `### ${group}`,
    ...list.map((check) => `- [${check.ok ? "x" : " "}] **${check.title}** — ${check.detail}${check.ok === null ? " _(yours to judge)_" : ""}`),
  ].join("\n")).join("\n\n");
}
