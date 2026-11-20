import { z } from "zod";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { actorId, authorize } from "./common";

const httpsUrl = z
  .string()
  .trim()
  .max(1000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL");
const optUrl = httpsUrl.or(z.literal("").transform(() => null)).nullable().optional();
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const words = (max: number) =>
  z
    .array(z.string().trim().min(1).max(120))
    .max(max)
    .default([])
    .transform((a) => [...new Set(a)]);

export const brandKitInput = z.object({
  brandName: z.string().trim().min(1).max(120),
  tagline: optText(200),
  voiceTone: optText(3000),
  messagingPillars: words(12),
  doWords: words(60),
  dontWords: words(60),
  personas: z.array(z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(1000).default("") })).max(10).default([]),
  colors: z.array(z.object({ name: z.string().trim().min(1).max(40), hex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/) })).max(12).default([]),
  logoUrl: optUrl,
  logoDarkUrl: optUrl,
  iconUrl: optUrl,
  headingFont: optText(80),
  bodyFont: optText(80),
});
export type BrandKitInput = z.input<typeof brandKitInput>;

export interface BrandKit {
  id: string;
  brandName: string;
  tagline: string | null;
  voiceTone: string | null;
  messagingPillars: string[];
  doWords: string[];
  dontWords: string[];
  personas: { name: string; description: string }[];
  colors: { name: string; hex: string }[];
  logoUrl: string | null;
  logoDarkUrl: string | null;
  iconUrl: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  updatedAt: Date;
}

function shape(row: NonNullable<Awaited<ReturnType<Db["marketingBrandKit"]["findFirst"]>>>): BrandKit {
  const personas = z.array(z.object({ name: z.string(), description: z.string() })).safeParse(row.personas);
  const colors = z.array(z.object({ name: z.string(), hex: z.string() })).safeParse(row.colors);
  return {
    id: row.id,
    brandName: row.brandName,
    tagline: row.tagline,
    voiceTone: row.voiceTone,
    messagingPillars: row.messagingPillars,
    doWords: row.doWords,
    dontWords: row.dontWords,
    personas: personas.success ? personas.data : [],
    colors: colors.success ? colors.data : [],
    logoUrl: row.logoUrl,
    logoDarkUrl: row.logoDarkUrl,
    iconUrl: row.iconUrl,
    headingFont: row.headingFont,
    bodyFont: row.bodyFont,
    updatedAt: row.updatedAt,
  };
}

/** Internal read (no RBAC): used by AI task builders and the mailer, which have already authorized. */
export async function loadBrandKit(client: Tx | Db, companyId: string): Promise<BrandKit | null> {
  const row = await client.marketingBrandKit.findFirst({ where: { companyId } });
  return row ? shape(row) : null;
}

export async function getBrandKit(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  const row = await db().marketingBrandKit.findFirst({ where: { organizationId, companyId } });
  return row ? shape(row) : null;
}

export async function saveBrandKit(ctx: RequestContext, organizationId: string, companyId: string, raw: BrandKitInput) {
  const input = brandKitInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const data = {
      brandName: input.brandName,
      tagline: input.tagline || null,
      voiceTone: input.voiceTone || null,
      messagingPillars: input.messagingPillars,
      doWords: input.doWords,
      dontWords: input.dontWords,
      personas: input.personas,
      colors: input.colors,
      logoUrl: input.logoUrl || null,
      logoDarkUrl: input.logoDarkUrl || null,
      iconUrl: input.iconUrl || null,
      headingFont: input.headingFont || null,
      bodyFont: input.bodyFont || null,
      updatedById: actorId(ctx, organizationId),
    };
    const before = await tx.marketingBrandKit.findFirst({ where: { organizationId, companyId }, select: { id: true, brandName: true } });
    const row = before
      ? await tx.marketingBrandKit.update({ where: { id: before.id }, data })
      : await tx.marketingBrandKit.create({ data: { organizationId, companyId, ...data } });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: before ? "marketing.brand.updated" : "marketing.brand.created",
      resourceType: "marketing_brand_kit",
      resourceId: row.id,
      oldValue: before ? { brandName: before.brandName } : undefined,
      newValue: { brandName: row.brandName, pillars: row.messagingPillars.length, personas: input.personas.length },
    });
    return shape(row);
  });
}

export async function deleteBrandKit(ctx: RequestContext, organizationId: string, companyId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const row = await tx.marketingBrandKit.findFirst({ where: { organizationId, companyId }, select: { id: true, brandName: true } });
    if (!row) throw notFound("Brand kit");
    await tx.marketingBrandKit.delete({ where: { id: row.id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.brand.deleted", resourceType: "marketing_brand_kit", resourceId: row.id, oldValue: { brandName: row.brandName } });
    return { ok: true };
  });
}

/** The brand kit as instructions for AI writers. Empty string when the company has no brand kit. */
export function brandContext(kit: BrandKit | null): string {
  if (!kit) return "";
  const lines = [`Brand guidelines — follow them in everything you write:`, `- Brand name: ${kit.brandName}${kit.tagline ? ` (tagline: "${kit.tagline}")` : ""}`];
  if (kit.voiceTone) lines.push(`- Voice & tone: ${kit.voiceTone}`);
  if (kit.messagingPillars.length) lines.push(`- Messaging pillars: ${kit.messagingPillars.join("; ")}`);
  if (kit.doWords.length) lines.push(`- Preferred words and phrases: ${kit.doWords.join(", ")}`);
  if (kit.dontWords.length) lines.push(`- Never use these words or phrases: ${kit.dontWords.join(", ")}`);
  for (const p of kit.personas) lines.push(`- Audience persona "${p.name}"${p.description ? `: ${p.description}` : ""}`);
  return lines.join("\n");
}

/** Brand context for a company (internal; callers authorize). */
export async function brandContextFor(companyId: string) {
  return brandContext(await loadBrandKit(db(), companyId));
}
