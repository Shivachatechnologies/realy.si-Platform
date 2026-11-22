import "server-only";
import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { hmacSha256, safeEqual, sha256 } from "@/server/core/crypto";
import { env } from "@/server/core/env";
import { logger } from "@/server/core/logger";
import { consume } from "@/server/core/rate-limit";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { providerInfo } from "./catalog";
import { decryptCredentials, markConnectionError } from "./connections";
import { authHeaders, plaidHost } from "./providers";
import { FLAT_COST_MICROS, recordUsage } from "./usage";
import { verifyHookSignature } from "./webhook-signatures";

/**
 * Provider webhooks & status callbacks (POST /api/v1/integrations/webhooks/<provider>/<connectionId>/<token>).
 * Every connection has its own unguessable URL (an HMAC of the connection id with the platform key), and providers
 * that sign their callbacks are verified with their documented scheme on top (Twilio, Calendly, Meta, ElevenLabs,
 * Zendesk, Intercom, Plaid JWT). Accepted events are stored (deduplicated) as IntegrationProviderEvent and, where Realy
 * has a home for them, applied: Calendly invitees become CRM meetings, Plaid updates schedule a bank-feed sync, a Plaid
 * item error marks the connection failing, finished Twilio calls are metered.
 */

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;
const MAX_BODY = 512 * 1024;
const LIMIT = { name: "integration-provider-webhook", limit: 600, windowMs: 60_000 };

export function providerWebhookToken(connectionId: string): string {
  return hmacSha256(env().REALY_ENCRYPTION_KEY, `integrations.provider-webhook:${connectionId}`).toString("hex").slice(0, 40);
}

export const providerWebhookUrl = (provider: string, connectionId: string) =>
  `${env().APP_URL.replace(/\/+$/, "")}/api/v1/integrations/webhooks/${provider}/${connectionId}/${providerWebhookToken(connectionId)}`;

export interface ProviderWebhookResult {
  status: number;
  body: Record<string, unknown> | string;
  /** text/plain responses (Meta's GET verification challenge). */
  text?: boolean;
}

export type ProviderEventRow = { id: string; organizationId: string; companyId: string; provider: string; connectedById: string; credentialsEnc: string | null; config: Prisma.JsonValue };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown, max = 300): string | null => (typeof v === "string" && v ? v.slice(0, max) : typeof v === "number" ? String(v) : null);

// ───────────────────────────── Plaid JWT verification ─────────────────────────────

const plaidKeys = new Map<string, { key: JsonWebKey; fetchedAt: number }>();

async function verifyPlaid(row: ProviderEventRow, raw: string, headers: Headers): Promise<string | null> {
  const jwt = headers.get("plaid-verification") ?? "";
  const [h, p, sig] = jwt.split(".");
  if (!h || !p || !sig) return "missing Plaid-Verification";
  let header: { alg?: string; kid?: string };
  let payload: { iat?: number; request_body_sha256?: string };
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as typeof header;
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as typeof payload;
  } catch {
    return "malformed Plaid-Verification";
  }
  if (header.alg !== "ES256" || !header.kid || !/^[A-Za-z0-9_-]{8,100}$/.test(header.kid)) return "unexpected Plaid JWT header";
  let cached = plaidKeys.get(header.kid);
  if (!cached || Date.now() - cached.fetchedAt > 24 * 3_600_000) {
    const creds = decryptCredentials(row.companyId, row.provider, row.credentialsEnc);
    const config = obj(row.config);
    if (!creds.apiKey) return "Plaid credentials missing";
    const res = await fetch(`${plaidHost(config)}/webhook_verification_key/get`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders("plaid", creds.apiKey, config) },
      body: JSON.stringify({ key_id: header.kid }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => ({}))) as { key?: JsonWebKey }) : {};
    if (!body.key) return "Plaid verification key unavailable";
    cached = { key: body.key, fetchedAt: Date.now() };
    plaidKeys.set(header.kid, cached);
  }
  let ok = false;
  try {
    ok = verifySignature("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: cached.key, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
  } catch {
    ok = false;
  }
  if (!ok) return "Plaid signature verification failed";
  if (typeof payload.iat !== "number" || Math.abs(Date.now() / 1000 - payload.iat) > 5 * 60) return "Plaid webhook too old";
  if (!payload.request_body_sha256 || !safeEqual(payload.request_body_sha256, sha256(raw))) return "Plaid body hash mismatch";
  return null;
}

