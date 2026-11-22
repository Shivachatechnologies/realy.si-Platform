import { z } from "zod";
import { db, Prisma, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { sha256 } from "@/server/core/crypto";
import { notFound } from "@/server/core/errors";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import type { ProcessApp } from "@/server/core/observability";
import { writeAudit } from "@/server/modules/audit/service";
import { canPlatform, reasonSchema, requireAnyPlatform } from "./access";
import { currentReleaseLabel } from "./releases";

/**
 * Error grouping (stream E). Fed by the core/http.ts `onError` hook (API 5xx), instrumentation `onRequestError`
 * (pages, server actions) and the worker job-failure hook. Each error gets a fingerprint (source + name + top in-app
 * stack frame + route; the normalized message when there is no frame), its text is scrubbed (emails, tokens, keys,
 * long numbers) and the stack is truncated. Writes are throttled per process so an error storm never floods the
 * database: at most one event row per fingerprint every THROTTLE_MS (repeats only bump the group's count) and at most
 * MAX_EVENTS_PER_MIN event rows per minute.
 */

export const ERRORS_READ = ["platform.logs.read", "platform.incidents.read"];
export const ERRORS_MANAGE = ["platform.incidents.manage", "platform.alerts.manage"];
/** Stack traces and per-request metadata are shown only to holders of this permission. */
export const STACK_PERM = "platform.logs.read";

export const ERROR_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "IGNORED", "REGRESSED"] as const;

const THROTTLE_MS = 10_000;
const MAX_EVENTS_PER_MIN = 120;
const MAX_STACK = 4_000;
const MAX_STACK_LINES = 30;

// ───────────── Scrubbing ─────────────

