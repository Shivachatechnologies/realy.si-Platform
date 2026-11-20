import "server-only";
import { z } from "zod";
import type { VoiceProvider } from "@/generated/prisma/enums";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { getConnection, type Connection } from "@/server/modules/integrations/connections";
import { ProviderError } from "@/server/modules/integrations/providers";
import { authorize, isUuid, PROVIDER_KEY, toE164, uuid } from "./common";
import { assignInbound, buyProviderNumber, importTwilioToVapi, listNumbers, twilioBuy, twilioOwnedNumbers, twilioSearch, type ProviderNumber } from "./providers";
import { ensureSettings, providerLabel } from "./service";

/** Phone numbers of the phone team: synced from the provider, bought there or on Twilio, and routed to an agent. */

export const buyInput = z.discriminatedUnion("mode", [
  /** Retell: US/Canada area code. Vapi: free US number. */
  z.object({ mode: z.literal("provider"), areaCode: z.string().regex(/^\d{3}$/), label: z.string().trim().max(60).optional() }),
  /** Vapi: buy a number on the company's Twilio account and import it. */
  z.object({ mode: z.literal("twilio_buy"), number: z.string().trim().max(20), label: z.string().trim().max(60).optional() }),
  /** Vapi: import a number the company already owns on Twilio. */
  z.object({ mode: z.literal("twilio_import"), number: z.string().trim().max(20), label: z.string().trim().max(60).optional() }),
]);
export const assignInput = z.object({ inboundAgentId: uuid.nullable().optional(), label: z.string().trim().max(60).nullable().optional() }).strict();
export const twilioSearchInput = z.object({ country: z.string().regex(/^[A-Z]{2}$/).default("US"), areaCode: z.string().regex(/^\d{2,5}$/).optional() });

async function providerConnection(organizationId: string, companyId: string): Promise<{ provider: VoiceProvider; conn: Connection }> {
  const settings = await ensureSettings(db(), organizationId, companyId);
  if (!settings.provider) throw invalid("Choose Vapi or Retell AI first", { reason: "voice_no_provider" });
  const conn = await getConnection(organizationId, companyId, PROVIDER_KEY[settings.provider]);
  if (!conn?.accessToken) throw new AppError("not_configured", `${providerLabel(settings.provider)} is not connected`, { reason: "voice_credential_required", provider: PROVIDER_KEY[settings.provider] });
  return { provider: settings.provider, conn };
}

const providerFailure = (err: unknown) => {
  if (err instanceof ProviderError) return new AppError("conflict", err.message, { reason: err.status === 401 || err.status === 403 ? "voice_credential_required" : "voice_provider_error" });
  return err;
};

export async function listPhoneNumbers(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  return db().voicePhoneNumber.findMany({
    where: { organizationId, companyId, releasedAt: null },
    orderBy: { createdAt: "asc" },
    include: { inboundAgent: { select: { id: true, name: true, goal: true } }, _count: { select: { calls: true } } },
  });
}

async function upsertNumber(organizationId: string, companyId: string, provider: VoiceProvider, n: ProviderNumber, extra: { source?: "PROVIDER" | "TWILIO"; twilioSid?: string | null } = {}) {
  const agent = n.inboundAgentExternalId ? await db().voiceAgent.findFirst({ where: { organizationId, companyId, provider, externalAgentId: n.inboundAgentExternalId }, select: { id: true } }) : null;
  return db().voicePhoneNumber.upsert({
    where: { companyId_provider_externalId: { companyId, provider, externalId: n.externalId } },
    create: { organizationId, companyId, provider, externalId: n.externalId, number: n.number, label: n.label, source: extra.source ?? "PROVIDER", twilioSid: extra.twilioSid ?? null, inboundAgentId: agent?.id ?? null },
    update: { number: n.number, label: n.label ?? undefined, inboundAgentId: agent?.id ?? null, releasedAt: null, ...(extra.twilioSid ? { twilioSid: extra.twilioSid, source: "TWILIO" as const } : {}) },
  });
}

/** Mirror the provider's numbers (new ones appear, removed ones are marked released). */
export async function syncNumbers(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.manage");
  const { provider, conn } = await providerConnection(organizationId, companyId);
  let remote: ProviderNumber[];
  try {
    remote = await listNumbers(provider, conn);
  } catch (err) {
    throw providerFailure(err);
  }
  for (const n of remote) await upsertNumber(organizationId, companyId, provider, n);
  const released = await db().voicePhoneNumber.updateMany({
    where: { organizationId, companyId, provider, releasedAt: null, externalId: { notIn: remote.map((r) => r.externalId) } },
    data: { releasedAt: new Date(), inboundAgentId: null },
  });
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.numbers.synced", resourceType: "voice_settings", resourceId: companyId, newValue: { provider, found: remote.length, released: released.count } }));
  return { found: remote.length, released: released.count };
}

