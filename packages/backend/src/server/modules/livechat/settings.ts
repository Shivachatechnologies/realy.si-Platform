import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { env } from "@/server/core/env";
import { invalid } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { authorize, BRAND_COLOR, ensureSettings, newPublicKey, normalizeOrigin } from "./common";

export const settingsInput = z
  .object({
    enabled: z.boolean(),
    allowedOrigins: z.array(z.string().trim().min(1).max(200)).max(20),
    brandColor: z.string().regex(BRAND_COLOR),
    position: z.enum(["right", "left"]),
    assistantName: z.string().trim().min(1).max(60),
    greeting: z.string().trim().max(500).nullable(),
    aiEnabled: z.boolean(),
    brainTag: z.string().trim().toLowerCase().min(1).max(40).regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u),
    publicFacts: z.string().trim().max(8000).nullable(),
    autoCreateLeads: z.boolean(),
    autoCreateTickets: z.boolean(),
    meetingsEnabled: z.boolean(),
    privacyUrl: z.string().trim().url().max(500).nullable().or(z.literal("").transform(() => null)),
    retentionDays: z.number().int().min(7).max(3650),
  })
  .partial();

export async function getLivechatSettings(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "support.read");
  return ensureSettings(db(), organizationId, companyId);
}

export async function updateLivechatSettings(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  let origins: string[] | undefined;
  if (input.allowedOrigins) {
    origins = [];
    for (const o of input.allowedOrigins) {
      const n = normalizeOrigin(o);
      if (!n) throw invalid("Enter website addresses like https://example.com", { reason: "livechat_invalid_origin", origin: o.slice(0, 200) });
      origins.push(n);
    }
    origins = [...new Set(origins)];
  }
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    const before = await ensureSettings(tx, organizationId, companyId);
    const data = { ...input, ...(origins ? { allowedOrigins: origins } : {}) };
    if (data.enabled && !(origins ?? before.allowedOrigins).length) {
      throw invalid("Add your website address before turning the chat on", { reason: "livechat_no_origins" });
    }
    const s = await tx.livechatSettings.update({ where: { companyId }, data });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "livechat.settings.updated", resourceType: "livechat_settings", resourceId: companyId, oldValue: pickChanged(before, data), newValue: data });
    return s;
  });
}

function pickChanged(before: Record<string, unknown>, data: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(data).map((k) => [k, before[k]]));
}

/** New public key: every snippet with the old key stops working (e.g. after abuse). */
export async function rotatePublicKey(ctx: RequestContext, organizationId: string, companyId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "support.manage", tx);
    await ensureSettings(tx, organizationId, companyId);
    const s = await tx.livechatSettings.update({ where: { companyId }, data: { publicKey: newPublicKey() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "livechat.key.rotated", resourceType: "livechat_settings", resourceId: companyId });
    return s;
  });
}

export const appOrigin = () => new URL(env().APP_URL).origin;

/** The one-line embed snippet for the company's website. */
export function embedSnippet(publicKey: string) {
  return `<script src="${appOrigin()}/api/public/chat/widget.js" data-key="${publicKey}" async></script>`;
}
