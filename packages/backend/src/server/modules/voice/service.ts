import "server-only";
import { z } from "zod";
import type { VoiceProvider } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { decryptSecret, encryptSecret, randomToken } from "@/server/core/crypto";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { DOMAIN_EVENTS, type DomainEventType } from "@/server/modules/events/catalog";
import { actorId, authorize, companyTwilioNumbers, isUuid, minutesLabel, PROVIDER_KEY, PROVIDERS, toE164, TWILIO_VOICE, uuid } from "./common";
import { platformAvailability } from "@/server/modules/integrations/platform-managed";
import { webhookUrl } from "./providers";
import { CAPABILITIES, isSipUri, isWss, sealSipPassword, twilioHookUrl } from "./telephony";

/** Phone team settings, setup state and the do-not-call list (voice module). */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const toMinutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

export const settingsInput = z
  .object({
    provider: z.enum(PROVIDERS).optional(),
    callingStart: hhmm.optional(),
    callingEnd: hhmm.optional(),
    callingDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    maxDurationMin: z.number().int().min(1).max(60).optional(),
    recordCalls: z.boolean().optional(),
    maxConcurrent: z.number().int().min(1).max(10).optional(),
    voicemailUserId: uuid.nullable().optional(),
    inboundTickets: z.boolean().optional(),
    inboundLeads: z.boolean().optional(),
    autoFollowUps: z.boolean().optional(),
    completeSetup: z.boolean().optional(),
    // Telephony (Twilio Programmable Voice bridged to the AI agent, generic SIP) and queue rules.
    telephony: z.enum(["PROVIDER", "TWILIO"]).optional(),
    bridgeMode: z.enum(["PROVIDER_SIP", "CUSTOM_SIP", "MEDIA_STREAM"]).optional(),
    bridgeSipUri: z.string().trim().max(300).refine((v) => !v || isSipUri(v), "Use a SIP URI like sip:agent@sip.example.com").nullable().optional(),
    sipUsername: z.string().trim().max(120).nullable().optional(),
    /** Write-only; "" clears it. */
    sipPassword: z.string().max(200).optional(),
    mediaStreamUrl: z.string().trim().max(500).refine((v) => !v || isWss(v), "Use a wss:// URL").nullable().optional(),
    twilioFromNumber: z.string().trim().max(40).nullable().optional(),
    liveTranscription: z.boolean().optional(),
    humanTransferNumber: z.string().trim().max(40).nullable().optional(),
    retryMaxAttempts: z.number().int().min(0).max(5).optional(),
    retryDelayMin: z.number().int().min(15).max(10_080).optional(),
  })
  .strict();

export const dncInput = z.object({ phone: z.string().trim().min(5).max(40), reason: z.string().trim().max(300).optional() }).strict();

const vapiPurpose = (companyId: string) => `voice.vapi-secret:${companyId}`;

/** The company's settings row (created on first use with a fresh webhook key). */
export async function ensureSettings(client: Db | Tx, organizationId: string, companyId: string) {
  const existing = await client.voiceSettings.findUnique({ where: { companyId } });
  if (existing) {
    if (existing.organizationId !== organizationId) throw notFound("Company");
    return existing;
  }
  return client.voiceSettings.upsert({ where: { companyId }, create: { companyId, organizationId, webhookKey: randomToken(24) }, update: {} });
}

/** Vapi webhook secret (created and stored encrypted on first use). */
export async function vapiSecret(organizationId: string, companyId: string): Promise<string> {
  const s = await ensureSettings(db(), organizationId, companyId);
  if (s.vapiSecretEnc) {
    try {
      return decryptSecret(s.vapiSecretEnc, vapiPurpose(companyId));
    } catch {
      // fall through: rotate an unreadable secret
    }
  }
  const secret = randomToken(32);
  await db().voiceSettings.update({ where: { companyId }, data: { vapiSecretEnc: encryptSecret(secret, vapiPurpose(companyId)) } });
  return secret;
}

export function readVapiSecret(companyId: string, enc: string | null): string | null {
  if (!enc) return null;
  try {
    return decryptSecret(enc, vapiPurpose(companyId));
  } catch {
    return null;
  }
}

export type ConnectionState = "connected" | "error" | "missing" | "disabled";

