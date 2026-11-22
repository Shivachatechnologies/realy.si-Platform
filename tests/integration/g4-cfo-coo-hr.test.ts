import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { createObjective } from "@/server/modules/objectives/service";
import { cashFlowOverview, profitAndLossReport } from "@/server/modules/finance/analytics";
import { FINANCE_TOOLS } from "@/server/modules/finance/ai-tools";
import { FINANCE_PROFILES } from "@/server/modules/finance/ai-profiles";
import { cfoMonthlyPack, CFO_MONTHLY_PACK_PRESET } from "@/server/modules/finance/monthly-pack";
import { roiAnalytics } from "@/server/modules/finance/roi";
import { HR_TOOLS } from "@/server/modules/hr/ai-tools";
import { createCandidate, createJob } from "@/server/modules/hr/recruiting";
import { WORK_TOOLS } from "@/server/modules/work/ai-tools";
import { executeObjective, executionStatus, objectiveExecutionStatus, runExecutionTracking } from "@/server/modules/work/execution";
import { updateWorkTask } from "@/server/modules/work/tasks";
import { expectCode, makeUser, resetDb } from "../helpers";

beforeAll(resetDb);

async function setup(baseCurrency = "USD") {
  const owner = await makeUser();
  const org = await createOrganization(owner.ctx, { name: `G4 ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Ops Co", baseCurrency });
  return { owner, org, company };
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
const range = () => ({ from: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 1)), to: day(1) });

async function ledger(organizationId: string, companyId: string, rows: { micros: number; category?: "AI_TOKENS" | "IMAGE"; department?: string; aiEmployeeId?: string; at?: Date }[]) {
  await db().costLedgerEntry.createMany({
    data: rows.map((r, i) => ({
      organizationId,
      companyId,
      occurredAt: r.at ?? new Date(),
      category: r.category ?? "AI_TOKENS",
      provider: "anthropic",
      operation: "agent.turn",
      department: r.department ?? null,
      aiEmployeeId: r.aiEmployeeId ?? null,
      sourceType: "test",
      sourceId: `${companyId}:${i}:${Math.random()}`,
      costMicros: BigInt(r.micros),
    })),
  });
}

describe("G4 CFO: AI and provider spend in finance", () => {
  it("shows ledger spend next to the books, adds it only in USD companies, and stays tenant-isolated", async () => {
    const usd = await setup("USD");
    const eur = await setup("EUR");
    await ledger(usd.org.id, usd.company.id, [{ micros: 1_234_567, department: "marketing" }, { micros: 765_433, category: "IMAGE", department: "marketing" }]);
    await ledger(eur.org.id, eur.company.id, [{ micros: 5_000_000 }]);

    const a = await cashFlowOverview(usd.owner.ctx, usd.org.id, usd.company.id, range());
    expect(a.aiSpend.micros).toBe(2_000_000n);
    expect(a.aiSpend.comparable).toBe(true);
    expect(a.aiSpend.totalBase).toBe(200n); // $2.00 in cents
    expect(a.aiSpend.byDepartment[0]).toEqual({ key: "marketing", micros: 2_000_000n });

    const pnl = await profitAndLossReport(usd.owner.ctx, usd.org.id, usd.company.id, range());
    expect(pnl.aiSpend.amountMinor).toBe(200n);
    expect(pnl.netAfterAi).toBe(pnl.net - 200n);

    const b = await profitAndLossReport(eur.owner.ctx, eur.org.id, eur.company.id, range());
    expect(b.aiSpend.micros).toBe(5_000_000n);
    expect(b.aiSpend.amountMinor).toBeNull();
    expect(b.netAfterAi).toBeNull();

    // Another tenant cannot read it.
    await expectCode(cashFlowOverview(eur.owner.ctx, usd.org.id, usd.company.id, range()), "not_found");

    const tool = await FINANCE_TOOLS.read_ai_provider_costs!.execute({}, { ctx: eur.owner.ctx, organizationId: eur.org.id, companyId: eur.company.id });
    expect(tool.content).toContain("5.00 USD");
    expect(tool.content).toContain("no exchange rate");
    const summary = await FINANCE_TOOLS.read_financial_summary!.execute({}, { ctx: usd.owner.ctx, organizationId: usd.org.id, companyId: usd.company.id });
    expect(summary.content).toContain("AI and provider spend");
  });

  it("gives the AI CFO the cost and autopilot tools (B6) and a monthly pack preset", async () => {
    const cfo = FINANCE_PROFILES.find((p) => p.key === "ai_cfo")!;
    for (const tool of ["read_spending", "read_autopilot_status", "read_ai_provider_costs", "read_roi", "read_cfo_monthly_pack"]) expect(cfo.tools).toContain(tool);
    expect(CFO_MONTHLY_PACK_PRESET.profileKey).toBe("ai_cfo");
    expect(CFO_MONTHLY_PACK_PRESET.instructions).toContain("read_cfo_monthly_pack");
  });

  it("builds the monthly CFO pack from recorded data", async () => {
    const s = await setup("USD");
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 10));
    await ledger(s.org.id, s.company.id, [{ micros: 3_000_000, at: lastMonth }]);
    const pack = await cfoMonthlyPack(s.owner.ctx, s.org.id, s.company.id);
    expect(pack.month).toBe(lastMonth.toISOString().slice(0, 7));
    expect(pack.partial).toBe(false);
    expect(pack.ai.micros).toBe(3_000_000n);
    expect(pack.pnl.revenue).toBe(0n);
    expect(pack.markdown).toContain("3.00 USD");
    const future = await cfoMonthlyPack(s.owner.ctx, s.org.id, s.company.id, { month: "2999-01" });
    expect(future.month < "2999-01").toBe(true);
  });

  it("computes ROI per AI employee and campaign from won deals and recorded spend", async () => {
    const s = await setup("USD");
    const o = s.org.id;
    const c = s.company.id;
    const uid = s.owner.user.id;
    const employee = await db().aiEmployee.create({ data: { organizationId: o, companyId: c, name: "Sam SDR", initials: "SS", profileKey: "sdr", department: "sales", createdById: uid } as never });
    await ledger(o, c, [{ micros: 10_000_000, aiEmployeeId: employee.id, department: "sales" }]); // $10
    const pipeline = await db().crmPipeline.create({ data: { organizationId: o, companyId: c, name: "Sales" } });
    const stage = await db().crmPipelineStage.create({ data: { organizationId: o, companyId: c, pipelineId: pipeline.id, name: "Won", type: "WON" } });
    const lead = await db().lead.create({ data: { organizationId: o, companyId: c, name: "Acme", currency: "USD", score: 50, scoreLabel: "WARM", createdById: uid } as never });
    await db().agentTask.create({ data: { organizationId: o, companyId: c, profile: "sdr", title: "Work lead", instructions: "x", createdById: uid, leadId: lead.id, aiEmployeeId: employee.id, createdAt: day(-3) } });
    await db().marketingCampaign.create({ data: { organizationId: o, companyId: c, name: "Spring", code: "SPRING", currency: "USD", createdById: uid } });
    const campaign = await db().marketingCampaign.findFirstOrThrow({ where: { companyId: c, code: "SPRING" } });
    await db().marketingSpend.create({ data: { organizationId: o, companyId: c, campaignId: campaign.id, amountMinor: 5_000n, currency: "USD", channel: "ads", spentOn: day(-2), createdById: uid } });
    await db().crmDeal.create({ data: { organizationId: o, companyId: c, name: "Acme deal", pipelineId: pipeline.id, stageId: stage.id, amountMinor: 3_000n, currency: "USD", status: "WON", closedAt: day(-1), leadId: lead.id, campaignCode: "spring", createdById: uid } });

    const r = await roiAnalytics(s.owner.ctx, o, c, range());
    const a = r.byAgent.find((x) => x.id === employee.id)!;
    expect(a.dealsWon).toBe(1);
    expect(a.costMinor).toBe(1_000n);
    expect(a.roiPct).toBe(200); // (30 − 10) / 10
    const camp = r.byCampaign.find((x) => x.code === "SPRING")!;
    expect(camp.dealsWon).toBe(1);
    expect(camp.roiPct).toBe(-40); // (30 − 50) / 50
    expect(r.totals.unattributedDeals).toBe(0);
  });
});

describe("G4 COO: objective → executable work, tracked until done", () => {
  it("creates project, milestones and dependent tasks, detects blockers, and closes everything when done", async () => {
    const s = await setup("USD");
    const objective = await createObjective(s.owner.ctx, s.org.id, s.company.id, { title: "Launch in Germany" });
    // A cycle is refused before anything is created.
    await expectCode(
      executeObjective(s.owner.ctx, s.org.id, s.company.id, { objectiveId: objective.id, name: "Loop", tasks: [{ title: "A", dependsOn: [1] }, { title: "B", dependsOn: [0] }] }),
      "validation_error",
    );
    const r = await executeObjective(s.owner.ctx, s.org.id, s.company.id, {
      objectiveId: objective.id,
      name: "Germany launch",
      startDate: day(-10).toISOString().slice(0, 10),
      milestones: [{ title: "Ready", offsetDays: 3 }],
      tasks: [
        { title: "Legal entity", durationDays: 2, milestone: "Ready" },
        { title: "Localise site", durationDays: 2, dependsOn: [0], milestone: "Ready" },
        { title: "Launch", durationDays: 1, dependsOn: [1] },
      ],
    });
    expect(r).toMatchObject({ milestones: 1, tasks: 3, dependencies: 2 });
    expect(r.rescheduled).toBe(2);

    const tasks = await db().workTask.findMany({ where: { projectId: r.projectId }, orderBy: { position: "asc" } });
    expect(tasks.map((t) => t.startDate!.getTime())).toEqual([...tasks.map((t) => t.startDate!.getTime())].sort((x, y) => x - y));

    let st = await executionStatus(s.owner.ctx, s.org.id, s.company.id, r.projectId);
    expect(st.totals).toMatchObject({ total: 3, ready: 1, blocked: 2 });
    expect(st.objectives[0]?.objectiveId).toBe(objective.id);
    // The first task is overdue and unassigned and holds up two tasks: a critical blocker.
    expect(st.criticalBlockers[0]).toMatchObject({ id: tasks[0]!.id, waiting: 2 });
    expect(st.criticalBlockers[0]!.reasons).toEqual(expect.arrayContaining(["overdue", "unassigned"]));
    expect(st.health).not.toBe("ON_TRACK");

    // Blocked tasks cannot start (existing rule), and the tool reports the same picture.
    await expectCode(updateWorkTask(s.owner.ctx, s.org.id, s.company.id, tasks[1]!.id, { status: "IN_PROGRESS" }), "conflict");
    const text = await WORK_TOOLS.read_execution_status!.execute({ objectiveId: objective.id }, { ctx: s.owner.ctx, organizationId: s.org.id, companyId: s.company.id });
    expect(text.content).toContain("Critical blockers");

    for (const t of tasks) await updateWorkTask(s.owner.ctx, s.org.id, s.company.id, t.id, { status: "DONE" });
    st = await executionStatus(s.owner.ctx, s.org.id, s.company.id, r.projectId);
    expect(st.complete).toBe(true);
    await runExecutionTracking();
    const project = await db().project.findUniqueOrThrow({ where: { id: r.projectId } });
    expect(project.status).toBe("COMPLETED");
    expect((await db().projectMilestone.findFirstOrThrow({ where: { projectId: r.projectId } })).completedAt).not.toBeNull();
    expect((await db().milestone.findUniqueOrThrow({ where: { id: r.objectiveMilestoneId } })).completedAt).not.toBeNull();
    const o = await objectiveExecutionStatus(s.owner.ctx, s.org.id, s.company.id, objective.id);
    expect(o.complete).toBe(true);

    // Tenant isolation.
    const other = await setup("USD");
    await expectCode(executionStatus(other.owner.ctx, s.org.id, s.company.id, r.projectId), "not_found");
  });
});

describe("G4 HR: recruiter tools", () => {
  it("moves candidates through the pipeline and schedules interviews (no calendar connected)", async () => {
    const s = await setup("USD");
    const job = await createJob(s.owner.ctx, s.org.id, s.company.id, { title: "Engineer", status: "OPEN" });
    const cand = await createCandidate(s.owner.ctx, s.org.id, s.company.id, { jobId: job.id, firstName: "Ana", email: "ana@example.com" });
    const x = { ctx: s.owner.ctx, organizationId: s.org.id, companyId: s.company.id };

    expect(HR_TOOLS.move_candidate_stage!.autonomy).toBe("SUPERVISED");
    expect(HR_TOOLS.schedule_interview!.autonomy).toBe("SUPERVISED");
    expect(HR_TOOLS.move_candidate_stage!.input.safeParse({ candidateId: cand.id, stage: "REJECTED" }).success).toBe(false);

    await HR_TOOLS.move_candidate_stage!.execute({ candidateId: cand.id, stage: "SCREENING", reason: "Strong resume" }, x);
    expect((await db().hrCandidate.findUniqueOrThrow({ where: { id: cand.id } })).stage).toBe("SCREENING");

    const at = day(3).toISOString();
    const out = await HR_TOOLS.schedule_interview!.execute({ candidateId: cand.id, scheduledAt: at, type: "VIDEO" }, x);
    expect(out.content).toContain("No calendar is connected");
    expect((await db().hrCandidate.findUniqueOrThrow({ where: { id: cand.id } })).stage).toBe("INTERVIEW");
    await expectCode(HR_TOOLS.schedule_interview!.execute({ candidateId: cand.id, scheduledAt: day(-1).toISOString() }, x), "validation_error");

    const list = await HR_TOOLS.read_candidates!.execute({ stage: "ACTIVE" }, x);
    expect(list.content).toContain(cand.id);
  });
});
