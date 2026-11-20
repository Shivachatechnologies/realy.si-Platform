// CMS adapters (WordPress REST, Webflow CMS v2, Shopify Admin) and Google Search Console. Every request goes through the
// Integrations provider client (call → providerFetch) with the Integrations auth scheme of the connection's provider
// (WordPress application password, Shopify access token, Bearer).
import { SHOPIFY_API_VERSION, shopifyHost } from "@/server/modules/integrations/providers";
import type { ProviderConnection } from "../connections-bridge";
import { call, cfg, num, ProviderError, str } from "./http";

export const CMS_PROVIDERS = ["wordpress", "webflow", "shopify"] as const;
export type CmsProvider = (typeof CMS_PROVIDERS)[number];

type Conn = ProviderConnection & { accessToken: string };

export interface CmsArticle {
  title: string;
  html: string;
  excerpt?: string | null;
  slug?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  categories: string[];
  tags: string[];
  author?: string | null;
  /** Future date → scheduled publish where the CMS supports it. */
  publishAt?: Date | null;
  featuredImage?: { bytes: Buffer; mimeType: string; filename: string; url?: string | null } | null;
}
export interface CmsResult {
  externalId: string;
  url: string | null;
  scheduled: boolean;
}

const httpsBase = (v: string | null, what: string) => {
  if (!v || !/^https:\/\/[^\s/]+/i.test(v)) throw new ProviderError("account_not_configured", `${what} missing`);
  return v.replace(/\/+$/, "");
};

// ── WordPress (REST API, application password) ──

/** WordPress auth (Basic with the application password) is added by the Integrations client from config.username. */
function wpCheck(c: Conn) {
  if (!cfg(c, "username")) throw new ProviderError("account_not_configured", "WordPress username missing");
}

async function wpTermIds(c: Conn, base: string, taxonomy: "categories" | "tags", names: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const name of names.slice(0, 10)) {
    const found = await call(c, `${base}/wp-json/wp/v2/${taxonomy}?${new URLSearchParams({ search: name, per_page: "20" })}`, {});
    const items = (found.json.items as { id: number; name: string }[] | undefined) ?? [];
    const match = items.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (match) ids.push(match.id);
    else {
      const created = await call(c, `${base}/wp-json/wp/v2/${taxonomy}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const id = num(created.json.id);
      if (id) ids.push(id);
    }
  }
  return ids;
}

async function wordpress(c: Conn, a: CmsArticle): Promise<CmsResult> {
  const base = httpsBase(cfg(c, "siteUrl", "url"), "WordPress site URL");
  wpCheck(c);
  let featured: number | null = null;
  if (a.featuredImage) {
    const media = await call(c, 
      `${base}/wp-json/wp/v2/media`,
      { method: "POST", headers: { "content-type": a.featuredImage.mimeType, "content-disposition": `attachment; filename="${a.featuredImage.filename.replace(/[^\w.-]/g, "_")}"` }, body: new Uint8Array(a.featuredImage.bytes) },
      60_000,
    );
    featured = num(media.json.id);
  }
  const scheduled = !!a.publishAt && a.publishAt.getTime() > Date.now() + 60_000;
  const post = await call(c, `${base}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: a.title,
      content: a.html,
      excerpt: a.excerpt ?? a.metaDescription ?? "",
      ...(a.slug ? { slug: a.slug } : {}),
      status: scheduled ? "future" : "publish",
      ...(scheduled ? { date_gmt: a.publishAt!.toISOString().slice(0, 19) } : {}),
      ...(featured ? { featured_media: featured } : {}),
      categories: await wpTermIds(c, base, "categories", a.categories),
      tags: await wpTermIds(c, base, "tags", a.tags),
    }),
  });
  const id = num(post.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  return { externalId: String(id), url: str(post.json.link), scheduled };
}

// ── Webflow (CMS API v2) ──

async function webflow(c: Conn, a: CmsArticle): Promise<CmsResult> {
  const collectionId = cfg(c, "collectionId");
  if (!collectionId) throw new ProviderError("account_not_configured", "Webflow collection id missing");
  const f = (k: string, d: string) => cfg(c, `${k}Field`) ?? d;
  const slug = (a.slug || a.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 100);
  const res = await call(c, `https://api.webflow.com/v2/collections/${encodeURIComponent(collectionId)}/items/live`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      isArchived: false,
      isDraft: false,
      fieldData: {
        name: a.title,
        slug,
        [f("body", "post-body")]: a.html,
        [f("summary", "post-summary")]: a.excerpt ?? a.metaDescription ?? "",
        ...(a.featuredImage?.url ? { [f("image", "main-image")]: { url: a.featuredImage.url } } : {}),
      },
    }),
  });
  const id = str(res.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  const site = cfg(c, "siteUrl");
  const path = cfg(c, "collectionPath") ?? "blog";
  return { externalId: id, url: site ? `${site.replace(/\/+$/, "")}/${path}/${slug}` : null, scheduled: false };
}