/** Connection state of the voice providers and Twilio (no credentials read). */
export async function providerStates(organizationId: string, companyId: string): Promise<Record<"vapi" | "retell" | "twilio", ConnectionState>> {
  void organizationId;
  void companyId;
  // Vapi, Retell and Twilio Voice are platform-managed (Admin → Platform keys): "connected" means available on the
  // platform's account, "missing" means the platform has not configured it yet. "twilio" is the Twilio Voice account.
  const state = async (p: string): Promise<ConnectionState> => {
    const a = await platformAvailability(p);
    return a === "available" ? "connected" : a === "disabled" ? "disabled" : "missing";
  };
  return { vapi: await state("vapi"), retell: await state("retell"), twilio: await state(TWILIO_VOICE) };
}

export function publicSettings(s: Awaited<ReturnType<typeof ensureSettings>>) {
  return {
    provider: s.provider,
    callingStart: minutesLabel(s.callingStartMin),
    callingEnd: minutesLabel(s.callingEndMin),
    callingDays: s.callingDays,
    maxDurationMin: Math.round(s.maxDurationSec / 60),
    recordCalls: s.recordCalls,
    maxConcurrent: s.maxConcurrent,
    voicemailUserId: s.voicemailUserId,
    inboundTickets: s.inboundTickets,
    inboundLeads: s.inboundLeads,
    autoFollowUps: s.autoFollowUps,
    setupCompletedAt: s.setupCompletedAt,
    webhookUrl: s.provider ? webhookUrl(s.provider, s.webhookKey) : null,
    telephony: s.telephony,
    bridgeMode: s.bridgeMode,
    bridgeSipUri: s.bridgeSipUri,
    sipUsername: s.sipUsername,
    sipPasswordSet: !!s.sipPasswordEnc,
    mediaStreamUrl: s.mediaStreamUrl,
    twilioFromNumber: s.twilioFromNumber,
    liveTranscription: s.liveTranscription,
    humanTransferNumber: s.humanTransferNumber,
    retryMaxAttempts: s.retryMaxAttempts,
    retryDelayMin: s.retryDelayMin,
    twilioVoiceUrl: twilioHookUrl(s.webhookKey, "inbound"),
    twilioStatusUrl: twilioHookUrl(s.webhookKey, "status"),
    capabilities: CAPABILITIES,
  };
}

/** Everything the /voice pages need to show where the setup stands. */
export async function voiceOverview(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const settings = await ensureSettings(db(), organizationId, companyId);
  const scope = { organizationId, companyId };
  const [connections, agents, syncedAgents, numbers, inboundNumbers, dnc] = await Promise.all([
    providerStates(organizationId, companyId),
    db().voiceAgent.count({ where: { ...scope, archivedAt: null } }),
    db().voiceAgent.count({ where: { ...scope, archivedAt: null, syncStatus: "SYNCED" } }),
    db().voicePhoneNumber.count({ where: { ...scope, releasedAt: null } }),
    db().voicePhoneNumber.count({ where: { ...scope, releasedAt: null, inboundAgentId: { not: null } } }),
    db().voiceDoNotCall.count({ where: scope }),
  ]);
  const providerConnected = settings.provider ? connections[PROVIDER_KEY[settings.provider]] === "connected" : false;
  const steps = {
    provider: !!settings.provider && providerConnected,
    rules: !!settings.setupCompletedAt,
    agent: syncedAgents > 0,
    number: numbers > 0,
    inbound: inboundNumbers > 0,
  };
  return { settings: publicSettings(settings), connections, providerConnected, counts: { agents, syncedAgents, numbers, inboundNumbers, dnc }, steps };
}

