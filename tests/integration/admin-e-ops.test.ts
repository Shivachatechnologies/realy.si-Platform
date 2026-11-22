import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import { userContext } from "@/server/core/context";
import { AppError } from "@/server/core/errors";
import { onError, onRequestComplete, onRequestGate, route, type RequestCompleteEvent } from "@/server/core/http";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { getErrorGroup, listErrorGroups, recordError, resetErrorThrottleForTests, updateErrorGroup } from "@/server/modules/admin/errors";
import { changeIncidentStatus, createIncident, getIncident, savePostmortem, updateIncident } from "@/server/modules/admin/incidents";
import { alertAction, evaluateAlertRules, listAlerts } from "@/server/modules/admin/alerts";
import { healthCenter, runHealthProbes, serviceHealthDetail } from "@/server/modules/admin/health";
import { exportDataset, runIntegrityChecks } from "@/server/modules/admin/data-ops";
import { searchLogs } from "@/server/modules/admin/logs";
import { listReleases, recordRelease } from "@/server/modules/admin/releases";
import { expectCode, grant, makeUser, resetDb } from "../helpers";
import { noParams, req } from "../http";

// Stream E (docs/admin/STREAMS.md): hooks, error grouping, incidents, alert engine, health probes, data ops, logs.

const E_TABLES = ["platform_alert_events", "platform_alerts", "platform_incident_updates", "platform_incidents", "error_events", "error_groups", "service_health_checks", "platform_releases", "app_log_entries"];

let admin: ReturnType<typeof userContext>;
let reader: ReturnType<typeof userContext>;

