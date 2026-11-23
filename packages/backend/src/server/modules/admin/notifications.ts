import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { logger } from "@/server/core/logger";
import { PERMISSION_KEYS, PLATFORM_ONLY } from "@/server/modules/rbac/catalog";
import { isUuid } from "./access";
import { consoleHref, consolePermissions, getPreferences, requireConsoleUser, SEVERITIES, type NotificationPrefs } from "./preferences";

/**
 * Admin notifications (stream A): rows in `platform_notifications`, delivered to one admin (`userId`) or to every
 * holder of a platform permission (`permission`, resolved when the admin reads, so new role holders see them too).
 * Read state lives in `admin_notification_reads` (one row per admin). A repeated `dedupeKey` bumps the existing
 * notification (occurrences + 1, raised again, unread again) instead of adding a row.
 */
export interface AdminNotificationInput {
  /** Deliver to every holder of this platform permission (e.g. "platform.incidents.read"). */
  permission?: string;
  /** Or to one admin. */
  userId?: string;
  /** "alert.raised", "support.ticket_created", "job.dead_letter", … */
  type: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body?: string;
  /** Locale-relative console link, e.g. "/alerts/<id>". */
  href?: string;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
}

/** Notifications older than this are not shown. */
export const NOTIFICATION_WINDOW_DAYS = 90;
const SEVERITY_RANK = { INFO: 0, WARNING: 1, CRITICAL: 2 } as const;

const inputSchema = z
  .object({
    permission: z
      .string()
      .refine((p) => PERMISSION_KEYS.has(p) && PLATFORM_ONLY.has(p), "Must be a platform permission")
      .optional(),
    userId: z.string().uuid().optional(),
    type: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_.-]+$/i),
    severity: z.enum(SEVERITIES).default("INFO"),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(2000).optional(),
    href: consoleHref.optional(),
    dedupeKey: z.string().trim().min(1).max(200).optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((v) => !!v.permission !== !!v.userId, "Give exactly one of permission or userId");

/**
 * Raise an admin notification (producer API for every stream). Invalid input throws (a programming error); a
 * database failure is logged and swallowed so a notification never breaks the flow that raised it.
 * `ctx` is accepted for future auditing and is not required (workers pass null). Never put secrets or personal
 * data beyond what an admin of that permission may see into title, body or payload.
 */
export async function notifyAdmins(_ctx: RequestContext | null, raw: AdminNotificationInput): Promise<void> {
  const input = inputSchema.parse(raw);
  const payload = JSON.parse(JSON.stringify(input.payload ?? {})) as Prisma.InputJsonValue;
  const data = {
    userId: input.userId ?? null,
    permission: input.permission ?? null,
    type: input.type,
    severity: input.severity,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
    payload,
  };
  try {
    if (!input.dedupeKey) {
      await db().platformNotification.create({ data });
      return;
    }
    const now = new Date();
    const row = await db().platformNotification.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: { ...data, dedupeKey: input.dedupeKey, lastRaisedAt: now },
      update: { ...data, occurrences: { increment: 1 }, lastRaisedAt: now },
      select: { id: true, occurrences: true },
    });
    // Raised again: unread again for everyone.
    if (row.occurrences > 1) await db().platformNotificationRead.deleteMany({ where: { notificationId: row.id } });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), type: input.type }, "notifyAdmins failed");
  }
}

const severitiesFrom = (min: NotificationPrefs["minSeverity"]) => SEVERITIES.filter((s) => SEVERITY_RANK[s] >= SEVERITY_RANK[min]);

/** Where-clause of the notifications this admin may see, after their preferences (severity floor, muted types). */
async function visibleWhere(ctx: RequestContext, opts: { ignorePrefs?: boolean } = {}) {
  const userId = await requireConsoleUser(ctx);
  const [perms, prefs] = await Promise.all([consolePermissions(ctx), getPreferences(ctx)]);
  const since = new Date(Date.now() - NOTIFICATION_WINDOW_DAYS * 86_400_000);
  const where: Prisma.PlatformNotificationWhereInput = {
    lastRaisedAt: { gte: since },
    OR: [{ userId }, { permission: { in: perms } }],
    ...(opts.ignorePrefs
      ? {}
      : {
          severity: { in: severitiesFrom(prefs.notificationPrefs.minSeverity) },
          ...(prefs.notificationPrefs.muted.length ? { type: { notIn: prefs.notificationPrefs.muted } } : {}),
        }),
  };
  return { userId, where, prefs };
}

