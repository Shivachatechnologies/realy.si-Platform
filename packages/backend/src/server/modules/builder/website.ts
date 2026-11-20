import type { RequestContext } from "@/server/core/context";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { ingestDocument } from "@/server/modules/brain/service";
import { AuditFetchError, fetchPage } from "@/server/modules/marketing/seo-audit";

/**
 * Existing-business website import: the homepage plus up to 10 same-domain pages it links to are fetched with the
 * marketing module's SSRF-hardened fetcher (public addresses only, redirects re-checked, size and time capped) and
 * their text is added to Company Brain. Every page is recorded as a BuilderSource (ingested or failed with the reason).
 */

const MAX_LINKED_PAGES = 10;
const MIN_TEXT = 120;
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|mp4|mp3|mov|avi|css|js|json|xml|rss|woff2?|ttf|exe|dmg)$/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®" };

function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Readable text of an HTML page (scripts, styles and markup removed; block elements become line breaks). */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|li|ul|ol|h[1-6]|br|tr|table|blockquote|figure|figcaption|dd|dt)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body)
    .replace(/[�\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title: title ? decode(title).replace(/\s+/g, " ").trim().slice(0, 180) || null : null, text };
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** Same-site links of a page (http/https, no files or fragments), de-duplicated, in page order. */
export function sameSiteLinks(html: string, pageUrl: string, limit = MAX_LINKED_PAGES): string[] {
  const base = new URL(pageUrl);
  const out: string[] = [];
  const seen = new Set([base.origin + base.pathname.replace(/\/$/, "")]);
  for (const [, href] of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)[^"']*["']/gi)) {
    if (!href || /^(mailto|tel|javascript|data):/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(decode(href), base);
    } catch {
      continue;
    }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || bareHost(u.hostname) !== bareHost(base.hostname) || SKIP_EXT.test(u.pathname)) continue;
    const key = u.origin + u.pathname.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u.origin + u.pathname + u.search);
    if (out.length >= limit) break;
  }
  return out;
}

function reasonOf(err: unknown): string {
  if (err instanceof AuditFetchError) return err.reason;
  if (isAppError(err)) return (typeof err.details?.reason === "string" ? err.details.reason : null) ?? err.message;
  return "fetch_failed";
}

async function ingestPage(ctx: RequestContext, run: { id: string; organizationId: string; companyId: string }, url: string, html: string) {
  const { title, text } = htmlToText(html);
  const label = title ?? new URL(url).pathname;
  const source = { organizationId: run.organizationId, companyId: run.companyId, runId: run.id, kind: "website_page", url, title: label.slice(0, 200) };
  if (text.length < MIN_TEXT) {
    await db().builderSource.create({ data: { ...source, status: "FAILED", errorMessage: "too_little_text" } });
    return;
  }
  try {
    const doc = await ingestDocument(ctx, run.organizationId, run.companyId, {
      title: `${label} (${new URL(url).hostname})`.slice(0, 200),
      filename: "website-page.txt",
      content: `Source: ${url}\n\n${text}`.slice(0, 900_000),
      tags: ["builder", "website"],
    });
    await db().builderSource.create({ data: { ...source, status: "INGESTED", brainDocumentId: doc.id } });
  } catch (err) {
    const existing = isAppError(err) && typeof err.details?.documentId === "string" ? err.details.documentId : null;
    await db().builderSource.create({
      data: existing ? { ...source, status: "INGESTED", brainDocumentId: existing } : { ...source, status: "FAILED", errorMessage: reasonOf(err).slice(0, 300) },
    });
  }
}

/** Fetch the website into Brain. Returns how many pages were ingested; throws only when the homepage itself fails. */
export async function importWebsite(ctx: RequestContext, run: { id: string; organizationId: string; companyId: string }, websiteUrl: string): Promise<number> {
  let home;
  try {
    home = await fetchPage(websiteUrl);
  } catch (err) {
    const reason = reasonOf(err);
    await db().builderSource.create({ data: { organizationId: run.organizationId, companyId: run.companyId, runId: run.id, kind: "website_page", url: websiteUrl, title: websiteUrl.slice(0, 200), status: "FAILED", errorMessage: reason } });
    throw new WebsiteError(reason);
  }
  if (home.status >= 400) {
    await db().builderSource.create({ data: { organizationId: run.organizationId, companyId: run.companyId, runId: run.id, kind: "website_page", url: websiteUrl, title: websiteUrl.slice(0, 200), status: "FAILED", errorMessage: `http_${home.status}` } });
    throw new WebsiteError(`http_${home.status}`);
  }
  await ingestPage(ctx, run, home.finalUrl, home.html);
  for (const link of sameSiteLinks(home.html, home.finalUrl)) {
    try {
      const page = await fetchPage(link);
      if (page.status >= 400) {
        await db().builderSource.create({ data: { organizationId: run.organizationId, companyId: run.companyId, runId: run.id, kind: "website_page", url: link, title: link.slice(0, 200), status: "FAILED", errorMessage: `http_${page.status}` } });
        continue;
      }
      await ingestPage(ctx, run, page.finalUrl, page.html);
    } catch (err) {
      logger.info({ runId: run.id, reason: reasonOf(err) }, "builder website page skipped");
      await db().builderSource.create({ data: { organizationId: run.organizationId, companyId: run.companyId, runId: run.id, kind: "website_page", url: link, title: link.slice(0, 200), status: "FAILED", errorMessage: reasonOf(err).slice(0, 300) } });
    }
  }
  return db().builderSource.count({ where: { runId: run.id, kind: "website_page", status: "INGESTED" } });
}

export class WebsiteError extends Error {
  constructor(readonly reason: string) {
    super(`The website could not be fetched (${reason})`);
  }
}
