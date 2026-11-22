import "server-only";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { can, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { isUuid, type VoiceScope } from "./access";
import { eventRule, profileDepartment, type Department } from "./catalog";
import { VOICE_PROFILE } from "./intent";

/**
 * Realtime company event stream (Server-Sent Events). Each open connection polls the transactional outbox (events
 * table, cursor on occurred_at with a short look-back so rows committed slightly out of order are not missed) and the
 * state of agent tasks, command runs, approvals and phone calls, every ~1.5 s. Everything is tenant-scoped and
 * filtered by the viewer's read permissions per department. Payload snapshots are never forwarded: only the type,
 * the entity and a short title.
 */

const TICK_MS = 1_500;
const LOOKBACK_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const RECHECK_MS = 60_000;
/** Connections close after this long; EventSource reconnects with Last-Event-ID. */
export const STREAM_MAX_MS = 4.5 * 60_000; // under the 300 s function limit (Vercel Hobby); clients reconnect with Last-Event-ID
/** A reconnect never replays more than this. */
const MAX_REPLAY_MS = 10 * 60_000;
const BATCH = 100;

const STREAM_PERMISSIONS = [
  "agents.read",
  "approvals.read",
  "communication.read",
  "sales.read",
  "finance.read",
  "projects.read",
  "hr.read",
  "marketing.read",
  "support.read",
  "objectives.read",
  "integrations.read",
] as const;

export type StreamItem =
  | { kind: "domain"; key: string; id: string; type: string; department: Department; entityType: string; entityId: string; label: string | null; at: string }
  | { kind: "task"; key: string; id: string; title: string; profile: string; department: Department; status: string; at: string }
  | { kind: "run"; key: string; id: string; status: string; mine: boolean; text: string | null; at: string }
  | { kind: "approval"; key: string; id: string; status: string; tool: string; summary: string; risk: string; at: string }
  | { kind: "call"; key: string; id: string; status: string; direction: string; at: string };

interface StreamAccess {
  scope: VoiceScope;
  chain: ScopeChain;
  userId: string | null;
  perms: Set<string>;
}

export async function streamAccess(ctx: RequestContext, organizationId: string, companyId: string): Promise<StreamAccess> {
  if (!isUuid(organizationId) || !isUuid(companyId)) throw notFound("Company");
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "companies.read", chain);
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("The live stream is available to signed-in people only");
  const granted = await Promise.all(STREAM_PERMISSIONS.map(async (p) => [p, await can(ctx, p, chain)] as const));
  return { scope: { organizationId, companyId }, chain, userId: ctx.actor.id, perms: new Set(granted.filter(([, ok]) => ok).map(([p]) => p)) };
}

function labelOf(payload: unknown): string | null {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") return null;
  for (const k of ["title", "name", "subject", "number"]) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
  }
  return null;
}

/**
 * One poll: everything that happened after `sinceMs` (minus the look-back) the viewer may see, oldest first, without
 * items already in `seen`. Returns the new cursor.
 */