// ───────────────────────────── Receive ─────────────────────────────

export async function receiveProviderWebhook(
  provider: string,
  connectionId: string,
  token: string,
  method: "GET" | "POST",
  raw: string,
  headers: Headers,
  query: URLSearchParams,
): Promise<ProviderWebhookResult> {
  const info = providerInfo(provider);
  const notFoundRes = { status: 404, body: { error: "not_found" } };
  if (!info?.inboundWebhooks || !isUuid(connectionId) || !/^[a-f0-9]{40}$/.test(token) || !safeEqual(token, providerWebhookToken(connectionId))) return notFoundRes;
  const row = await db().integrationConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, organizationId: true, companyId: true, provider: true, status: true, connectedById: true, credentialsEnc: true, config: true },
  });
  if (!row || row.provider !== provider || row.status === "DISCONNECTED" || !row.credentialsEnc) return notFoundRes;
  const limit = await consume(LIMIT, connectionId);
  if (!limit.allowed) return { status: 429, body: { error: "rate_limited" } };
  if (Buffer.byteLength(raw) > MAX_BODY) return { status: 413, body: { error: "payload_too_large" } };
  const creds = decryptCredentials(row.companyId, row.provider, row.credentialsEnc);
  const secrets = creds.secrets ?? {};

  // Meta (WhatsApp Cloud API) subscription handshake: echo hub.challenge when the verify token is this URL's token.
  if (method === "GET") {
    if (info.inboundWebhooks.scheme === "META" && query.get("hub.mode") === "subscribe" && safeEqual(query.get("hub.verify_token") ?? "", token)) {
      return { status: 200, body: (query.get("hub.challenge") ?? "").slice(0, 200), text: true };
    }
    return { status: 405, body: { error: "method_not_allowed" } };
  }

  const scheme = info.inboundWebhooks.scheme;
  let failure: string | null = null;
  if (scheme === "PLAID") failure = await verifyPlaid(row, raw, headers);
  else if (scheme !== "token") {
    const secret =
      scheme === "TWILIO" ? creds.apiKey : scheme === "CALENDLY" ? secrets.calendlyWebhookKey : scheme === "META" ? secrets.appSecret : secrets.webhookSecret;
    if (!secret) failure = `no ${scheme.toLowerCase()} signing secret is configured for this connection`;
    else {
      const qs = query.toString();
      const r = verifyHookSignature({ verification: scheme, secret, raw, headers, query, signatureHeader: "", url: `${providerWebhookUrl(provider, connectionId)}${qs ? `?${qs}` : ""}` });
      if (!r.ok) failure = r.reason;
    }
  }
  if (failure) {
    logger.warn({ provider, connectionId, reason: failure }, "provider webhook rejected");
    return { status: 401, body: { error: "unauthenticated" } };
  }

  const ct = headers.get("content-type") ?? "";
  let body: Record<string, unknown> = {};
  if (ct.includes("application/x-www-form-urlencoded")) body = Object.fromEntries(new URLSearchParams(raw));
  else {
    try {
      body = obj(JSON.parse(raw));
    } catch {
      body = {};
    }
  }
  try {
    const handled = await handle(row, body, raw);
    return { status: 200, body: { ok: true, ...(handled.duplicate ? { duplicate: true } : {}) } };
  } catch (err) {
    logger.error({ provider, connectionId, err: err instanceof Error ? err.message : "handler failed" }, "provider webhook handler failed");
    // 500 makes the provider retry later (all of these providers retry on 5xx).
    return { status: 500, body: { error: "handler_failed" } };
  }
}

