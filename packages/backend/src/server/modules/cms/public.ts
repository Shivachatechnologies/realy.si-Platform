import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import { pickVariant, readContent, type CmsBlock, type CmsVariant } from "./schemas";

/**
 * Public read side of the CMS (apps/user /[locale]/pages/[slug]): published snapshots only, never drafts. A scheduled
 * snapshot whose time has come is served (and promoted to published on the way). Results are cached in-process for
 * CACHE_TTL_MS; media references resolve to fresh signed URLs from the integrations storage service.
 */

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: PublicCmsPage | null }>();

export function invalidatePublicCms() {
  cache.clear();
}

export interface PublicCmsPage {
  id: string;
  kind: "PAGE" | "POST" | "LANDING";
  slug: string;
  locale: string;
  publishedAt: string | null;
  variant: CmsVariant;
  /** media:<id> → URL (signed, short-lived). */
  media: Record<string, string>;
}

const mediaIdsOf = (v: CmsVariant) => {
  const refs: string[] = [v.ogImage];
  for (const b of v.blocks as CmsBlock[]) if (b.type === "hero" || b.type === "image") refs.push(b.image);
  return [...new Set(refs.filter((r) => r.startsWith("media:")).map((r) => r.slice(6)))];
};

/** Signed URLs for CMS media rows (storage service; database fallback URLs are served by the user app). */
export async function resolveMediaUrls(ids: string[]): Promise<Record<string, string>> {
  const valid = ids.filter((i) => z.string().uuid().safeParse(i).success);
  if (!valid.length) return {};
  const rows = await db().cmsMedia.findMany({ where: { id: { in: valid } } });
  const { getSignedUrl } = await import("@/server/modules/integrations/services/storage");
  const out: Record<string, string> = {};
  await Promise.all(
    rows.map(async (r) => {
      const res = await getSignedUrl(r.organizationId, r.companyId, r.ref, 3600).catch(() => null);
      if (res && res.ok) out[`media:${r.id}`] = res.data.url;
    }),
  );
  return out;
}

async function load(slug: string, locale: string): Promise<PublicCmsPage | null> {
  const row = await db().cmsEntry.findUnique({ where: { slug } });
  if (!row || row.status === "ARCHIVED") return null;
  let snapshot: unknown = row.published;
  let publishedAt = row.publishedAt;
  if (row.status === "SCHEDULED" && row.pending && row.publishAt && row.publishAt <= new Date()) {
    snapshot = row.pending;
    publishedAt = row.publishAt;
    const version = (row.pending as { version?: unknown }).version;
    // Promote once (the first reader wins; concurrent readers see the same content either way).
    await db()
      .cmsEntry.updateMany({
        where: { id: row.id, status: "SCHEDULED", publishAt: row.publishAt },
        data: { status: "PUBLISHED", published: row.pending as Prisma.InputJsonValue, pending: Prisma.DbNull, publishedAt: row.publishAt, liveVersion: typeof version === "number" ? version : row.liveVersion },
      })
      .catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "cms scheduled promotion failed"));
  }
  if (!snapshot) return null;
  const picked = pickVariant(readContent(snapshot), locale);
  if (!picked) return null;
  return { id: row.id, kind: row.kind, slug: row.slug, locale: picked.locale, publishedAt: publishedAt?.toISOString() ?? null, variant: picked.variant, media: await resolveMediaUrls(mediaIdsOf(picked.variant)) };
}

/** The published page for a slug and locale (falls back to en-US), or null. */
export async function getPublishedPage(slugRaw: string, locale: string): Promise<PublicCmsPage | null> {
  const slug = slugRaw.toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const key = `${slug}|${locale}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await load(slug, locale).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "cms page unavailable");
    return null;
  });
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ───────────── Site banner ─────────────

export const BANNER_KEY = "site:banner";
export const bannerSchema = z.object({
  active: z.boolean().default(false),
  tone: z.enum(["info", "warning", "danger"]).default("info"),
  message: z.string().trim().max(300).default(""),
  href: z.string().trim().max(300).default(""),
  endsAt: z.string().datetime().nullable().default(null),
});
export type SiteBanner = z.infer<typeof bannerSchema>;

let bannerCache: { at: number; value: SiteBanner | null } | null = null;

/** The active platform banner (maintenance notices etc.), or null. Cached for CACHE_TTL_MS. */
export async function activeBanner(): Promise<SiteBanner | null> {
  if (bannerCache && Date.now() - bannerCache.at < CACHE_TTL_MS) return bannerCache.value;
  let value: SiteBanner | null = null;
  try {
    const row = await db().platformSetting.findUnique({ where: { key: BANNER_KEY } });
    const parsed = bannerSchema.safeParse(row?.value);
    if (parsed.success && parsed.data.active && parsed.data.message && (!parsed.data.endsAt || new Date(parsed.data.endsAt) > new Date())) value = parsed.data;
  } catch {
    value = null;
  }
  bannerCache = { at: Date.now(), value };
  return value;
}

export function invalidateBanner() {
  bannerCache = null;
}