export async function pollCompany(access: StreamAccess, sinceMs: number, seen: Map<string, number>): Promise<{ items: StreamItem[]; next: number }> {
  const { scope, perms, userId } = access;
  const from = new Date(sinceMs - LOOKBACK_MS);
  const [events, tasks, runs, approvals, calls] = await Promise.all([
    db().event.findMany({
      where: { organizationId: scope.organizationId, companyId: scope.companyId, occurredAt: { gt: from } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: BATCH,
      select: { id: true, type: true, aggregateType: true, aggregateId: true, payload: true, occurredAt: true },
    }),
    perms.has("agents.read")
      ? db().agentTask.findMany({ where: { ...scope, updatedAt: { gt: from }, profile: { not: VOICE_PROFILE } }, orderBy: { updatedAt: "asc" }, take: 40, select: { id: true, title: true, profile: true, status: true, updatedAt: true } })
      : [],
    perms.has("agents.read")
      ? db().commandRun.findMany({ where: { ...scope, updatedAt: { gt: from } }, orderBy: { updatedAt: "asc" }, take: 20, select: { id: true, status: true, userId: true, text: true, updatedAt: true } })
      : [],
    perms.has("approvals.read")
      ? db().approval.findMany({ where: { ...scope, updatedAt: { gt: from } }, orderBy: { updatedAt: "asc" }, take: 20, select: { id: true, status: true, tool: true, summary: true, risk: true, updatedAt: true } })
      : [],
    perms.has("communication.read")
      ? db().voiceCall.findMany({ where: { ...scope, updatedAt: { gt: from } }, orderBy: { updatedAt: "asc" }, take: 20, select: { id: true, status: true, direction: true, updatedAt: true } })
      : [],
  ]);
  const items: StreamItem[] = [];
  let next = sinceMs;
  const push = (item: StreamItem, at: Date) => {
    next = Math.max(next, at.getTime());
    if (seen.has(item.key)) return;
    seen.set(item.key, at.getTime());
    items.push(item);
  };
  for (const e of events) {
    const rule = eventRule(e.type);
    if (!rule || !perms.has(rule.permission)) {
      next = Math.max(next, e.occurredAt.getTime());
      continue;
    }
    push({ kind: "domain", key: `e:${e.id}`, id: e.id, type: e.type, department: rule.department, entityType: e.aggregateType, entityId: e.aggregateId, label: labelOf(e.payload), at: e.occurredAt.toISOString() }, e.occurredAt);
  }
  for (const t of tasks) push({ kind: "task", key: `t:${t.id}:${t.status}`, id: t.id, title: t.title.slice(0, 120), profile: t.profile, department: profileDepartment(t.profile), status: t.status, at: t.updatedAt.toISOString() }, t.updatedAt);
  for (const r of runs) {
    const mine = r.userId === userId;
    push({ kind: "run", key: `r:${r.id}:${r.status}`, id: r.id, status: r.status, mine, text: mine ? r.text.slice(0, 160) : null, at: r.updatedAt.toISOString() }, r.updatedAt);
  }
  for (const a of approvals) push({ kind: "approval", key: `a:${a.id}:${a.status}`, id: a.id, status: a.status, tool: a.tool, summary: a.summary.slice(0, 200), risk: a.risk, at: a.updatedAt.toISOString() }, a.updatedAt);
  for (const c of calls) push({ kind: "call", key: `c:${c.id}:${c.status}`, id: c.id, status: c.status, direction: c.direction, at: c.updatedAt.toISOString() }, c.updatedAt);
  // A full batch means more rows wait: continue from the last one instead of skipping ahead.
  if (events.length === BATCH) next = Math.min(next, events[events.length - 1]!.occurredAt.getTime());
  // Forget keys older than the look-back window (bounded memory per connection).
  const floor = next - 2 * LOOKBACK_MS;
  for (const [k, at] of seen) if (at < floor) seen.delete(k);
  items.sort((a, b) => a.at.localeCompare(b.at));
  return { items, next };
}

/** The latest company events the viewer may see (initial feed of the Realy console), newest first. */
export async function recentCompanyEvents(ctx: RequestContext, organizationId: string, companyId: string, take = 30) {
  const access = await streamAccess(ctx, organizationId, companyId);
  const rows = await db().event.findMany({
    where: { organizationId, companyId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 200,
    select: { id: true, type: true, aggregateType: true, aggregateId: true, payload: true, occurredAt: true },
  });
  const out: Extract<StreamItem, { kind: "domain" }>[] = [];
  for (const e of rows) {
    const rule = eventRule(e.type);
    if (!rule || !access.perms.has(rule.permission)) continue;
    out.push({ kind: "domain", key: `e:${e.id}`, id: e.id, type: e.type, department: rule.department, entityType: e.aggregateType, entityId: e.aggregateId, label: labelOf(e.payload), at: e.occurredAt.toISOString() });
    if (out.length >= take) break;
  }
  return out;
}

export function parseCursor(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{10,16}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The SSE body for one connection. Starts from `cursor` (Last-Event-ID, clamped to the last 10 minutes) or now;
 * heartbeats every 15 s (carrying the cursor as the event id), re-checks access every minute and closes after
 * five minutes so the browser reconnects with a fresh session check.
 */
export function companyEventStream(ctx: RequestContext, access: StreamAccess, opts: { cursor: number | null; signal: AbortSignal }): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const now = Date.now();
  let since = opts.cursor ? Math.min(now, Math.max(now - MAX_REPLAY_MS, opts.cursor)) : now;
  const seen = new Map<string, number>();
  let closed = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      opts.signal.addEventListener("abort", close);
      send(`retry: 2000\nid: ${since}\nevent: hello\ndata: ${JSON.stringify({ t: since, departments: [...access.perms] })}\n\n`);
      const started = Date.now();
      let lastBeat = started;
      let lastCheck = started;
      let failures = 0;
      while (!closed) {
        await new Promise((r) => setTimeout(r, TICK_MS));
        if (closed) break;
        const at = Date.now();
        if (at - started > STREAM_MAX_MS) {
          send(`id: ${since}\nevent: bye\ndata: {}\n\n`);
          break;
        }
        try {
          if (at - lastCheck > RECHECK_MS) {
            lastCheck = at;
            if (!(await can(ctx, "companies.read", access.chain))) {
              send(`event: bye\ndata: {"reason":"forbidden"}\n\n`);
              break;
            }
          }
          const { items, next } = await pollCompany(access, since, seen);
          since = next;
          failures = 0;
          for (const item of items) send(`id: ${since}\nevent: ${item.kind}\ndata: ${JSON.stringify(item)}\n\n`);
          if (at - lastBeat > HEARTBEAT_MS) {
            lastBeat = at;
            send(`id: ${since}\nevent: cursor\ndata: ${JSON.stringify({ t: since })}\n\n`);
          }
        } catch (err) {
          failures++;
          logger.warn({ companyId: access.scope.companyId, err: err instanceof Error ? err.message : String(err) }, "event stream poll failed");
          if (failures >= 5) break;
        }
      }
      opts.signal.removeEventListener("abort", close);
      close();
    },
    cancel() {
      closed = true;
    },
  });
}