interface Parsed {
  eventType: string;
  dedupeKey: string;
  summary: Record<string, unknown>;
}

function parse(provider: string, body: Record<string, unknown>, raw: string): Parsed {
  const digest = sha256(raw).slice(0, 32);
  switch (provider) {
    case "calendly": {
      const payload = obj(body.payload);
      const ev = obj(payload.scheduled_event);
      const type = s(body.event) ?? "unknown";
      return {
        eventType: type,
        dedupeKey: `${type}:${s(payload.uri, 200) ?? digest}`,
        summary: { invitee: s(payload.uri), status: s(payload.status), eventName: s(ev.name, 200), startTime: s(ev.start_time), endTime: s(ev.end_time), rescheduled: payload.rescheduled === true },
      };
    }
    case "twilio":
    case "twilio_voice": {
      const sid = s(body.CallSid) ?? s(body.MessageSid) ?? s(body.RecordingSid) ?? digest;
      const status = s(body.RecordingStatus) ? `recording.${s(body.RecordingStatus)}` : s(body.CallStatus) ? `call.${s(body.CallStatus)}` : s(body.MessageStatus) ? `message.${s(body.MessageStatus)}` : "unknown";
      return {
        eventType: status,
        dedupeKey: `${sid}:${status}:${s(body.RecordingSid) ?? ""}`,
        summary: {
          callSid: s(body.CallSid),
          messageSid: s(body.MessageSid),
          direction: s(body.Direction),
          durationSeconds: body.CallDuration ? Number(body.CallDuration) || 0 : body.RecordingDuration ? Number(body.RecordingDuration) || 0 : null,
          recordingSid: s(body.RecordingSid),
          // Twilio recording URLs need the account credentials to fetch; storing the URL is safe.
          recordingUrl: s(body.RecordingUrl, 500),
          errorCode: s(body.ErrorCode),
        },
      };
    }
    case "plaid": {
      const type = `${s(body.webhook_type) ?? "UNKNOWN"}:${s(body.webhook_code) ?? "UNKNOWN"}`;
      const err = obj(body.error);
      return { eventType: type, dedupeKey: `${type}:${s(body.item_id) ?? ""}:${digest}`, summary: { itemId: s(body.item_id), environment: s(body.environment), error: s(err.error_code) } };
    }
    case "whatsapp": {
      const changes = (Array.isArray(body.entry) ? body.entry : []).flatMap((e) => (Array.isArray(obj(e).changes) ? (obj(e).changes as unknown[]) : [])).map((c) => obj(obj(c).value));
      const messages = changes.reduce((n, v) => n + (Array.isArray(v.messages) ? v.messages.length : 0), 0);
      const statuses = changes.flatMap((v) => (Array.isArray(v.statuses) ? v.statuses.map((x) => s(obj(x).status)) : [])).filter(Boolean);
      return { eventType: messages ? "messages" : statuses.length ? "message_status" : "unknown", dedupeKey: digest, summary: { messages, statuses: statuses.slice(0, 20) } };
    }
    case "stripe": {
      // Stripe Connect event of the customer's own account (routed by `account`, own-account-webhooks.ts).
      const o = obj(obj(body.data).object);
      const type = s(body.type, 120) ?? "unknown";
      return {
        eventType: type,
        dedupeKey: s(body.id, 200) ?? digest,
        summary: { object: s(o.object, 60), id: s(o.id, 120), status: s(o.status, 60), amount: typeof o.amount_total === "number" ? o.amount_total : typeof o.amount === "number" ? o.amount : null, currency: s(o.currency, 10), livemode: body.livemode === true },
      };
    }
    case "razorpay": {
      // Razorpay partner webhook of the customer's own account (routed by account_id).
      const payload = obj(body.payload);
      const entity = obj(obj(payload.payment).entity ?? obj(payload.payment_link).entity ?? obj(payload.order).entity);
      const type = s(body.event, 120) ?? "unknown";
      return {
        eventType: type,
        dedupeKey: `${type}:${s(entity.id, 120) ?? digest}:${s(body.created_at) ?? ""}`,
        summary: { id: s(entity.id, 120), status: s(entity.status, 60), amount: typeof entity.amount === "number" ? entity.amount : null, currency: s(entity.currency, 10), accountId: s(body.account_id, 60) },
      };
    }
    case "luma":
      return { eventType: `generation.${s(body.state) ?? "unknown"}`, dedupeKey: `${s(body.id) ?? digest}:${s(body.state) ?? ""}`, summary: { generationId: s(body.id), state: s(body.state), failure: s(body.failure_reason) } };
    case "kling": {
      return { eventType: `task.${s(body.task_status) ?? "unknown"}`, dedupeKey: `${s(body.task_id) ?? digest}:${s(body.task_status) ?? ""}`, summary: { taskId: s(body.task_id), status: s(body.task_status), message: s(body.task_status_msg) } };
    }
    case "shotstack":
      return { eventType: `render.${s(body.status) ?? "unknown"}`, dedupeKey: `${s(body.id) ?? digest}:${s(body.status) ?? ""}`, summary: { renderId: s(body.id), status: s(body.status), url: s(body.url, 500), error: s(body.error) } };
    case "creatomate":
      return { eventType: `render.${s(body.status) ?? "unknown"}`, dedupeKey: `${s(body.id) ?? digest}:${s(body.status) ?? ""}`, summary: { renderId: s(body.id), status: s(body.status), url: s(body.url, 500), durationSeconds: typeof body.duration === "number" ? body.duration : null, error: s(body.error_message) } };
    case "deepgram": {
      const meta = obj(body.metadata);
      return { eventType: "transcription.callback", dedupeKey: s(meta.request_id) ?? digest, summary: { requestId: s(meta.request_id), durationSeconds: typeof meta.duration === "number" ? meta.duration : null } };
    }
    case "elevenlabs": {
      const data = obj(body.data);
      return { eventType: s(body.type) ?? "unknown", dedupeKey: `${s(body.type) ?? ""}:${s(data.request_id) ?? s(data.conversation_id) ?? digest}`, summary: { requestId: s(data.request_id), conversationId: s(data.conversation_id) } };
    }
    case "zendesk": {
      const detail = obj(body.detail);
      return { eventType: s(body.type, 120) ?? "unknown", dedupeKey: s(body.id) ?? digest, summary: { ticketId: s(detail.id), status: s(detail.status), subject: s(detail.subject, 200) } };
    }
    case "intercom": {
      const item = obj(obj(body.data).item);
      return { eventType: s(body.topic, 120) ?? "unknown", dedupeKey: s(body.id) ?? digest, summary: { conversationId: s(item.id), state: s(item.state) } };
    }
    default:
      return { eventType: "unknown", dedupeKey: digest, summary: {} };
  }
}

