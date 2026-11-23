import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { actionBadges, actionCenter, computeActionQueue, SOURCES } from "@/server/modules/admin/action-center";
import { listNotifications, markNotifications, notificationTypes, notifyAdmins, unreadNotificationCount } from "@/server/modules/admin/notifications";
import { clearAggregateCache } from "@/server/modules/admin/overview";
import { createSavedView, deleteSavedView, getPreferences, listSavedViews, myConsoleProfile, pushRecent, pushRecentSearch, setFavorite, updatePreferences, updateSavedView } from "@/server/modules/admin/preferences";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { expectCode, grant, makeUser, resetDb } from "../helpers";

beforeAll(async () => {
  await resetDb();
  await db().$executeRawUnsafe(`TRUNCATE admin_preferences, admin_saved_views, platform_notifications, admin_notification_reads, worker_job_runs CASCADE`);
});

beforeEach(() => clearAggregateCache());

async function admin(role = "SUPER_ADMIN") {
  const u = await makeUser({ name: `${role} admin` });
  await grant(u.user.id, role, "PLATFORM", PLATFORM_ID);
  return u;
}

describe("admin personalization (stream A)", () => {
  it("keeps preferences, favorites, recents and searches per admin; tenants are refused", async () => {
    const a = await admin();
    expect(await getPreferences(a.ctx)).toMatchObject({ favorites: [], density: "comfortable", timeRange: "30d", sidebar: { collapsed: false } });

    await updatePreferences(a.ctx, { density: "compact", timeRange: "7d", sidebar: { collapsed: true, groups: { ai: false } }, notificationPrefs: { minSeverity: "WARNING" } });
    await updatePreferences(a.ctx, { sidebar: { groups: { users: true } } });
    const p = await getPreferences(a.ctx);
    expect(p).toMatchObject({ density: "compact", timeRange: "7d", sidebar: { collapsed: true, groups: { ai: false, users: true } }, notificationPrefs: { minSeverity: "WARNING", muted: [] } });

    await setFavorite(a.ctx, { href: "/users", on: true });
    await setFavorite(a.ctx, { href: "/ai/models", on: true });
    await setFavorite(a.ctx, { href: "/users", on: false });
    expect((await getPreferences(a.ctx)).favorites).toEqual(["/ai/models"]);
    await expect(setFavorite(a.ctx, { href: "https://evil.test", on: true })).rejects.toThrow();
    await expect(setFavorite(a.ctx, { href: "//evil.test", on: true })).rejects.toThrow();

    await pushRecent(a.ctx, { href: "/users", label: "admin.nav.users" });
    await pushRecent(a.ctx, { href: "/ai", label: "admin.nav.ai" });
    await pushRecent(a.ctx, { href: "/users", label: "admin.nav.users" });
    expect((await getPreferences(a.ctx)).recents.map((r) => r.href)).toEqual(["/users", "/ai"]);
    await pushRecentSearch(a.ctx, { q: "acme" });
    await pushRecentSearch(a.ctx, { q: "ACME" });
    expect((await getPreferences(a.ctx)).recentSearches).toEqual(["acme"]);

    const other = await admin();
    expect((await getPreferences(other.ctx)).favorites).toEqual([]); // own row only

    const tenant = await makeUser();
    await expectCode(getPreferences(tenant.ctx), "forbidden");
    await expectCode(updatePreferences(tenant.ctx, { density: "compact" }), "forbidden");
  });

  it("saved views: own and shared are listed; only the owner can change or delete", async () => {
    const a = await admin();
    const b = await admin("READ_ONLY_ADMIN");
    const mine = await createSavedView(a.ctx, { page: "users", name: "Suspended", query: { status: "SUSPENDED" }, columns: ["name", "status"] });
    const shared = await createSavedView(a.ctx, { page: "users", name: "Team", query: { q: "realy" }, shared: true });
    expect((await listSavedViews(a.ctx, "users")).map((v) => v.name).sort()).toEqual(["Suspended", "Team"]);
    expect((await listSavedViews(b.ctx, "users")).map((v) => [v.name, v.mine])).toEqual([["Team", false]]);
    await expectCode(updateSavedView(b.ctx, shared.id, { name: "Hijack" }), "not_found");
    await expectCode(deleteSavedView(b.ctx, shared.id), "not_found");
    expect((await updateSavedView(a.ctx, mine.id, { shared: true })).shared).toBe(true);
    await deleteSavedView(a.ctx, mine.id);
    expect((await listSavedViews(a.ctx, "users")).map((v) => v.name)).toEqual(["Team"]);
    await expect(createSavedView(a.ctx, { page: "Bad Page!", name: "x" })).rejects.toThrow();
    const profile = await myConsoleProfile(a.ctx);
    expect(profile.roles.map((r) => r.key)).toEqual(["SUPER_ADMIN"]);
    expect(profile.savedViews.map((v) => v.name)).toEqual(["Team"]);
  });
});

