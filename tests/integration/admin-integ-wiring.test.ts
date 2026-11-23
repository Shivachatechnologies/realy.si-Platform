import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { actionCenter } from "@/server/modules/admin/action-center";
import { clearAggregateCache, computeCommandCenter } from "@/server/modules/admin/overview";
import { supportAttention } from "@/server/modules/admin/support";
import { failedPaymentRecovery } from "@/server/modules/billing/explorers";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { OPS_JOBS } from "@/worker/ops-jobs";
import { expectCode, grant, makeUser, resetDb } from "../helpers";
import { noParams, req } from "../http";

/** Integration of the admin streams (A–F): cross-stream request hooks, Action Center sources, moved lists. */

beforeAll(async () => {
  await resetDb();
  await db().$executeRawUnsafe(`TRUNCATE api_request_logs, platform_support_tickets, platform_refunds, platform_alerts, platform_incidents, platform_disputes, platform_access_reviews CASCADE`);
});
beforeEach(() => clearAggregateCache());

const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 40; i++) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

async function superAdmin() {
  const u = await makeUser({ name: "integ admin" });
  await grant(u.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
  return u;
}

describe("request hooks (E → B, F)", () => {
  it("records sampled API requests through stream F's installer (every error is kept)", async () => {
    const handler = route({ auth: "none", name: "GET /integ-test/missing" }, async () => {
      throw new AppError("not_found", "nope");
    });
    expect((await handler(req("/api/integ-test/missing"), noParams)).status).toBe(404);
    const found = await until(async () => (await db().apiRequestLog.count({ where: { route: "GET /integ-test/missing", status: 404 } })) === 1);
    expect(found).toBe(true);
    const row = await db().apiRequestLog.findFirstOrThrow({ where: { route: "GET /integ-test/missing" } });
    expect(row).toMatchObject({ method: "GET", errorCode: "not_found" });
  });

  it("purges API logs daily through the periodic runner, never more often than every 5 minutes", () => {
    const job = OPS_JOBS.find((j) => j.name === "admin.api_logs_retention");
    expect(job?.everyMs).toBe(24 * 3_600_000);
    for (const j of OPS_JOBS) expect(j.everyMs, j.name).toBeGreaterThanOrEqual(5 * 60_000);
  });
});

describe("Action Center sources from other streams", () => {
  it("lists support tickets past their SLA, open disputes and open access reviews", async () => {
    const a = await superAdmin();
    const past = new Date(Date.now() - 3_600_000);
    await db().platformSupportTicket.create({ data: { requesterEmail: "c@example.test", subject: "Cannot log in", priority: "URGENT", slaDueAt: past } });
    await db().platformSupportTicket.create({ data: { requesterEmail: "d@example.test", subject: "Question", status: "SOLVED" } });
    expect(await supportAttention()).toMatchObject({ open: 1, breached: 1 });
    await db().platformDispute.create({
      data: { stripeDisputeId: `dp_${Date.now()}`, amountMinor: 1000n, currency: "EUR", reason: "fraudulent", status: "needs_response", evidenceDueBy: new Date(Date.now() + 86_400_000), createdAt: new Date(), stripeUpdatedAt: new Date() },
    });
    await db().platformAccessReview.create({ data: { title: "Q4 platform access", createdById: a.user.id } });

    const q = await actionCenter(a.ctx);
    const ids = q.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["support.slaBreached", "support.tickets", "billing.disputes", "access.reviews"]));
    expect(q.items.find((i) => i.id === "support.slaBreached")).toMatchObject({ count: 1, href: "/support?sla=breached" });
    expect(q.items.find((i) => i.id === "billing.disputes")).toMatchObject({ count: 1, severity: "critical" });
    expect(q.failed).toEqual([]);
    expect(q.pending).toEqual([]);

    // A content admin may open neither the support queue nor access reviews.
    const content = await makeUser();
    await grant(content.user.id, "CONTENT_ADMIN", "PLATFORM", PLATFORM_ID);
    const c = await actionCenter(content.ctx);
    expect(c.items.filter((i) => ["support.tickets", "support.slaBreached", "access.reviews"].includes(i.id))).toEqual([]);
  });

  it("feeds the command center strip and the refunds & disputes KPI from real rows", async () => {
    const d = await computeCommandCenter("7d");
    expect(d.status.ops).toMatchObject({ alertsOpen: 0, incidentsActive: 0 });
    const refunds = d.sections.find((s) => s.id === "revenue")!.kpis.find((k) => k.key === "refunds")!;
    expect(refunds).toMatchObject({ status: "ok", value: 1, previous: 0 });
  });
});

describe("failed-payment recovery (moved from Platform ops to Payments)", () => {
  it("is readable by billing admins only", async () => {
    const a = await superAdmin();
    expect(Array.isArray(await failedPaymentRecovery(a.ctx))).toBe(true);
    await expectCode(failedPaymentRecovery((await makeUser()).ctx), "forbidden");
  });
});