async function handle(row: ProviderEventRow, body: Record<string, unknown>, raw: string): Promise<{ duplicate: boolean }> {
  const p = parse(row.provider, body, raw);
  const existing = await db().integrationProviderEvent.findUnique({ where: { connectionId_dedupeKey: { connectionId: row.id, dedupeKey: p.dedupeKey.slice(0, 300) } }, select: { id: true, status: true } });
  if (existing && existing.status !== "failed") return { duplicate: true };
  let status = "stored";
  let resultRef: string | null = null;
  let error: string | null = null;
  try {
    const r = await apply(row, p, body);
    status = r.status;
    resultRef = r.resultRef ?? null;
  } catch (err) {
    status = "failed";
    error = (err instanceof Error ? err.message : "processing failed").slice(0, 300);
  }
  const data = {
    organizationId: row.organizationId,
    companyId: row.companyId,
    connectionId: row.id,
    provider: row.provider,
    eventType: p.eventType.slice(0, 120),
    dedupeKey: p.dedupeKey.slice(0, 300),
    status,
    summary: p.summary as Prisma.InputJsonValue,
    resultRef,
    error,
    processedAt: status === "stored" ? null : new Date(),
  };
  if (existing) await db().integrationProviderEvent.update({ where: { id: existing.id }, data });
  else {
    try {
      await db().integrationProviderEvent.create({ data });
    } catch (err) {
      // A concurrent retry stored it first.
      if ((err as { code?: string }).code === "P2002") return { duplicate: true };
      throw err;
    }
  }
  if (status === "failed") throw new Error(error ?? "processing failed");
  return { duplicate: false };
}

