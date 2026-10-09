/**
 * Selling by quotation (the CMS's Commerce plugin): a product page asks for a
 * quote, and the request lands in Commerce › Quote requests, where the shop
 * drafts an invoice from it.
 *
 *   ---
 *   import QuoteRequest from "@librepublish/astro/components/QuoteRequest.astro";
 *   ---
 *   <QuoteRequest items={[{ title: product.title, slug: product.slug, quantity: 1 }]} />
 *
 * The browser posts straight to the CMS (Settings › General's site URL and
 * public origins allow it), JSON or a plain form; never through the site.
 */
import { runtimeClient } from "../runtime/env.js";

/** One line of a quote request, as the visitor saw the product. */
export interface QuoteItem {
  title: string;
  slug?: string;
  sku?: string;
  url?: string;
  /** As the site shows it, e.g. "$2,200.00": the shop's invoice parses it. */
  unit_price?: string | number;
  quantity?: number;
}

/** The field to leave empty; bots fill it in. */
export const HONEYPOT = "website";

/** Where a quote request posts, on the CMS; null when Commerce is off. */
export async function quoteRequestAction(): Promise<string | null> {
  const { data } = await runtimeClient().site();
  return (data.plugin_config?.commerce?.quote_request_action as string | undefined) ?? null;
}

/** Whether the CMS has Commerce on, so a page can offer "Request a quote". */
export async function commerceEnabled(): Promise<boolean> {
  return (await quoteRequestAction()) !== null;
}