describe("admin notifications (stream A)", () => {
  it("delivers by permission or to one admin, deduplicates, tracks read state and honours preferences", async () => {
    const superAdmin = await admin();
    const content = await admin("CONTENT_ADMIN");
    await notifyAdmins(null, { permission: "platform.incidents.read", type: "alert.raised", severity: "CRITICAL", title: "DLQ above 50", href: "/system/jobs?status=DEAD", dedupeKey: "test:dlq" });
    await notifyAdmins(null, { userId: content.user.id, type: "support.assigned", title: "Ticket assigned to you" });

    const s1 = await listNotifications(superAdmin.ctx);
    expect(s1.data.map((n) => [n.title, n.read, n.roleWide])).toEqual([["DLQ above 50", false, true]]);
    expect((await listNotifications(content.ctx)).data.map((n) => n.title)).toEqual(["Ticket assigned to you"]); // no incidents permission
    expect(await unreadNotificationCount(superAdmin.ctx)).toBe(1);

    await markNotifications(superAdmin.ctx, { ids: [s1.data[0]!.id] });
    expect(await unreadNotificationCount(superAdmin.ctx)).toBe(0);
    // Marking someone else's notification is a no-op.
    expect(await markNotifications(content.ctx, { ids: [s1.data[0]!.id] })).toEqual({ updated: 0 });

    // A repeat with the same dedupe key bumps the row and makes it unread again.
    await notifyAdmins(null, { permission: "platform.incidents.read", type: "alert.raised", severity: "CRITICAL", title: "DLQ above 80", dedupeKey: "test:dlq" });
    const s2 = await listNotifications(superAdmin.ctx);
    expect(s2.data).toHaveLength(1);
    expect(s2.data[0]).toMatchObject({ title: "DLQ above 80", occurrences: 2, read: false });

    // Preferences: severity floor and muted types hide notifications for this admin only.
    await notifyAdmins(null, { permission: "platform.incidents.read", type: "job.retry", severity: "INFO", title: "Retry scheduled" });
    expect(await unreadNotificationCount(superAdmin.ctx)).toBe(2);
    await updatePreferences(superAdmin.ctx, { notificationPrefs: { minSeverity: "WARNING" } });
    expect((await listNotifications(superAdmin.ctx)).data.map((n) => n.title)).toEqual(["DLQ above 80"]);
    await updatePreferences(superAdmin.ctx, { notificationPrefs: { minSeverity: "INFO", muted: ["alert.raised"] } });
    expect((await listNotifications(superAdmin.ctx)).data.map((n) => n.title)).toEqual(["Retry scheduled"]);
    expect(await notificationTypes(superAdmin.ctx)).toEqual(["alert.raised", "job.retry"]);
    await updatePreferences(superAdmin.ctx, { notificationPrefs: { muted: [] } });

    await markNotifications(superAdmin.ctx, { all: true });
    expect(await unreadNotificationCount(superAdmin.ctx)).toBe(0);
    expect((await listNotifications(superAdmin.ctx, { filter: "unread" })).data).toEqual([]);
    await markNotifications(superAdmin.ctx, { ids: [s2.data[0]!.id], read: false });
    expect(await unreadNotificationCount(superAdmin.ctx)).toBe(1);

    // Producer input is validated (programming errors surface), and tenants cannot read the inbox.
    await expect(notifyAdmins(null, { permission: "crm.read", type: "x", title: "tenant permission" })).rejects.toThrow();
    await expect(notifyAdmins(null, { type: "x", title: "no audience" })).rejects.toThrow();
    await expect(notifyAdmins(null, { userId: content.user.id, type: "x", title: "abs", href: "https://evil.test" })).rejects.toThrow();
    await expectCode(listNotifications((await makeUser()).ctx), "forbidden");
  });

  it("paginates with a keyset cursor", async () => {
    const a = await admin();
    for (let i = 0; i < 5; i++) await notifyAdmins(null, { userId: a.user.id, type: "page.test", title: `n${i}` });
    const p1 = await listNotifications(a.ctx, { type: "page.test", limit: 2 });
    const p2 = await listNotifications(a.ctx, { type: "page.test", limit: 2, cursor: p1.nextCursor! });
    const p3 = await listNotifications(a.ctx, { type: "page.test", limit: 2, cursor: p2.nextCursor! });
    const titles = [...p1.data, ...p2.data, ...p3.data].map((n) => n.title);
    expect(new Set(titles).size).toBe(5);
    expect(p3.nextCursor).toBeNull();
  });
});