export async function updateSettings(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const current = await ensureSettings(tx, organizationId, companyId);
    const start = input.callingStart ? toMinutes(input.callingStart) : current.callingStartMin;
    const end = input.callingEnd ? toMinutes(input.callingEnd) : current.callingEndMin;
    if (end <= start) throw invalid("Calling hours must end after they start", { reason: "voice_hours_invalid" });
    const e164 = (v: string | null | undefined, field: string) => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const n = toE164(v);
      if (!n) throw invalid(`${field}: use international format, e.g. +44 20 7946 0958`, { reason: "voice_number_invalid" });
      return n;
    };
    const twilioFrom = e164(input.twilioFromNumber, "Twilio caller id");
    const human = e164(input.humanTransferNumber, "Transfer number");
    if (input.voicemailUserId) {
      const member = await tx.membership.findFirst({ where: { organizationId, userId: input.voicemailUserId, status: "ACTIVE" }, select: { userId: true } });
      if (!member) throw invalid("Pick an active member of the organization", { reason: "voice_member_invalid" });
    }
    const updated = await tx.voiceSettings.update({
      where: { companyId },
      data: {
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        callingStartMin: start,
        callingEndMin: end,
        ...(input.callingDays ? { callingDays: [...new Set(input.callingDays)].sort() } : {}),
        ...(input.maxDurationMin !== undefined ? { maxDurationSec: input.maxDurationMin * 60 } : {}),
        ...(input.recordCalls !== undefined ? { recordCalls: input.recordCalls } : {}),
        ...(input.maxConcurrent !== undefined ? { maxConcurrent: input.maxConcurrent } : {}),
        ...(input.voicemailUserId !== undefined ? { voicemailUserId: input.voicemailUserId } : {}),
        ...(input.inboundTickets !== undefined ? { inboundTickets: input.inboundTickets } : {}),
        ...(input.inboundLeads !== undefined ? { inboundLeads: input.inboundLeads } : {}),
        ...(input.autoFollowUps !== undefined ? { autoFollowUps: input.autoFollowUps } : {}),
        ...(input.completeSetup ? { setupCompletedAt: current.setupCompletedAt ?? new Date() } : {}),
        ...(input.telephony !== undefined ? { telephony: input.telephony } : {}),
        ...(input.bridgeMode !== undefined ? { bridgeMode: input.bridgeMode } : {}),
        ...(input.bridgeSipUri !== undefined ? { bridgeSipUri: input.bridgeSipUri || null } : {}),
        ...(input.sipUsername !== undefined ? { sipUsername: input.sipUsername || null } : {}),
        ...(input.sipPassword !== undefined ? { sipPasswordEnc: input.sipPassword ? sealSipPassword(companyId, input.sipPassword) : null } : {}),
        ...(input.mediaStreamUrl !== undefined ? { mediaStreamUrl: input.mediaStreamUrl || null } : {}),
        ...(twilioFrom !== undefined ? { twilioFromNumber: twilioFrom } : {}),
        ...(input.liveTranscription !== undefined ? { liveTranscription: input.liveTranscription } : {}),
        ...(human !== undefined ? { humanTransferNumber: human } : {}),
        ...(input.retryMaxAttempts !== undefined ? { retryMaxAttempts: input.retryMaxAttempts } : {}),
        ...(input.retryDelayMin !== undefined ? { retryDelayMin: input.retryDelayMin } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.settings.updated", resourceType: "voice_settings", resourceId: companyId, newValue: { ...input, ...(input.sipPassword !== undefined ? { sipPassword: input.sipPassword ? "(set)" : "(cleared)" } : {}) } });
    return publicSettings(updated);
  });
}

// ───────────── Do-not-call ─────────────

export async function listDoNotCall(ctx: RequestContext, organizationId: string, companyId: string, opts: { q?: string } = {}) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const q = opts.q?.replace(/[^\d+]/g, "").slice(0, 20);
  return db().voiceDoNotCall.findMany({ where: { organizationId, companyId, ...(q ? { phone: { contains: q } } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
}

export async function addDoNotCall(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof dncInput>) {
  const input = dncInput.parse(raw);
  const phone = toE164(input.phone);
  if (!phone) throw invalid("Enter the number in international format, e.g. +44 20 7946 0958", { reason: "voice_number_invalid" });
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const existing = await tx.voiceDoNotCall.findUnique({ where: { companyId_phone: { companyId, phone } } });
    if (existing) throw conflict("This number is already on the do-not-call list", { reason: "voice_dnc_exists" });
    const row = await tx.voiceDoNotCall.create({ data: { organizationId, companyId, phone, reason: input.reason || null, source: "MANUAL", createdById: actorId(ctx, organizationId) } });
    // Calls not placed yet to this number are stopped right away.
    await tx.voiceCall.updateMany({ where: { organizationId, companyId, toNumber: phone, direction: "OUTBOUND", status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] } }, data: { status: "BLOCKED", blockedReason: "do_not_call" } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.dnc.added", resourceType: "voice_do_not_call", resourceId: row.id, newValue: { phone: `${phone.slice(0, 4)}…${phone.slice(-3)}` } });
    return row;
  });
}

export async function removeDoNotCall(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  if (!isUuid(id)) throw notFound("Entry");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const row = await tx.voiceDoNotCall.findFirst({ where: { id, organizationId, companyId } });
    if (!row) throw notFound("Entry");
    // A caller's own request can only be lifted with care; it stays recorded in the audit log.
    await tx.voiceDoNotCall.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.dnc.removed", resourceType: "voice_do_not_call", resourceId: id, oldValue: { source: row.source, reason: row.reason } });
    return { ok: true };
  });
}

