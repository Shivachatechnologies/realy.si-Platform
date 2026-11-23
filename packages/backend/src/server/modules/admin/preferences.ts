import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { forbidden, invalid, notFound } from "@/server/core/errors";
import { isPlatformAdmin } from "@/server/core/platform-controls";
import { effectivePermissions } from "@/server/modules/rbac/service";
import { isPlatformScope, platformChain } from "@/server/modules/rbac/scope";
import { isUuid } from "./access";

/**
 * Console personalization (stream A): favorites, recents, recent searches, sidebar state, density (compact mode),
 * default time range, notification preferences and saved views. Every function acts on the CALLER's own row only;
 * the caller must hold a platform role (any platform permission). Nothing here is sensitive, so no audit rows.
 */

export const TIME_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];
export const DENSITIES = ["comfortable", "compact"] as const;
export const SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;

const MAX_FAVORITES = 30;
const MAX_RECENTS = 20;
const MAX_SEARCHES = 10;
const MAX_VIEWS_PER_PAGE = 50;

/** A locale-relative console path ("/users", "/ai/models?status=FAILED"). Never absolute or protocol-relative. */
export const consoleHref = z
  .string()
  .trim()
  .max(300)
  .regex(/^\/(?!\/)[^\s\\]*$/, "Must be a console path starting with /");

export type RecentItem = {
  href: string;
  label: string;
  at: string;
};

export interface SidebarState {
  collapsed: boolean;
  groups: Record<string, boolean>;
}

export interface NotificationPrefs {
  minSeverity: (typeof SEVERITIES)[number];
  muted: string[];
}

export interface AdminPreferences {
  favorites: string[];
  recents: RecentItem[];
  recentSearches: string[];
  sidebar: SidebarState;
  density: (typeof DENSITIES)[number];
  timeRange: TimeRange;
  notificationPrefs: NotificationPrefs;
}

export const DEFAULT_PREFERENCES: AdminPreferences = {
  favorites: [],
  recents: [],
  recentSearches: [],
  sidebar: { collapsed: false, groups: {} },
  density: "comfortable",
  timeRange: "30d",
  notificationPrefs: { minSeverity: "INFO", muted: [] },
};

const recentSchema = z.object({ href: consoleHref, label: z.string().trim().min(1).max(120), at: z.string().max(40) });
const sidebarSchema = z.object({ collapsed: z.boolean().catch(false), groups: z.record(z.string().max(40), z.boolean()).catch({}) });
const notificationPrefsSchema = z.object({
  minSeverity: z.enum(SEVERITIES).catch("INFO"),
  muted: z.array(z.string().trim().min(1).max(80)).max(50).catch([]),
});

/** Parse a stored row defensively: bad JSON falls back to defaults instead of breaking the shell. */
function fromRow(row: { favorites: string[]; recents: unknown; recentSearches: string[]; sidebar: unknown; density: string; timeRange: string; notificationPrefs: unknown } | null): AdminPreferences {
  if (!row) return structuredClone(DEFAULT_PREFERENCES);
  const recents = z.array(recentSchema).catch([]).parse(row.recents);
  const sidebar = sidebarSchema.catch(DEFAULT_PREFERENCES.sidebar).parse(row.sidebar ?? {});
  return {
    favorites: row.favorites.slice(0, MAX_FAVORITES),
    recents: recents.slice(0, MAX_RECENTS),
    recentSearches: row.recentSearches.slice(0, MAX_SEARCHES),
    sidebar,
    density: (DENSITIES as readonly string[]).includes(row.density) ? (row.density as AdminPreferences["density"]) : "comfortable",
    timeRange: (TIME_RANGES as readonly string[]).includes(row.timeRange) ? (row.timeRange as TimeRange) : "30d",
    notificationPrefs: notificationPrefsSchema.catch(DEFAULT_PREFERENCES.notificationPrefs).parse(row.notificationPrefs ?? {}),
  };
}

/**
 * The caller must be a platform admin (a PLATFORM, REGION or COUNTRY role, as the console gate requires); returns
 * their user id. Personal data only: this never authorizes reading anything beyond the caller's own rows.
 */
export async function requireConsoleUser(ctx: RequestContext): Promise<string> {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Platform administrators only");
  if (!(await isPlatformAdmin(ctx.actor.id))) throw forbidden("Platform administrators only");
  return ctx.actor.id;
}

/** Platform permissions the caller holds (UI hint for filtering; every action re-checks on the server). */
export async function consolePermissions(ctx: RequestContext): Promise<string[]> {
  if (ctx.actor.type !== "USER" || !ctx.actor.id) return [];
  return effectivePermissions(ctx, platformChain());
}

const SELECT = { favorites: true, recents: true, recentSearches: true, sidebar: true, density: true, timeRange: true, notificationPrefs: true } as const;