const SCRUBBERS: [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b(?:(?:rly|sk|pk|rk|re|whsec)_[A-Za-z0-9_]{12,}|(?:xox[abpr]|ghp|gho)[_-][A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,})/g, "[key]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b(password|passwd|secret|token|api[_-]?key|authorization|cookie|signature)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1$2[redacted]"],
  [/([?&](?:code|state|token|key|sig|signature|access_token)=)[^&\s]+/gi, "$1[redacted]"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[jwt]"],
  [/\b\d{13,19}\b/g, "[number]"],
  [/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgresql://[redacted]"],
  [/rediss?:\/\/[^\s'"]+/gi, "redis://[redacted]"],
];

/** Remove secrets and personal data from free text (messages, stacks, log lines). */
export function scrubText(text: string, max = 2_000): string {
  let out = text;
  for (const [re, rep] of SCRUBBERS) out = out.replace(re, rep);
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/** Message shape for fingerprints: ids, numbers, quoted values and hex blobs become placeholders. */
export function normalizeMessage(message: string): string {
  return scrubText(message, 300)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "<str>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

/** First in-app stack frame as "function (file)" without line/column, so fingerprints survive unrelated edits. */
export function topFrame(stack: string | undefined): string | null {
  if (!stack) return null;
  for (const line of stack.split("\n").slice(1)) {
    const l = line.trim();
    if (!l.startsWith("at ") || /node_modules|node:internal|\(native\)|<anonymous>/.test(l)) continue;
    const m = /^at (?:async )?(?:(.+?) \()?(.+?)(?::\d+)?(?::\d+)?\)?$/.exec(l);
    if (!m) continue;
    const file = (m[2] ?? "").replace(/^file:\/\//, "").replace(/\?.*$/, "");
    const short = file.split(/[\\/]/).slice(-2).join("/").replace(/\[[^\]]*\]/g, "[…]");
    return `${m[1] ?? "<anonymous>"} (${short})`;
  }
  return null;
}

function scrubStack(stack: string | undefined): string | null {
  if (!stack) return null;
  const lines = stack.split("\n").slice(0, MAX_STACK_LINES).map((l) => l.replace(/\(\/[^)]*?\/((?:apps|packages|src)\/)/g, "($1"));
  return scrubText(lines.join("\n"), MAX_STACK);
}

export interface CapturedError {
  source: ProcessApp;
  error: unknown;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  requestId?: string | null;
  organizationId?: string | null;
  /** Secret-free primitives (job queue/name, kind, actor type). */
  meta?: Record<string, string | number | boolean | null>;
}

export interface ErrorFingerprint {
  fingerprint: string;
  name: string;
  message: string;
  frame: string | null;
}

export function fingerprintError(source: string, error: unknown, route?: string | null): ErrorFingerprint {
  const err = error instanceof Error ? error : null;
  const name = (err?.name || (typeof error === "object" && error && "name" in error ? String((error as { name: unknown }).name) : "") || "Error").slice(0, 120);
  const raw = err?.message ?? (typeof error === "string" ? error : (() => { try { return JSON.stringify(error); } catch { return String(error); } })());
  const message = scrubText(raw ?? "", 500);
  const frame = topFrame(err?.stack);
  const fingerprint = sha256([source, name, frame ?? normalizeMessage(message), route ?? ""].join("|")).slice(0, 40);
  return { fingerprint, name, message, frame };
}

// ───────────── Capture (hooks) ─────────────

interface Pending {
  lastWriteAt: number;
  pending: number;
  timer: NodeJS.Timeout | null;
}

const store = globalThis as unknown as { realyErrorThrottle?: Map<string, Pending>; realyErrorWindow?: { start: number; n: number } };
const throttle = () => (store.realyErrorThrottle ??= new Map());

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function windowAllows(now: number): boolean {
  const w = (store.realyErrorWindow ??= { start: now, n: 0 });
  if (now - w.start > 60_000) {
    w.start = now;
    w.n = 0;
  }
  if (w.n >= MAX_EVENTS_PER_MIN) return false;
  w.n++;
  return true;
}

async function bumpGroup(fp: ErrorFingerprint, source: string, route: string | null, n: number, release: string | null): Promise<string | null> {
  const rows = await db().$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO error_groups (id, fingerprint, source, name, message, route, status, count, first_seen_at, last_seen_at, first_release, last_release, created_at, updated_at)
    VALUES (gen_random_uuid(), ${fp.fingerprint}, ${source}, ${fp.name}, ${fp.message}, ${route}, 'OPEN', ${n}, now(), now(), ${release}, ${release}, now(), now())
    ON CONFLICT (fingerprint) DO UPDATE SET
      count = error_groups.count + ${n},
      last_seen_at = now(),
      message = EXCLUDED.message,
      last_release = COALESCE(EXCLUDED.last_release, error_groups.last_release),
      status = CASE WHEN error_groups.status = 'RESOLVED' THEN 'REGRESSED'::"ErrorGroupStatus" ELSE error_groups.status END,
      updated_at = now()
    RETURNING id`);
  return rows[0]?.id ?? null;
}

/**
 * Record one occurrence. Never throws (capture must not become a second failure). Returns the group id when a row was
 * written, null when throttled or the database is unavailable.
 */
export async function recordError(e: CapturedError): Promise<string | null> {
  try {
    const route = e.route ? e.route.slice(0, 200) : null;
    const fp = fingerprintError(e.source, e.error, route);
    const now = Date.now();
    const map = throttle();
    const t = map.get(fp.fingerprint) ?? { lastWriteAt: 0, pending: 0, timer: null };
    map.set(fp.fingerprint, t);
    const release = currentReleaseLabel(e.source);
    if (now - t.lastWriteAt < THROTTLE_MS || !windowAllows(now)) {
      // Repeat within the throttle window: count it, flush the count later without an event row.
      t.pending++;
      if (!t.timer) {
        t.timer = setTimeout(() => {
          const n = t.pending;
          t.pending = 0;
          t.timer = null;
          if (n > 0) void bumpGroup(fp, e.source, route, n, release).catch(() => undefined);
        }, THROTTLE_MS);
        t.timer.unref?.();
      }
      return null;
    }
    const n = 1 + t.pending;
    t.pending = 0;
    t.lastWriteAt = now;
    if (map.size > 2_000) map.clear(); // bounded memory under fingerprint churn
    const groupId = await bumpGroup(fp, e.source, route, n, release);
    if (!groupId) return null;
    const err = e.error instanceof Error ? e.error : null;
    const cause = err && "cause" in err && err.cause instanceof Error ? `\nCaused by: ${err.cause.name}: ${err.cause.message}` : "";
    await db().errorEvent.create({
      data: {
        groupId,
        requestId: e.requestId?.slice(0, 100) ?? null,
        organizationId: e.organizationId && uuidRe.test(e.organizationId) ? e.organizationId : null,
        release,
        route,
        method: e.method?.slice(0, 10) ?? null,
        statusCode: e.statusCode ?? null,
        stack: scrubStack(err?.stack ? err.stack + cause : undefined),
        meta: { ...(e.meta ?? {}), frame: fp.frame, ...(n > 1 ? { coalesced: n } : {}) },
      },
    });
    return groupId;
  } catch {
    return null;
  }
}

/** Test seam: forget throttle state. */
export function resetErrorThrottleForTests() {
  for (const t of throttle().values()) if (t.timer) clearTimeout(t.timer);
  throttle().clear();
  store.realyErrorWindow = undefined;
}

// ───────────── Admin: list, detail, triage ─────────────

export const errorGroupFilters = pageInput.extend({
  status: z.enum(ERROR_STATUSES).optional(),
  source: z.enum(["user", "admin", "worker"]).optional(),
  q: z.string().trim().max(200).optional(),
  assignee: z.string().uuid().optional(),
  since: z.enum(["1h", "24h", "7d", "30d"]).optional(),
});

const SINCE_MS = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as const;

export async function listErrorGroups(ctx: RequestContext, raw: z.input<typeof errorGroupFilters> = {}) {
  await requireAnyPlatform(ctx, ERRORS_READ);
  const f = errorGroupFilters.parse(raw);
  const where: Prisma.ErrorGroupWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.assignee ? { assigneeId: f.assignee } : {}),
    ...(f.since ? { lastSeenAt: { gte: new Date(Date.now() - SINCE_MS[f.since]) } } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { message: { contains: f.q, mode: "insensitive" } }, { route: { contains: f.q, mode: "insensitive" } }, ...(uuidRe.test(f.q) ? [{ id: f.q }] : [])] } : {}),
  };
  const [rows, byStatus, last24h] = await Promise.all([
    db().errorGroup.findMany({ where, orderBy: { id: "desc" }, ...prismaPage(f), select: { id: true, fingerprint: true, source: true, name: true, message: true, route: true, status: true, count: true, assigneeId: true, incidentId: true, firstSeenAt: true, lastSeenAt: true, lastRelease: true } }),
    db().errorGroup.groupBy({ by: ["status"], _count: { _all: true } }),
    db().errorEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);
  const page = toPage(rows, f);
  const recent = page.data.length
    ? await db().$queryRaw<{ group_id: string; n: bigint }[]>(Prisma.sql`
        SELECT group_id, COUNT(*)::bigint AS n FROM error_events
        WHERE group_id IN (${Prisma.join(page.data.map((r) => r.id))}) AND created_at >= now() - interval '24 hours'
        GROUP BY group_id`)
    : [];
  const recentOf = new Map(recent.map((r) => [r.group_id, Number(r.n)]));
  return {
    ...page,
    data: page.data.map((g) => ({ ...g, events24h: recentOf.get(g.id) ?? 0 })),
    counts: Object.fromEntries(ERROR_STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0])) as Record<(typeof ERROR_STATUSES)[number], number>,
    events24h: last24h,
  };
}

/** Hourly event counts of one group over the last 24 h (for its sparkline). */
async function hourly(groupId: string): Promise<number[]> {
  const rows = await db().$queryRaw<{ h: number; n: bigint }[]>(Prisma.sql`
    SELECT FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 3600)::int AS h, COUNT(*)::bigint AS n
    FROM error_events WHERE group_id = ${groupId}::uuid AND created_at >= now() - interval '24 hours' GROUP BY 1`);
  const out = Array.from({ length: 24 }, () => 0);
  for (const r of rows) if (r.h >= 0 && r.h < 24) out[23 - r.h] = Number(r.n);
  return out;
}

export async function getErrorGroup(ctx: RequestContext, id: string, opts: { eventsCursor?: string } = {}) {
  await requireAnyPlatform(ctx, ERRORS_READ);
  if (!uuidRe.test(id)) throw notFound("Error group");
  const group = await db().errorGroup.findUnique({ where: { id } });
  if (!group) throw notFound("Error group");
  const canStack = await canPlatform(ctx, STACK_PERM);
  const cursor = opts.eventsCursor && uuidRe.test(opts.eventsCursor) ? opts.eventsCursor : undefined;
  const [events, releases, routes, spark, incident, userRows] = await Promise.all([
    db().errorEvent.findMany({ where: { groupId: id }, orderBy: { id: "desc" }, take: 26, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
    db().errorEvent.groupBy({ by: ["release"], where: { groupId: id }, _count: { _all: true }, orderBy: { _count: { release: "desc" } }, take: 10 }),
    db().errorEvent.groupBy({ by: ["route", "method"], where: { groupId: id }, _count: { _all: true }, orderBy: { _count: { route: "desc" } }, take: 10 }),
    hourly(id),
    group.incidentId ? db().platformIncident.findUnique({ where: { id: group.incidentId }, select: { id: true, number: true, title: true, status: true, severity: true } }) : null,
    group.assigneeId ? db().user.findMany({ where: { id: group.assigneeId }, select: { id: true, name: true, email: true } }) : [],
  ]);
  const page = events.slice(0, 25);
  const requestIds = [...new Set(page.map((e) => e.requestId).filter((r): r is string => !!r))];
  const [logs, audits] = canStack && requestIds.length
    ? await Promise.all([
        db().appLogEntry.findMany({ where: { requestId: { in: requestIds } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, level: true, source: true, message: true, requestId: true, createdAt: true } }),
        db().auditLog.findMany({ where: { requestId: { in: requestIds } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, action: true, resourceType: true, requestId: true, createdAt: true } }),
      ])
    : [[], []];
  return {
    group: { ...group, notes: Array.isArray(group.notes) ? (group.notes as { at: string; authorId: string | null; text: string }[]) : [] },
    assignee: userRows[0] ?? null,
    canStack,
    events: page.map((e) => ({ ...e, stack: canStack ? e.stack : null, requestId: canStack ? e.requestId : null, organizationId: canStack ? e.organizationId : null })),
    eventsNextCursor: events.length > 25 ? page[page.length - 1]!.id : null,
    releases: releases.map((r) => ({ release: r.release, count: r._count._all })),
    routes: routes.map((r) => ({ route: r.route, method: r.method, count: r._count._all })),
    hourly: spark,
    incident,
    relatedLogs: logs,
    relatedAudit: audits,
  };
}

export const errorGroupUpdateInput = z
  .object({
    status: z.enum(ERROR_STATUSES).optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    note: z.string().trim().min(1).max(2_000).optional(),
    incidentId: z.string().uuid().nullable().optional(),
    reason: reasonSchema,
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined || v.note !== undefined || v.incidentId !== undefined, { message: "Nothing to change" });

/** Triage: status (resolve / ignore / acknowledge / reopen), assignee, notes, incident link. Audited. */
export async function updateErrorGroup(ctx: RequestContext, id: string, raw: z.input<typeof errorGroupUpdateInput>) {
  const input = errorGroupUpdateInput.parse(raw);
  if (!uuidRe.test(id)) throw notFound("Error group");
  return transaction(async (tx) => {
    await requireAnyPlatform(ctx, ERRORS_MANAGE);
    const g = await tx.errorGroup.findUnique({ where: { id } });
    if (!g) throw notFound("Error group");
    if (input.assigneeId) {
      const u = await tx.user.findUnique({ where: { id: input.assigneeId }, select: { id: true, status: true } });
      if (!u || u.status !== "ACTIVE") throw notFound("Assignee");
    }
    if (input.incidentId) {
      const i = await tx.platformIncident.findUnique({ where: { id: input.incidentId }, select: { id: true } });
      if (!i) throw notFound("Incident");
    }
    const notes = Array.isArray(g.notes) ? (g.notes as Prisma.JsonArray) : [];
    const data: Prisma.ErrorGroupUpdateInput = {
      ...(input.status ? { status: input.status, resolvedAt: input.status === "RESOLVED" ? new Date() : input.status === "OPEN" || input.status === "REGRESSED" ? null : g.resolvedAt } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
      ...(input.note ? { notes: [...notes, { at: new Date().toISOString(), authorId: ctx.actor.id, text: scrubText(input.note) }].slice(-50) as Prisma.InputJsonValue } : {}),
    };
    const updated = await tx.errorGroup.update({ where: { id }, data });
    await writeAudit(tx, ctx, {
      category: "ADMIN",
      action: "platform.error_group.updated",
      resourceType: "error_group",
      resourceId: id,
      oldValue: { status: g.status, assigneeId: g.assigneeId, incidentId: g.incidentId },
      newValue: { status: updated.status, assigneeId: updated.assigneeId, incidentId: updated.incidentId, note: input.note ? true : undefined },
      reason: input.reason,
    });
    return { id, status: updated.status };
  });
}