async function apply(row: ProviderEventRow, p: Parsed, body: Record<string, unknown>): Promise<{ status: string; resultRef?: string | null }> {
  switch (row.provider) {
    case "calendly":
      if (p.eventType === "invitee.created" || p.eventType === "invitee.canceled") return applyCalendlyInvitee(row, p.eventType, obj(body.payload));
      return { status: "ignored" };
    case "plaid": {
      if (p.eventType.startsWith("TRANSACTIONS:")) {
        // Pull the update with the regular sync (runDueSyncs picks it up within a minute; dedupe makes re-reads harmless).
        await db().integrationConnection.updateMany({ where: { id: row.id, syncEnabled: true }, data: { nextSyncAt: new Date() } });
        return { status: "processed", resultRef: `integration_connection:${row.id}` };
      }
      if (p.eventType === "ITEM:ERROR" || p.eventType === "ITEM:PENDING_EXPIRATION" || p.eventType === "ITEM:USER_PERMISSION_REVOKED") {
        await markConnectionError(row.id, `Plaid reported ${p.eventType} for a linked bank${p.summary.error ? ` (${String(p.summary.error)})` : ""}; relink the bank on the Plaid page`);
        return { status: "processed" };
      }
      return { status: "stored" };
    }
    case "stripe":
    case "razorpay": {
      // Payments on the customer's own account: pull them with the regular sync (stripe.payments) right away.
      if (/^(checkout\.session\.completed|payment_intent\.succeeded|charge\.(succeeded|refunded)|invoice\.paid|payment_link\.paid|payment\.captured|refund\.processed)$/.test(p.eventType)) {
        await db().integrationConnection.updateMany({ where: { id: row.id, syncEnabled: true }, data: { nextSyncAt: new Date() } });
        return { status: "processed", resultRef: `integration_connection:${row.id}` };
      }
      return { status: "stored" };
    }
    case "twilio":
    case "twilio_voice": {
      if (p.eventType === "call.completed" && typeof p.summary.durationSeconds === "number" && p.summary.durationSeconds > 0) {
        const secs = p.summary.durationSeconds;
        await recordUsage({ organizationId: row.organizationId, companyId: row.companyId, connectionId: row.id, provider: row.provider, operation: "voice.call", units: secs, unit: "second", estimatedCostMicros: FLAT_COST_MICROS["twilio.voice_second"]! * secs, status: "SUCCEEDED", meta: { callSid: p.summary.callSid } });
        return { status: "processed" };
      }
      return { status: "stored" };
    }
    default:
      return { status: "stored" };
  }
}

/** Apply one Calendly invitee (webhook or the calendly.events sync) to CRM meetings. */
export function upsertCalendlyInvitee(row: ProviderEventRow, type: "invitee.created" | "invitee.canceled", payload: Record<string, unknown>) {
  return applyCalendlyInvitee(row, type, payload);
}