// ── Shopify (Admin REST blog articles) ──

async function shopify(c: Conn, a: CmsArticle): Promise<CmsResult> {
  const shop = shopifyHost(c.config);
  const blogId = cfg(c, "blogId");
  if (!shop) throw new ProviderError("account_not_configured", "Shopify shop domain missing");
  if (!blogId || !/^\d+$/.test(blogId)) throw new ProviderError("account_not_configured", "Shopify blog id missing");
  const base = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;
  const headers = { "content-type": "application/json" };
  const scheduled = !!a.publishAt && a.publishAt.getTime() > Date.now() + 60_000;
  const res = await call(c, `${base}/blogs/${blogId}/articles.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      article: {
        title: a.title,
        body_html: a.html,
        author: a.author ?? undefined,
        tags: a.tags.join(", "),
        summary_html: a.excerpt ?? a.metaDescription ?? undefined,
        ...(a.slug ? { handle: a.slug } : {}),
        published: !scheduled,
        ...(scheduled ? { published_at: a.publishAt!.toISOString() } : {}),
        ...(a.featuredImage ? { image: { attachment: a.featuredImage.bytes.toString("base64"), alt: a.title } } : {}),
        metafields: [
          ...(a.metaTitle ? [{ namespace: "global", key: "title_tag", value: a.metaTitle, type: "single_line_text_field" }] : []),
          ...(a.metaDescription ? [{ namespace: "global", key: "description_tag", value: a.metaDescription, type: "single_line_text_field" }] : []),
        ],
      },
    }),
  });
  const article = (res.json.article ?? {}) as { id?: number; handle?: string };
  if (!article.id) throw new ProviderError("provider_no_id");
  let url: string | null = null;
  try {
    const blog = await call(c, `${base}/blogs/${blogId}.json`, { headers });
    const handle = str((blog.json.blog as { handle?: string } | undefined)?.handle);
    const domain = cfg(c, "publicDomain") ?? shop;
    if (handle && article.handle) url = `https://${domain}/blogs/${handle}/${article.handle}`;
  } catch {
    url = null;
  }
  return { externalId: String(article.id), url, scheduled };
}

export async function publishToCms(provider: CmsProvider, c: Conn, a: CmsArticle): Promise<CmsResult> {
  if (provider === "wordpress") return wordpress(c, a);
  if (provider === "webflow") return webflow(c, a);
  return shopify(c, a);
}

/** Publish verification: the public URL answers 2xx. */
export async function verifyUrl(url: string | null): Promise<boolean> {
  if (!url || !/^https:\/\//i.test(url)) return false;
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Google Search Console (searchAnalytics.query) ──

export interface SearchRow {
  date: string;
  page: string;
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function searchConsoleQuery(c: Conn, siteUrl: string, startDate: string, endDate: string): Promise<SearchRow[]> {
  const out: SearchRow[] = [];
  for (let startRow = 0; startRow < 25_000; startRow += 5000) {
    const res = await call(c, `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      retries: 2,
      body: JSON.stringify({ startDate, endDate, dimensions: ["date", "page", "query"], rowLimit: 5000, startRow }),
    });
    const rows = (res.json.rows as { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] | undefined) ?? [];
    for (const r of rows) out.push({ date: r.keys[0]!, page: r.keys[1]!.slice(0, 1000), query: r.keys[2]!.slice(0, 500), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
    if (rows.length < 5000) break;
  }
  return out;
}

// ── Markdown-ish body → HTML (headings, lists, paragraphs, bold/italic, links) ──

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(s: string) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2">$1</a>');
}
export function bodyToHtml(body: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) {
      flush();
      close();
    } else if (h) {
      flush();
      close();
      const level = Math.min(4, h[1]!.length + 1);
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
    } else if (ul || ol) {
      flush();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
    } else {
      close();
      para.push(line);
    }
  }
  flush();
  close();
  return out.join("\n");
}