export async function getPreferences(ctx: RequestContext): Promise<AdminPreferences> {
  const userId = await requireConsoleUser(ctx);
  return fromRow(await db().adminPreference.findUnique({ where: { userId }, select: SELECT }));
}

/** Read without the role check (for the console layout, which has already checked the platform grants). */
export async function preferencesFor(userId: string): Promise<AdminPreferences> {
  return fromRow(await db().adminPreference.findUnique({ where: { userId }, select: SELECT }).catch(() => null));
}

async function write(userId: string, data: Prisma.AdminPreferenceUpdateInput) {
  const row = await db().adminPreference.upsert({ where: { userId }, create: { ...(data as Omit<Prisma.AdminPreferenceCreateInput, "userId">), userId }, update: data, select: SELECT });
  return fromRow(row);
}

export const preferencesInput = z
  .object({
    density: z.enum(DENSITIES),
    timeRange: z.enum(TIME_RANGES),
    sidebar: z.object({ collapsed: z.boolean().optional(), groups: z.record(z.string().max(40), z.boolean()).optional() }),
    notificationPrefs: z.object({ minSeverity: z.enum(SEVERITIES).optional(), muted: z.array(z.string().trim().min(1).max(80)).max(50).optional() }),
    favorites: z.array(consoleHref).max(MAX_FAVORITES),
  })
  .partial()
  .strict();

/** Patch the caller's preferences (only the given fields). `sidebar` and `notificationPrefs` merge into the stored value. */
export async function updatePreferences(ctx: RequestContext, raw: z.input<typeof preferencesInput>) {
  const userId = await requireConsoleUser(ctx);
  const input = preferencesInput.parse(raw);
  const cur = fromRow(await db().adminPreference.findUnique({ where: { userId }, select: SELECT }));
  const data: Prisma.AdminPreferenceUpdateInput = {};
  if (input.density) data.density = input.density;
  if (input.timeRange) data.timeRange = input.timeRange;
  if (input.favorites) data.favorites = [...new Set(input.favorites)];
  if (input.sidebar) {
    const groups = { ...cur.sidebar.groups, ...input.sidebar.groups };
    // Bounded: keep at most 60 group states.
    data.sidebar = { collapsed: input.sidebar.collapsed ?? cur.sidebar.collapsed, groups: Object.fromEntries(Object.entries(groups).slice(-60)) };
  }
  if (input.notificationPrefs) data.notificationPrefs = { ...cur.notificationPrefs, ...input.notificationPrefs };
  return write(userId, data);
}

export const favoriteInput = z.object({ href: consoleHref, on: z.boolean() }).strict();

/** Add or remove one favorite (newest first, at most 30). */
export async function setFavorite(ctx: RequestContext, raw: z.input<typeof favoriteInput>) {
  const userId = await requireConsoleUser(ctx);
  const { href, on } = favoriteInput.parse(raw);
  const cur = fromRow(await db().adminPreference.findUnique({ where: { userId }, select: SELECT }));
  const rest = cur.favorites.filter((f) => f !== href);
  if (on && rest.length >= MAX_FAVORITES) throw invalid(`At most ${MAX_FAVORITES} favorites`, { reason: "too_many_favorites" });
  return write(userId, { favorites: on ? [href, ...rest] : rest });
}

export const recentInput = z.object({ href: consoleHref, label: z.string().trim().min(1).max(120) }).strict();

/** Remember a visited page (deduplicated by path, newest first, at most 20). */
export async function pushRecent(ctx: RequestContext, raw: z.input<typeof recentInput>) {
  const userId = await requireConsoleUser(ctx);
  const { href, label } = recentInput.parse(raw);
  const cur = fromRow(await db().adminPreference.findUnique({ where: { userId }, select: SELECT }));
  if (cur.recents[0]?.href === href) return cur; // already the newest: no write
  const recents = [{ href, label, at: new Date().toISOString() }, ...cur.recents.filter((r) => r.href !== href)].slice(0, MAX_RECENTS);
  return write(userId, { recents: recents as unknown as Prisma.InputJsonValue });
}

export const recentSearchInput = z.object({ q: z.string().trim().min(2).max(200) }).strict();

/** Remember a palette query (deduplicated case-insensitively, at most 10). */
export async function pushRecentSearch(ctx: RequestContext, raw: z.input<typeof recentSearchInput>) {
  const userId = await requireConsoleUser(ctx);
  const { q } = recentSearchInput.parse(raw);
  const cur = fromRow(await db().adminPreference.findUnique({ where: { userId }, select: SELECT }));
  if (cur.recentSearches[0]?.toLowerCase() === q.toLowerCase()) return cur;
  const recentSearches = [q, ...cur.recentSearches.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX_SEARCHES);
  return write(userId, { recentSearches });
}

/** Forget recents and/or recent searches. */
export async function clearHistory(ctx: RequestContext, what: { recents?: boolean; searches?: boolean }) {
  const userId = await requireConsoleUser(ctx);
  return write(userId, { ...(what.recents ? { recents: [] } : {}), ...(what.searches ? { recentSearches: [] } : {}) });
}

