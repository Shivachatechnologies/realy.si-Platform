import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, notFound } from "@/server/core/errors";
import { assertAiAllowed, assertModuleEnabled } from "@/server/core/platform-controls";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { DOMAIN_EVENTS, type DomainEventType } from "@/server/modules/events/catalog";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { loadBrandKit, type BrandKit } from "@/server/modules/marketing/brand";
import { assetPublicUrl, assetSignedUrl } from "@/server/modules/marketing/assets";
import type { ServiceResult } from "@/server/modules/integrations/services/common";
import { CATEGORY_GUIDE, STYLE_GUIDE, type ImageCategory, type ImageStyle } from "./presets";

/**
 * Shared helpers of the creative module. The studio reuses marketing permissions (marketing.read to view,
 * marketing.manage to produce) and the marketing platform switch; visual outputs live in the marketing media library.
 */

export const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;
export type CreativePermission = "marketing.read" | "marketing.manage";

export async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: CreativePermission, tx?: Tx) {
  if (!isUuid(organizationId) || !isUuid(companyId)) throw notFound("Company");
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await requirePermission(ctx, permission, chain, tx);
  if (permission === "marketing.manage") await assertModuleEnabled(organizationId, "marketing");
  return chain;
}

export const actorId = (ctx: RequestContext, organizationId: string) => ctx.actor.id ?? organizationId;

/**
 * Emit a creative domain event when the lead has registered its type in events/catalog.ts (creative.* types are
 * proposed in the module report); until then nothing is emitted (emitting an unknown type would throw).
 */
export async function emitCreativeEvent(tx: Tx, ctx: RequestContext, type: string, args: { organizationId: string; companyId: string; entityType: string; entityId: string; data?: Record<string, string | number | boolean | null | undefined> }) {
  if (!(DOMAIN_EVENTS as readonly string[]).includes(type)) return null;
  return emitDomainEvent(tx, ctx, type as DomainEventType, args);
}

/** Text AI calls (concept, script, storyboard) go through the platform AI policy first. */
export const assertTextAiAllowed = (organizationId: string) => assertAiAllowed(organizationId, { model: "gpt-4.1-mini" });

/** Turn a failed provider service result into a user-facing error (not_connected → honest "credential required"). */
export function serviceFailure(r: Extract<ServiceResult<unknown>, { ok: false }>, what: string, reasonPrefix = "creative"): AppError {
  if (r.code === "not_connected") return new AppError("not_configured", r.error, { reason: `${reasonPrefix}_not_connected`, detail: what });
  if (r.code === "invalid_input") return new AppError("validation_error", r.error, { reason: `${reasonPrefix}_invalid_input` });
  if (r.code === "rate_limited") return new AppError("rate_limited", r.error, { reason: `${reasonPrefix}_rate_limited` });
  return conflict(`${what}: ${r.error}`, { reason: `${reasonPrefix}_provider_failed`, detail: r.error.slice(0, 200) });
}

export const toBig = (micros: number | null | undefined) => (micros === null || micros === undefined ? null : BigInt(Math.max(0, Math.round(micros))));
export const addMicros = (a: bigint | null | undefined, b: number | null | undefined): bigint | null => (a == null && b == null ? null : (a ?? 0n) + (toBig(b) ?? 0n));

// ───────────── Brand-aware prompt builder ─────────────

export interface PromptParts {
  prompt: string;
  category?: ImageCategory | null;
  style?: ImageStyle | null;
  useBrand?: boolean;
  /** Leave room for a headline at this position (text is never rendered by the generator). */
  textSpace?: "top" | "center" | "bottom" | null;
  aspect?: string | null;
}

export function brandLines(kit: BrandKit | null): string[] {
  if (!kit) return [];
  const out: string[] = [];
  if (kit.colors.length) out.push(`Brand palette (use these colors prominently): ${kit.colors.map((c) => `${c.name} ${c.hex}`).join(", ")}.`);
  if (kit.voiceTone) out.push(`Visual mood consistent with the brand voice: ${kit.voiceTone.slice(0, 300)}.`);
  if (kit.headingFont || kit.bodyFont) out.push(`Any typographic areas should suit the brand fonts (${[kit.headingFont, kit.bodyFont].filter(Boolean).join(" / ")}).`);
  if (kit.dontWords.length) out.push(`Avoid: ${kit.dontWords.slice(0, 15).join(", ")}.`);
  out.push(`Brand: ${kit.brandName}. Do not invent logos, trademarks or misspelled text.`);
  return out;
}

export async function buildImagePrompt(client: Db | Tx, companyId: string, p: PromptParts): Promise<{ prompt: string; brandApplied: boolean }> {
  const kit = p.useBrand === false ? null : await loadBrandKit(client, companyId);
  const parts = [p.prompt.trim()];
  if (p.category) parts.push(CATEGORY_GUIDE[p.category]);
  if (p.style) parts.push(STYLE_GUIDE[p.style]);
  parts.push(...brandLines(kit));
  if (p.textSpace) parts.push(`Leave clean negative space at the ${p.textSpace} for a text overlay; do not render any text.`);
  if (p.aspect) parts.push(`Composition designed for a ${p.aspect} frame.`);
  return { prompt: parts.join(" ").slice(0, 3900), brandApplied: !!kit };
}

// ───────────── Media URLs ─────────────

type MarketingAssetRow = { id: string; organizationId: string; companyId: string; url: string | null; mimeType: string | null; sizeBytes: number | null; storageRef: string | null; data?: Uint8Array | null };

/** Stable signed public URL (platforms and render providers fetch from it) + short-lived preview URL of a library asset. */
export async function marketingAssetUrls(a: MarketingAssetRow): Promise<{ publicUrl: string | null; previewUrl: string | null }> {
  const publicUrl = assetPublicUrl({ ...a, hasData: !!a.data });
  return { publicUrl, previewUrl: (await assetSignedUrl(a)) ?? publicUrl };
}

/** Load marketing library rows by id within the company. */
export async function marketingAssetsById(organizationId: string, companyId: string, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(isUuid))];
  if (!list.length) return new Map<string, MarketingAssetRow & { kind: string; status: string; name: string; width: number | null; height: number | null }>();
  const rows = await db().marketingAsset.findMany({
    where: { id: { in: list }, organizationId, companyId },
    select: { id: true, organizationId: true, companyId: true, url: true, mimeType: true, sizeBytes: true, storageRef: true, kind: true, status: true, name: true, width: true, height: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

export const json = (v: unknown) => v as Prisma.InputJsonValue;