/** Is the number blocked (do-not-call list, or a CRM record tagged do-not-call / dnc)? */
export async function isDoNotCall(client: Db | Tx, companyId: string, phone: string, record?: { tags?: string[] | null }): Promise<boolean> {
  if ((record?.tags ?? []).some((t) => ["do-not-call", "dnc", "do not call"].includes(t.toLowerCase()))) return true;
  return !!(await client.voiceDoNotCall.findUnique({ where: { companyId_phone: { companyId, phone } }, select: { id: true } }));
}

// ───────────── Events ─────────────

/**
 * Emit a voice domain event when the catalog knows the type (events/catalog.ts DOMAIN_EVENTS is owned by the platform;
 * until "voice.*" types are registered there, voice changes are recorded in the audit log only).
 */
export async function emitVoiceEvent(tx: Tx, ctx: RequestContext, type: string, args: { organizationId: string; companyId: string; entityType: string; entityId: string; data?: Record<string, string | number | boolean | null | Date | bigint | undefined> }) {
  if (!(DOMAIN_EVENTS as readonly string[]).includes(type)) return null;
  return emitDomainEvent(tx, ctx, type as DomainEventType, args);
}

export const providerLabel = (p: VoiceProvider) => (p === "VAPI" ? "Vapi" : "Retell AI");

// ───────────── Twilio number → Realy ─────────────

export const twilioConnectInput = z.object({ number: z.string().trim().min(5).max(40) }).strict();

/**
 * Point one of the company's Twilio numbers at Realy (Voice URL → inbound TwiML, status callback → call progress), so
 * inbound calls are bridged to the AI receptionist and every call's status reaches the live call center.
 */
export async function connectTwilioNumber(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof twilioConnectInput>) {
  const { number } = twilioConnectInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.manage");
  const e164 = toE164(number);
  if (!e164) throw invalid("Use international format", { reason: "voice_number_invalid" });
  const { getConnection } = await import("@/server/modules/integrations/connections");
  const { twilioOwnedNumbers } = await import("./providers");
  const { providerFetch } = await import("@/server/modules/integrations/client");
  const conn = await getConnection(organizationId, companyId, TWILIO_VOICE);
  if (!conn?.accessToken) throw invalid("Telephony is not available on the platform right now", { reason: "voice_credential_required" });
  // Platform account: only this company's own numbers can be pointed at its webhooks.
  if (!(await companyTwilioNumbers(organizationId, companyId)).has(e164)) throw notFound("Twilio number");
  const owned = await twilioOwnedNumbers(conn);
  const hit = owned.find((n) => n.number === e164);
  if (!hit?.sid) throw notFound("Twilio number");
  const settings = await ensureSettings(db(), organizationId, companyId);
  const sid = String(conn.config.accountSid);
  const res = await providerFetch(conn, `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${hit.sid}.json`, {
    method: "POST",
    form: { VoiceUrl: twilioHookUrl(settings.webhookKey, "inbound"), VoiceMethod: "POST", StatusCallback: twilioHookUrl(settings.webhookKey, "status"), StatusCallbackMethod: "POST" },
    retries: 0,
  });
  if (!res.ok) throw invalid("Twilio did not accept the change", { reason: "voice_provider_error" });
  await transaction(async (tx) => {
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "voice.twilio_number.connected", resourceType: "voice_settings", resourceId: companyId, newValue: { number: `${e164.slice(0, 4)}…${e164.slice(-3)}` } });
  });
  return { ok: true, number: e164 };
}