describe("action center (stream A)", () => {
  it("counts real rows, shows items only to admins who may open them, and feeds sidebar badges", async () => {
    await db().workerJobRun.create({ data: { queue: "webhooks", jobName: "deliver", jobId: `dead-${Date.now()}`, status: "DEAD", deadLetteredAt: new Date() } });
    // Stream E's alerts feed the queue and the `alerts.open` badge (adapted from opsActionRows / opsStatusCounts).
    await db().platformAlert.deleteMany();
    await db().platformAlert.create({ data: { fingerprint: `test:${Date.now()}`, rule: "queue.backlog", groupKey: "queue.backlog:queues", service: "queues", severity: "CRITICAL", title: "Queue backlog" } });
    const superAdmin = await admin();
    const content = await admin("CONTENT_ADMIN");
    const q = await actionCenter(superAdmin.ctx);
    const dead = q.items.find((i) => i.id === "jobs.dead");
    expect(dead).toMatchObject({ count: 1, href: "/system/jobs?status=DEAD", domain: "ops" });
    expect(dead!.samples[0]).toMatchObject({ label: "deliver", sub: "webhooks" });
    // Super admins without MFA are themselves an item (makeUser creates users without TOTP).
    expect(q.items.find((i) => i.id === "security.adminsWithoutMfa")?.count).toBeGreaterThanOrEqual(1);
    expect(q.items.find((i) => i.id === "alerts.open")).toMatchObject({ count: 1, severity: "critical", href: "/alerts", domain: "ops" });
    expect(q.items.find((i) => i.id === "alerts.open")!.samples[0]).toMatchObject({ label: "Queue backlog", sub: "OPEN" });
    expect(q.pending).toEqual([]);

    const c = await actionCenter(content.ctx);
    expect(c.items.find((i) => i.id === "jobs.dead")).toBeUndefined(); // no ops section access
    expect(c.items.find((i) => i.id === "alerts.open")).toBeUndefined(); // no alerts section access

    const badges = await actionBadges(superAdmin.ctx);
    expect(badges["jobs.dead"]).toBe(1);
    expect(badges["alerts.open"]).toBe(1);
    expect(badges["actions.open"]).toBe(q.items.length);
    expect((await actionCenter((await makeUser()).ctx)).items).toEqual([]); // tenants see nothing
  });

  it("one failing source never hides the others", async () => {
    const broken = { id: "broken", load: () => Promise.reject(new Error("db down")) };
    const r = await computeActionQueue([broken, ...SOURCES]);
    expect(r.failed).toEqual(["broken"]);
    expect(r.items.length).toBeGreaterThan(0);
  });
});