export const listNotificationsInput = z.object({
  filter: z.enum(["all", "unread"]).catch("all"),
  severity: z.enum(SEVERITIES).optional().catch(undefined),
  type: z.string().trim().max(80).optional().catch(undefined),
  cursor: z.string().max(80).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
});

export interface NotificationRow {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string | null;
  href: string | null;
  occurrences: number;
  createdAt: string;
  lastRaisedAt: string;
  read: boolean;
  /** Delivered by permission (a role-wide notice) rather than to you personally. */
  roleWide: boolean;
}

const encodeCursor = (at: Date, id: string) => `${at.toISOString()}|${id}`;
function decodeCursor(c: string | undefined) {
  if (!c) return null;
  const [iso, id] = c.split("|");
  const at = new Date(iso ?? "");
  return id && isUuid(id) && !Number.isNaN(at.getTime()) ? { at, id } : null;
}

/** Newest first, keyset-paginated (lastRaisedAt, id), bounded to the notification window. */
export async function listNotifications(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  const f = listNotificationsInput.parse(raw);
  const { userId, where } = await visibleWhere(ctx);
  const cur = decodeCursor(f.cursor);
  const rows = await db().platformNotification.findMany({
    where: {
      AND: [
        where,
        ...(f.filter === "unread" ? [{ reads: { none: { userId } } }] : []),
        ...(f.severity ? [{ severity: f.severity }] : []),
        ...(f.type ? [{ type: f.type }] : []),
        ...(cur ? [{ OR: [{ lastRaisedAt: { lt: cur.at } }, { lastRaisedAt: cur.at, id: { lt: cur.id } }] }] : []),
      ],
    },
    orderBy: [{ lastRaisedAt: "desc" }, { id: "desc" }],
    take: f.limit + 1,
    select: { id: true, type: true, severity: true, title: true, body: true, href: true, occurrences: true, createdAt: true, lastRaisedAt: true, userId: true, reads: { where: { userId }, select: { readAt: true } } },
  });
  const page = rows.slice(0, f.limit);
  const last = page[page.length - 1];
  return {
    data: page.map(
      (r): NotificationRow => ({
        id: r.id,
        type: r.type,
        severity: r.severity,
        title: r.title,
        body: r.body,
        href: r.href,
        occurrences: r.occurrences,
        createdAt: r.createdAt.toISOString(),
        lastRaisedAt: r.lastRaisedAt.toISOString(),
        read: r.reads.length > 0,
        roleWide: r.userId === null,
      }),
    ),
    nextCursor: rows.length > f.limit && last ? encodeCursor(last.lastRaisedAt, last.id) : null,
  };
}

/** Unread count for the bell, capped at 100 (shown as "99+"). */
export async function unreadNotificationCount(ctx: RequestContext): Promise<number> {
  const { userId, where } = await visibleWhere(ctx);
  return db().platformNotification.count({ where: { AND: [where, { reads: { none: { userId } } }] }, take: 100 });
}

/** Notification types seen in the window (for the mute list on /me). */
export async function notificationTypes(ctx: RequestContext): Promise<string[]> {
  const { where } = await visibleWhere(ctx, { ignorePrefs: true });
  const rows = await db().platformNotification.groupBy({ by: ["type"], where, orderBy: { type: "asc" }, take: 100 });
  return rows.map((r) => r.type);
}

export const markInput = z.union([z.object({ ids: z.array(z.string().uuid()).min(1).max(100), read: z.boolean().default(true) }).strict(), z.object({ all: z.literal(true) }).strict()]);

/** Mark given notifications (that the admin can see) read or unread, or every visible unread one read (max 1,000). */
export async function markNotifications(ctx: RequestContext, raw: z.input<typeof markInput>) {
  const input = markInput.parse(raw);
  const { userId, where } = await visibleWhere(ctx, { ignorePrefs: true });
  if ("all" in input) {
    const ids = (await db().platformNotification.findMany({ where: { AND: [where, { reads: { none: { userId } } }] }, select: { id: true }, take: 1000 })).map((r) => r.id);
    if (ids.length) await db().platformNotificationRead.createMany({ data: ids.map((notificationId) => ({ notificationId, userId })), skipDuplicates: true });
    return { updated: ids.length };
  }
  const visible = (await db().platformNotification.findMany({ where: { AND: [where, { id: { in: input.ids } }] }, select: { id: true } })).map((r) => r.id);
  if (!visible.length) return { updated: 0 };
  if (input.read) await db().platformNotificationRead.createMany({ data: visible.map((notificationId) => ({ notificationId, userId })), skipDuplicates: true });
  else await db().platformNotificationRead.deleteMany({ where: { userId, notificationId: { in: visible } } });
  return { updated: visible.length };
}