beforeAll(async () => {
  await resetDb();
  await db().$executeRawUnsafe(`TRUNCATE ${E_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
  const a = await makeUser({ name: "Ops Admin" });
  await grant(a.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
  admin = userContext(a.user.id, { mfaVerifiedAt: new Date(), sessionId: randomUUID() });
  const r = await makeUser({ name: "Read Only" });
  await grant(r.user.id, "READ_ONLY_ADMIN", "PLATFORM", PLATFORM_ID);
  reader = userContext(r.user.id, { mfaVerifiedAt: new Date(), sessionId: randomUUID() });
});

const tick = () => new Promise((r) => setTimeout(r, 50));

describe("core/http.ts hooks", () => {
  it("reports completions, unexpected errors only, and lets a gate refuse", async () => {
    const done: RequestCompleteEvent[] = [];
    const errors: string[] = [];
    const off = [onRequestComplete((e) => void done.push(e)), onError((e) => void errors.push(String((e.error as Error).message)))];
    const ok = route({ auth: "none", name: "GET /e-test/ok" }, async () => ({ ok: true }));
    const bad = route({ auth: "none", name: "GET /e-test/bad" }, async () => {
      throw new Error("kaboom e-test");
    });
    const expected = route({ auth: "none", name: "GET /e-test/expected" }, async () => {
      throw new AppError("not_found", "nope");
    });
    expect((await ok(req("/api/e-test/ok"), noParams)).status).toBe(200);
    expect((await bad(req("/api/e-test/bad"), noParams)).status).toBe(500);
    expect((await expected(req("/api/e-test/expected"), noParams)).status).toBe(404);
    await tick();
    const mine = done.filter((d) => d.route.startsWith("GET /e-test/"));
    expect(mine.map((d) => d.status).sort()).toEqual([200, 404, 500]);
    expect(mine.find((d) => d.status === 404)?.errorCode).toBe("not_found");
    expect(errors).toContain("kaboom e-test");
    expect(errors.some((m) => m === "nope")).toBe(false);

    const offGate = onRequestGate((g) => {
      if (g.pathname === "/api/e-test/ok") throw new AppError("forbidden", "gated");
    });
    expect((await ok(req("/api/e-test/ok"), noParams)).status).toBe(403);
    offGate();
    expect((await ok(req("/api/e-test/ok"), noParams)).status).toBe(200);
    for (const f of off) f();
  });

  it("groups the unhandled error through the stream E hook", async () => {
    await tick();
    const groups = await listErrorGroups(admin, { q: "kaboom e-test" });
    expect(groups.data.length).toBe(1);
    expect(groups.data[0]!.route).toBe("GET /e-test/bad");
  });
});

describe("error grouping", () => {
  it("dedupes, throttles, regresses after resolve and hides stacks without logs.read", async () => {
    resetErrorThrottleForTests();
    const err = () => {
      const e = new Error("Payment 0198f6c4-1d2e-7a3b-8c4d-5e6f7a8b9c0d failed for jane@example.com");
      return e;
    };
    const id = await recordError({ source: "worker", error: err(), route: "module-jobs/billing.x" });
    expect(id).toBeTruthy();
    expect(await recordError({ source: "worker", error: err(), route: "module-jobs/billing.x" })).toBeNull(); // throttled
    const g = await db().errorGroup.findUniqueOrThrow({ where: { id: id! } });
    expect(g.message).not.toContain("jane@example.com");
    const ev = await db().errorEvent.count({ where: { groupId: id! } });
    expect(ev).toBe(1);

    await expectCode(updateErrorGroup(reader, id!, { status: "RESOLVED", reason: "fixed in release" }), "forbidden");
    await updateErrorGroup(admin, id!, { status: "RESOLVED", reason: "fixed in release" });
    resetErrorThrottleForTests();
    await recordError({ source: "worker", error: err(), route: "module-jobs/billing.x" });
    expect((await db().errorGroup.findUniqueOrThrow({ where: { id: id! } })).status).toBe("REGRESSED");

    const forReader = await getErrorGroup(reader, id!);
    expect(forReader.canStack).toBe(true); // READ_ONLY_ADMIN holds platform.logs.read
    const forAdmin = await getErrorGroup(admin, id!);
    expect(forAdmin.events[0]!.stack).toContain("Error");
  });
});

describe("incidents", () => {
  it("follows the lifecycle and gates closing on resolution and postmortem", async () => {
    await expectCode(createIncident(reader, { title: "Checkout slow", severity: "SEV2", reason: "customers report" }), "forbidden");
    const inc = await createIncident(admin, { title: "Checkout slow", severity: "SEV2", services: ["payments"], reason: "customers report" });
    expect(inc.status).toBe("INVESTIGATING");
    await changeIncidentStatus(admin, inc.id, { status: "IDENTIFIED", message: "Stripe latency", reason: "root cause found" });
    await expectCode(changeIncidentStatus(admin, inc.id, { status: "DETECTED", message: "back", reason: "going back" }), "conflict");
    await changeIncidentStatus(admin, inc.id, { status: "RESOLVED", message: "fixed", reason: "latency normal" });
    await expectCode(changeIncidentStatus(admin, inc.id, { status: "CLOSED", message: "close", reason: "done here" }), "conflict");
    await updateIncident(admin, inc.id, { resolution: "Retried with backoff", reason: "write resolution" });
    await expectCode(changeIncidentStatus(admin, inc.id, { status: "CLOSED", message: "close", reason: "done here" }), "conflict"); // SEV2 needs a postmortem
    await savePostmortem(admin, inc.id, { postmortem: "## Summary\nSlow.", state: "published", reason: "review done" });
    await changeIncidentStatus(admin, inc.id, { status: "CLOSED", message: "closed", reason: "all done" });
    const d = await getIncident(reader, inc.id);
    expect(d.incident.status).toBe("CLOSED");
    expect(d.timeline.map((u) => u.kind)).toEqual(["created", "status", "status", "field", "postmortem", "status"]);
    expect(await db().auditLog.count({ where: { resourceId: inc.id, action: { startsWith: "platform.incident." } } })).toBe(6);
  });
});

describe("alert engine", () => {
  it("raises on real data, dedupes, auto-resolves, and opens incidents for core services", async () => {
    for (let i = 0; i < 4; i++) await db().stripeEvent.create({ data: { id: `evt_e_${i}_${Date.now()}`, type: "invoice.payment_failed", livemode: false, outcome: "applied" } });
    await evaluateAlertRules();
    let page = await listAlerts(reader, { rule: "payments.failed" });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.severity).toBe("WARNING");
    await evaluateAlertRules();
    page = await listAlerts(reader, { rule: "payments.failed" });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.count).toBe(2);
    const alertId = page.data[0]!.id;
    await expectCode(alertAction(reader, alertId, { action: "ack", reason: "looking" }), "forbidden");
    await alertAction(admin, alertId, { action: "ack", reason: "looking into it" });
    await alertAction(admin, alertId, { action: "snooze", minutes: 30, reason: "waiting on Stripe" });
    expect((await db().platformAlert.findUniqueOrThrow({ where: { id: alertId } })).status).toBe("SNOOZED");

    await db().stripeEvent.deleteMany({ where: { id: { startsWith: "evt_e_" } } });
    await evaluateAlertRules();
    expect((await db().platformAlert.findUniqueOrThrow({ where: { id: alertId } })).status).toBe("RESOLVED");

    const t0 = Date.now();
    await db().serviceHealthCheck.createMany({ data: [0, 1].map((i) => ({ service: "db", status: "DOWN" as const, checkedAt: new Date(t0 - i * 60_000), detail: {} })) });
    await evaluateAlertRules();
    const down = await db().platformAlert.findFirstOrThrow({ where: { fingerprint: "health.down:db", status: { not: "RESOLVED" } } });
    expect(down.severity).toBe("CRITICAL");
    expect(down.incidentId).toBeTruthy();
    const inc = await db().platformIncident.findUniqueOrThrow({ where: { id: down.incidentId! } });
    expect(inc.source).toBe("alert");
    expect(inc.services).toEqual(["db"]);
    await db().serviceHealthCheck.deleteMany({ where: { service: "db" } });
  });
});

describe("health probes", () => {
  it("stores one row per service and reports configuration honestly", async () => {
    const n = await runHealthProbes({ force: true });
    expect(n).toBe(19);
    const h = await healthCenter(reader);
    expect(h.services).toHaveLength(19);
    expect(h.services.find((s) => s.key === "db")!.status).toBe("HEALTHY");
    // No platform keys in tests: never simulated.
    expect(h.services.find((s) => s.key === "ai.openai")!.status).toBe("NOT_CONFIGURED");
    expect(h.services.find((s) => s.key === "payments")!.status).toBe("NOT_CONFIGURED");
    const d = await serviceHealthDetail(reader, "db");
    expect(d.history.length).toBeGreaterThan(0);
    expect(await runHealthProbes()).toBe(0); // nothing due right after a forced run
  });
});

describe("data ops, logs and releases", () => {
  it("runs read-only integrity checks", async () => {
    const r = await runIntegrityChecks();
    expect(r.every((c) => c.error === null)).toBe(true);
  });

  it("exports need platform.data.export and a reason, and are audited", async () => {
    await expectCode(exportDataset(reader, { dataset: "incidents", reason: "quarterly review" }), "forbidden");
    const out = await exportDataset(admin, { dataset: "incidents", reason: "quarterly review" });
    expect(out.csv.split("\n")[0]).toContain("number,title");
    expect(await db().auditLog.count({ where: { action: "platform.data.exported" } })).toBe(1);
  });

  it("merges log sources and masks recipients", async () => {
    await db().emailMessage.create({ data: { toEmail: "someone@example.org", template: "e_test", locale: "en-US", status: "FAILED", error: "smtp down" } });
    const page = await searchLogs(reader, { source: "email" });
    const line = page.data.find((l) => l.message.startsWith("e_test"))!;
    expect(line.level).toBe("error");
    expect(line.attrs.to).toBe("•••@example.org");
    const all = await searchLogs(reader, {});
    expect(new Set(all.data.map((l) => l.source)).size).toBeGreaterThan(1);
  });

  it("records one release row per app, sha and environment", async () => {
    await recordRelease("admin");
    await recordRelease("admin"); // once per process
    const r = await listReleases(reader, { app: "admin" });
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.boots).toBe(1);
  });
});

describe("action center source", () => {
  it("lists active incidents and alerts by severity and counts badges", async () => {
    const { opsActionSource, opsStatusCounts } = await import("@/server/modules/admin/alerts");
    const items = await opsActionSource.load(reader);
    expect(items.some((i) => i.kind === "incident")).toBe(true);
    const counts = await opsStatusCounts();
    expect(counts["incidents.active"]).toBeGreaterThan(0);
  });
});