/** Calendly invitee.created → a SCHEDULED CRM meeting (linked to the contact with that email); invitee.canceled → CANCELLED. */
async function applyCalendlyInvitee(row: ProviderEventRow, type: string, payload: Record<string, unknown>): Promise<{ status: string; resultRef?: string | null }> {
  const inviteeUri = s(payload.uri, 300);
  const ev = obj(payload.scheduled_event);
  if (!inviteeUri) return { status: "ignored" };
  const ctx: RequestContext = systemContext();
  return transaction(async (tx) => {
    const existing = await tx.crmMeeting.findFirst({ where: { organizationId: row.organizationId, companyId: row.companyId, calendarProvider: "calendly", externalId: inviteeUri }, select: { id: true, status: true } });
    if (type === "invitee.canceled") {
      if (!existing) return { status: "ignored" };
      if (existing.status !== "CANCELLED") {
        const reason = s(obj(payload.cancellation).reason, 500);
        await tx.crmMeeting.update({ where: { id: existing.id }, data: { status: "CANCELLED", outcome: reason ? `Cancelled in Calendly: ${reason}` : "Cancelled in Calendly" } });
        await writeAudit(tx, ctx, { category: "TENANT", organizationId: row.organizationId, action: "crm.meeting_cancelled", resourceType: "crm_meeting", resourceId: existing.id, newValue: { source: "calendly" } });
      }
      return { status: "processed", resultRef: `crm_meeting:${existing.id}` };
    }
    if (existing) return { status: "processed", resultRef: `crm_meeting:${existing.id}` };
    const startsAt = new Date(s(ev.start_time) ?? "");
    const endsAt = new Date(s(ev.end_time) ?? "");
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new Error("Calendly event has no valid start/end time");
    const email = s(payload.email, 254)?.toLowerCase() ?? null;
    const contact = email ? await tx.contact.findFirst({ where: { organizationId: row.organizationId, companyId: row.companyId, emailNormalized: email, archivedAt: null }, select: { id: true, accountId: true } }) : null;
    const location = obj(ev.location);
    const answers = (Array.isArray(payload.questions_and_answers) ? payload.questions_and_answers : [])
      .map((qa) => obj(qa))
      .map((qa) => `${s(qa.question, 200) ?? ""}: ${s(qa.answer, 500) ?? ""}`)
      .slice(0, 10)
      .join("\n");
    const meeting = await tx.crmMeeting.create({
      data: {
        organizationId: row.organizationId,
        companyId: row.companyId,
        title: (s(ev.name, 200) ?? "Calendly meeting") + (s(payload.name, 120) ? ` · ${s(payload.name, 120)}` : ""),
        agenda: answers || null,
        location: s(location.join_url, 500) ?? s(location.location, 500) ?? null,
        startsAt,
        endsAt,
        contactId: contact?.id ?? null,
        accountId: contact?.accountId ?? null,
        attendeeEmail: email,
        attendeeName: s(payload.name, 200),
        status: "SCHEDULED",
        calendarProvider: "calendly",
        externalId: inviteeUri,
        // Calendly already sent the invitation to the invitee.
        inviteSentAt: new Date(),
        organizerId: row.connectedById,
      },
      select: { id: true },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: row.organizationId, action: "crm.meeting_scheduled", resourceType: "crm_meeting", resourceId: meeting.id, newValue: { source: "calendly", startsAt: startsAt.toISOString(), contactId: contact?.id ?? null } });
    return { status: "processed", resultRef: `crm_meeting:${meeting.id}` };
  });
}

/**
 * Store (deduplicated) and apply one event that arrived on a platform-level webhook (Stripe Connect, Razorpay Partner,
 * WhatsApp app) and was routed to this connection by the account id it names (own-account-webhooks.ts). The caller has
 * verified the signature with the platform's signing secret.
 */
export async function receiveRoutedProviderEvent(row: ProviderEventRow, body: Record<string, unknown>, raw: string): Promise<{ duplicate: boolean }> {
  return handle(row, body, raw);
}

// ───────────────────────────── Read (connection page) ─────────────────────────────

/** A connection's received provider events, newest first (summaries only). Caller authorizes integrations.read. */
export async function listProviderEventsFor(organizationId: string, companyId: string, provider: string, cursor?: string) {
  const conn = await db().integrationConnection.findFirst({ where: { organizationId, companyId, provider }, select: { id: true } });
  const page = pageInput.parse({ limit: 50, cursor: cursor && isUuid(cursor) ? cursor : undefined });
  if (!conn) return toPage([] as Prisma.IntegrationProviderEventGetPayload<object>[], page);
  const rows = await db().integrationProviderEvent.findMany({ where: { connectionId: conn.id, companyId }, orderBy: { id: "desc" }, ...prismaPage(page) });
  return toPage(rows, page);
}
