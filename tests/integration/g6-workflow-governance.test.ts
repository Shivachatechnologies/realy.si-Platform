import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/server/core/db";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { createRun, processRun } from "@/server/modules/automation/engine";
import { decideWorkflowApproval, updateWorkflow } from "@/server/modules/automation/service";
import type { Definition } from "@/server/modules/automation/definition";
import { makeUser, resetDb } from "../helpers";

// B5 (company kill switch) and B22 (per-workflow autonomy) for workflow external actions.

let server: http.Server;
let hits = 0;
let url = "";

beforeAll(async () => {
  await resetDb();
  server = http.createServer((req, res) => {
    hits++;
    req.resume();
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function setup(mode: "OFF" | "APPROVAL_REQUIRED" | "AUTONOMOUS") {
  const owner = await makeUser();
  const org = await createOrganization(owner.ctx, { name: `Gov ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Gov Co" });
  const wf = await db().workflow.create({
    data: { organizationId: org.id, companyId: company.id, name: "Notify partner", ownerId: owner.user.id, createdById: owner.user.id, draft: {}, status: "ACTIVE", autonomyMode: mode },
  });
  const definition: Definition = { trigger: { type: "manual", filters: [] }, variables: [], steps: [{ id: "hook", type: "action", action: { kind: "http_webhook", url, body: '{"x":1}' } }] } as Definition;
  const start = async (startedById: string | null = null) => {
    const runId = await createRun({ workflowId: wf.id, organizationId: org.id, companyId: company.id, versionId: null, definition, triggerEventId: `t:${Math.random()}`, triggerType: "manual", event: { id: "e", type: "manual", entityId: "x", entityType: "test", occurredAt: new Date().toISOString(), data: {} }, depth: 0, startedById });
    await processRun(runId!);
    return db().workflowRun.findUniqueOrThrow({ where: { id: runId! } });
  };
  return { owner, org, company, wf, start };
}

describe("workflow external actions: autonomy and kill switch", () => {
  it("APPROVAL_REQUIRED (the default) waits for a person, then sends exactly once", async () => {
    const { owner, org, company, start } = await setup("APPROVAL_REQUIRED");
    const before = hits;
    const run = await start();
    expect(run).toMatchObject({ status: "WAITING", waitingFor: "approval" });
    expect(hits).toBe(before); // nothing left the company
    const req = await db().workflowApprovalRequest.findFirstOrThrow({ where: { runId: run.id } });
    expect(req).toMatchObject({ status: "PENDING", approverIds: [], approverPermission: "workflows.execute" });
    await decideWorkflowApproval(owner.ctx, org.id, company.id, req.id, { decision: "approve" });
    expect(await db().workflowRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "SUCCEEDED" });
    expect(hits).toBe(before + 1);
  });

  it("a rejected external action is cancelled and never sent", async () => {
    const { owner, org, company, start } = await setup("APPROVAL_REQUIRED");
    const before = hits;
    const run = await start();
    const req = await db().workflowApprovalRequest.findFirstOrThrow({ where: { runId: run.id } });
    await decideWorkflowApproval(owner.ctx, org.id, company.id, req.id, { decision: "reject", note: "not now" });
    expect(await db().workflowRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "CANCELLED" });
    expect(hits).toBe(before);
  });

  it("OFF refuses external actions, even in a run a person started", async () => {
    const { owner, start } = await setup("OFF");
    const before = hits;
    const run = await start(owner.user.id);
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatch(/turned off/);
    expect(hits).toBe(before);
  });

  it("a run a person started is that person's action", async () => {
    const { owner, start } = await setup("APPROVAL_REQUIRED");
    const before = hits;
    expect((await start(owner.user.id)).status).toBe("SUCCEEDED");
    expect(hits).toBe(before + 1);
  });

  it("AUTONOMOUS follows the company policy: ask without Auto mode, auto (recorded) within it", async () => {
    const { org, company, start } = await setup("AUTONOMOUS");
    const before = hits;
    expect(await start()).toMatchObject({ status: "WAITING", waitingFor: "approval" }); // default policy: ask
    await db().autonomySettings.create({ data: { organizationId: org.id, companyId: company.id, autoModeEnabled: true } });
    await db().autonomyPolicy.create({ data: { organizationId: org.id, companyId: company.id, department: "*", actionClass: "send_message", level: "AUTO", allowedChannels: ["web"], dailyLimit: 1 } });
    expect((await start()).status).toBe("SUCCEEDED");
    expect(hits).toBe(before + 1);
    const actions = await db().autonomousAction.findMany({ where: { companyId: company.id } });
    expect(actions).toEqual([expect.objectContaining({ source: "automation", actionClass: "send_message", channel: "web", status: "EXECUTED" })]);
    expect(await start()).toMatchObject({ status: "WAITING", waitingFor: "approval" }); // daily limit used up → a person decides
    expect(hits).toBe(before + 1);
  });

  it("Pause all AI holds every run (nothing is sent) and it resumes once unpaused", async () => {
    const { owner, org, company, start } = await setup("APPROVAL_REQUIRED");
    await db().autonomySettings.create({ data: { organizationId: org.id, companyId: company.id, paused: true } });
    const before = hits;
    const run = await start(owner.user.id);
    expect(run).toMatchObject({ status: "WAITING", waitingFor: "company_paused" });
    expect(run.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(hits).toBe(before);
    await db().autonomySettings.update({ where: { companyId: company.id }, data: { paused: false } });
    await db().workflowRun.update({ where: { id: run.id }, data: { nextRunAt: new Date() } });
    await processRun(run.id);
    expect(await db().workflowRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "SUCCEEDED" });
    expect(hits).toBe(before + 1);
  });

  it("the mode is set through the workflow API and audited", async () => {
    const { owner, org, company, wf } = await setup("APPROVAL_REQUIRED");
    expect(await updateWorkflow(owner.ctx, org.id, company.id, wf.id, { autonomyMode: "OFF" })).toMatchObject({ autonomyMode: "OFF" });
    const audit = await db().auditLog.findFirstOrThrow({ where: { resourceId: wf.id, action: "workflow.updated" } });
    expect(audit.newValue).toMatchObject({ autonomyMode: "OFF" });
  });
});
