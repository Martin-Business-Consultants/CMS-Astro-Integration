/**
 * Writes the CMS's frontend guide (the CMS serves it at /frontend/AGENTS.md)
 * into the site's AGENTS.md, between markers — the rest of the file is the
 * site's own — followed by Site health's checks as the checklist the site is
 * held to. So whoever works on the site, a person or an AI, builds it the way
 * the CMS expects. A CLAUDE.md pointing at it is added when there isn't one.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { healthChecklist } from "./build-checks.js";
import type { CmsHealthCheck } from "./types.js";

const START = "<!-- librepublish:cms -->";
const END = "<!-- /librepublish:cms -->";

export async function writeAgentsMd(root: string, guide: string, checks: CmsHealthCheck[]) {
  const section = [
    START,
    guide.trim(),
    "",
    "## Site health: what this site is held to",
    "",
    "The CMS checks these against the site as it is (Docs › Site health). Build so every one passes;",
    "`astro build` warns about any that fail.",
    "",
    healthChecklist(checks),
    END,
  ].join("\n");

  const path = join(root, "AGENTS.md");
  const current = await readFile(path, "utf8").catch(() => "");
  const next = current.includes(START) && current.includes(END)
    ? current.replace(new RegExp(`${START}[\\s\\S]*?${END}`), section)
    : `${current.trimEnd()}${current ? "\n\n" : ""}${section}\n`;
  if (next !== current) await writeFile(path, next);

  const claude = join(root, "CLAUDE.md");
  if (!(await readFile(claude, "utf8").catch(() => null))) await writeFile(claude, "Read AGENTS.md before changing this site.\n");
}