// ───────────── Saved views ─────────────

const pageId = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Lower-case table id");
const viewQuery = z.record(z.string().max(60), z.string().max(300)).refine((q) => Object.keys(q).length <= 30, "At most 30 filters");
const viewColumns = z.array(z.string().max(60)).max(60);

export const savedViewInput = z.object({ page: pageId, name: z.string().trim().min(1).max(80), query: viewQuery.default({}), columns: viewColumns.default([]), shared: z.boolean().default(false) }).strict();
export const savedViewPatch = z.object({ name: z.string().trim().min(1).max(80), query: viewQuery, columns: viewColumns, shared: z.boolean() }).partial().strict();

export interface SavedView {
  id: string;
  page: string;
  name: string;
  query: Record<string, string>;
  columns: string[];
  shared: boolean;
  mine: boolean;
  updatedAt: string;
}

const toView = (userId: string) => (v: { id: string; page: string; name: string; query: unknown; columns: unknown; shared: boolean; userId: string; updatedAt: Date }): SavedView => ({
  id: v.id,
  page: v.page,
  name: v.name,
  query: viewQuery.catch({}).parse(v.query),
  columns: viewColumns.catch([]).parse(v.columns),
  shared: v.shared,
  mine: v.userId === userId,
  updatedAt: v.updatedAt.toISOString(),
});

/** The caller's views for a table plus views other admins shared (bounded). Without `page`: all of the caller's own. */
export async function listSavedViews(ctx: RequestContext, page?: string): Promise<SavedView[]> {
  const userId = await requireConsoleUser(ctx);
  const p = page === undefined ? undefined : pageId.parse(page);
  const rows = await db().adminSavedView.findMany({
    where: p ? { page: p, OR: [{ userId }, { shared: true }] } : { userId },
    orderBy: [{ page: "asc" }, { name: "asc" }],
    take: 200,
  });
  return rows.map(toView(userId));
}

export async function createSavedView(ctx: RequestContext, raw: z.input<typeof savedViewInput>) {
  const userId = await requireConsoleUser(ctx);
  const input = savedViewInput.parse(raw);
  const count = await db().adminSavedView.count({ where: { userId, page: input.page } });
  if (count >= MAX_VIEWS_PER_PAGE) throw invalid(`At most ${MAX_VIEWS_PER_PAGE} saved views per table`, { reason: "too_many_views" });
  return toView(userId)(await db().adminSavedView.create({ data: { ...input, userId } }));
}

async function ownView(userId: string, id: string) {
  if (!isUuid(id)) throw notFound("Saved view");
  const v = await db().adminSavedView.findUnique({ where: { id } });
  // Another admin's view (even a shared one) is read-only: same answer as a missing one for writes.
  if (!v || v.userId !== userId) throw notFound("Saved view");
  return v;
}

export async function updateSavedView(ctx: RequestContext, id: string, raw: z.input<typeof savedViewPatch>) {
  const userId = await requireConsoleUser(ctx);
  const input = savedViewPatch.parse(raw);
  await ownView(userId, id);
  return toView(userId)(await db().adminSavedView.update({ where: { id }, data: input }));
}

export async function deleteSavedView(ctx: RequestContext, id: string) {
  const userId = await requireConsoleUser(ctx);
  await ownView(userId, id);
  await db().adminSavedView.delete({ where: { id } });
  return { ok: true as const };
}

// ───────────── /me ─────────────

/** The caller's own console profile: platform roles, active sessions and recent admin actions (bounded). */
export async function myConsoleProfile(ctx: RequestContext) {
  const userId = await requireConsoleUser(ctx);
  const now = new Date();
  const [assignments, sessions, actions, prefs, views] = await Promise.all([
    db().roleAssignment.findMany({
      where: { principalType: "USER", principalId: userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { id: true, scopeType: true, scopeId: true, expiresAt: true, createdAt: true, role: { select: { key: true, name: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    db().session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, mfaVerifiedAt: true },
      orderBy: { lastSeenAt: "desc" },
      take: 20,
    }),
    db().auditLog.findMany({
      where: { actorId: userId, category: { in: ["ADMIN", "SECURITY"] } },
      select: { id: true, action: true, category: true, reason: true, resourceType: true, resourceId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    getPreferences(ctx),
    listSavedViews(ctx),
  ]);
  return {
    roles: assignments.filter((a) => isPlatformScope(a.scopeType)).map((a) => ({ id: a.id, key: a.role.key, name: a.role.name, scopeType: a.scopeType, scopeId: a.scopeId, expiresAt: a.expiresAt, since: a.createdAt })),
    sessions: sessions.map((s) => ({ ...s, current: s.id === ctx.sessionId })),
    actions,
    preferences: prefs,
    savedViews: views,
  };
}