/** Numbers on the company's Twilio account and numbers available to buy there (Vapi only). */
export async function twilioOptions(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof twilioSearchInput>) {
  await authorize(ctx, organizationId, companyId, "communication.manage");
  const input = twilioSearchInput.parse(raw);
  const twilio = await getConnection(organizationId, companyId, "twilio");
  if (!twilio?.accessToken) return { connected: false as const, owned: [], available: [] };
  try {
    const [owned, available] = await Promise.all([twilioOwnedNumbers(twilio), input.areaCode || input.country ? twilioSearch(twilio, input.country, input.areaCode ?? null) : Promise.resolve([])]);
    const imported = new Set((await db().voicePhoneNumber.findMany({ where: { organizationId, companyId, releasedAt: null }, select: { number: true } })).map((n) => n.number));
    return { connected: true as const, owned: owned.map((o) => ({ ...o, imported: imported.has(o.number) })), available };
  } catch (err) {
    throw providerFailure(err);
  }
}

/** Get a number: bought on the provider, bought on Twilio and imported, or an owned Twilio number imported (Vapi). */
export async function buyNumber(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof buyInput>) {
  const input = buyInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.manage");
  const { provider, conn } = await providerConnection(organizationId, companyId);
  let n: ProviderNumber;
  let twilioSid: string | null = null;
  try {
    if (input.mode === "provider") {
      n = await buyProviderNumber(provider, conn, input.areaCode, input.label || null);
    } else {
      if (provider !== "VAPI") throw invalid("Twilio numbers can be imported into Vapi. With Retell AI, buy the number in Retell.", { reason: "voice_twilio_vapi_only" });
      const number = toE164(input.number);
      if (!number) throw invalid("Enter the number in international format", { reason: "voice_number_invalid" });
      if (await db().voicePhoneNumber.findFirst({ where: { organizationId, companyId, number, releasedAt: null }, select: { id: true } })) throw conflict("This number is already connected", { reason: "voice_number_exists" });
      const twilio = await getConnection(organizationId, companyId, "twilio");
      if (!twilio?.accessToken) throw new AppError("not_configured", "Twilio is not connected", { reason: "voice_credential_required", provider: "twilio" });
      if (input.mode === "twilio_buy") {
        const bought = await twilioBuy(twilio, number, input.label || null);
        twilioSid = bought.sid;
        n = await importTwilioToVapi(conn, twilio, bought.number, input.label || null);
      } else {
        const owned = await twilioOwnedNumbers(twilio);
        const match = owned.find((o) => o.number === number);
        if (!match) throw invalid("This number is not on your Twilio account", { reason: "voice_twilio_not_owned" });
        twilioSid = match.sid;
        n = await importTwilioToVapi(conn, twilio, number, input.label || null);
      }
    }
  } catch (err) {
    throw providerFailure(err);
  }
  const row = await upsertNumber(organizationId, companyId, provider, n, { source: input.mode === "provider" ? "PROVIDER" : "TWILIO", twilioSid });
  await transaction((tx) => writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.number.added", resourceType: "voice_phone_number", resourceId: row.id, newValue: { provider, mode: input.mode, number: row.number } }));
  return row;
}

/** Route a number's inbound calls to an agent (the AI receptionist), or detach it; rename it. */
export async function assignNumber(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof assignInput>) {
  const input = assignInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.manage");
  if (!isUuid(id)) throw notFound("Phone number");
  const n = await db().voicePhoneNumber.findFirst({ where: { id, organizationId, companyId, releasedAt: null } });
  if (!n) throw notFound("Phone number");
  if (input.inboundAgentId !== undefined) {
    let externalAgentId: string | null = null;
    if (input.inboundAgentId) {
      const a = await db().voiceAgent.findFirst({ where: { id: input.inboundAgentId, organizationId, companyId, archivedAt: null } });
      if (!a) throw notFound("Agent");
      if (a.provider !== n.provider) throw invalid("The agent and the number must be on the same provider", { reason: "voice_provider_mismatch" });
      if (a.syncStatus !== "SYNCED" || !a.externalAgentId) throw invalid("Sync the agent with the provider first", { reason: "voice_agent_not_synced" });
      externalAgentId = a.externalAgentId;
    }
    const conn = await getConnection(organizationId, companyId, PROVIDER_KEY[n.provider]);
    if (!conn?.accessToken) throw new AppError("not_configured", `${providerLabel(n.provider)} is not connected`, { reason: "voice_credential_required", provider: PROVIDER_KEY[n.provider] });
    try {
      await assignInbound(n.provider, conn, n.externalId, externalAgentId);
    } catch (err) {
      throw providerFailure(err);
    }
  }
  return transaction(async (tx) => {
    const u = await tx.voicePhoneNumber.update({
      where: { id },
      data: { ...(input.inboundAgentId !== undefined ? { inboundAgentId: input.inboundAgentId } : {}), ...(input.label !== undefined ? { label: input.label || null } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.number.updated", resourceType: "voice_phone_number", resourceId: id, newValue: { inboundAgentId: input.inboundAgentId, label: input.label } });
    return u;
  });
}
