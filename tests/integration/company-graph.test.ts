import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { acceptInvitation, createOrganization, inviteMember } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { systemRoleId } from "@/server/modules/rbac/service";
import { createSession, SESSION_COOKIE } from "@/server/modules/auth/session";
import { createEdge, createEntity, deleteEdge, deleteEntity, getGraph, updateEntity } from "@/server/modules/graph/service";
import { GET as graphRoute } from "@/app/api/v1/organizations/[orgId]/companies/[companyId]/graph/route";
import { POST as entitiesRoute } from "@/app/api/v1/organizations/[orgId]/companies/[companyId]/graph/entities/route";
import { POST as edgesRoute } from "@/app/api/v1/organizations/[orgId]/companies/[companyId]/graph/edges/route";
import { expectCode, makeUser, resetDb } from "../helpers";
import { params, req } from "../http";

beforeAll(resetDb);

async function setup() {
  const owner = await makeUser({ name: "Owner" });
  const org = await createOrganization(owner.ctx, { name: `Graph ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Graph Co", incorporationCountryCode: "US" });
  const add = (kind: "PERSON" | "TEAM" | "PRODUCT" | "CUSTOMER" | "VENDOR" | "PARTNER", name: string) => createEntity(owner.ctx, org.id, company.id, { kind, name });
  return { owner, org, company, add };
}

async function joinAs(ownerCtx: Parameters<typeof inviteMember>[0], orgId: string, companyId: string, roleKey: string) {
  const u = await makeUser();
  const { token } = await inviteMember(ownerCtx, orgId, { email: u.user.email, roleId: await systemRoleId(db(), roleKey), scopeType: "COMPANY", scopeId: companyId });
  await acceptInvitation(u.ctx, token);
  return u;
}

describe("company graph", () => {
  it("builds a graph of typed relations, audited", async () => {
    const { owner, org, company, add } = await setup();
    const ana = await add("PERSON", "Ana");
    const team = await add("TEAM", "Platform");
    const app = await add("PRODUCT", "Realy App");
    const acme = await add("CUSTOMER", "Acme Corp");
    await createEdge(owner.ctx, org.id, company.id, { fromId: ana.id, relation: "MEMBER_OF", toId: team.id });
    await createEdge(owner.ctx, org.id, company.id, { fromId: team.id, relation: "OWNS", toId: app.id });
    await createEdge(owner.ctx, org.id, company.id, { fromId: acme.id, relation: "USES", toId: app.id });

    const graph = await getGraph(owner.ctx, org.id, company.id);
    expect(graph.entities.map((e) => e.name).sort()).toEqual(["Acme Corp", "Ana", "Platform", "Realy App"]);
    expect(graph.edges.map((e) => e.relation).sort()).toEqual(["MEMBER_OF", "OWNS", "USES"]);
    const actions = (await db().auditLog.findMany({ where: { organizationId: org.id, action: { startsWith: "graph." } } })).map((a) => a.action);
    expect(actions.filter((a) => a === "graph.entity.created")).toHaveLength(4);
    expect(actions.filter((a) => a === "graph.edge.created")).toHaveLength(3);

    const renamed = await updateEntity(owner.ctx, org.id, company.id, ana.id, { name: "Ana Silva", description: "Founder" });
    expect(renamed).toMatchObject({ name: "Ana Silva", description: "Founder" });
  });

  it("rejects relations between the wrong kinds, self-loops and duplicates", async () => {
    const { owner, org, company, add } = await setup();
    const ana = await add("PERSON", "Ana");
    const app = await add("PRODUCT", "App");
    await expectCode(createEdge(owner.ctx, org.id, company.id, { fromId: ana.id, relation: "USES", toId: app.id }), "validation_error");
    await expectCode(createEdge(owner.ctx, org.id, company.id, { fromId: ana.id, relation: "REPORTS_TO", toId: ana.id }), "validation_error");
    await createEdge(owner.ctx, org.id, company.id, { fromId: ana.id, relation: "WORKS_ON", toId: app.id });
    await expectCode(createEdge(owner.ctx, org.id, company.id, { fromId: ana.id, relation: "WORKS_ON", toId: app.id }), "conflict");
    await expectCode(add("PERSON", "Ana"), "conflict");
    await add("CUSTOMER", "Ana"); // same name, different kind is fine
  });

  it("keeps reporting lines a tree: one manager each, no cycles", async () => {
    const { owner, org, company, add } = await setup();
    const [ceo, cto, eng] = [await add("PERSON", "CEO"), await add("PERSON", "CTO"), await add("PERSON", "Engineer")];
    const reports = (a: { id: string }, b: { id: string }) => createEdge(owner.ctx, org.id, company.id, { fromId: a.id, relation: "REPORTS_TO", toId: b.id });
    await reports(cto, ceo);
    await reports(eng, cto);
    await expectCode(reports(ceo, eng), "validation_error"); // CEO → Engineer → CTO → CEO
    await expectCode(reports(eng, ceo), "conflict"); // already reports to CTO
  });

  it("deleting an entity removes its relations", async () => {
    const { owner, org, company, add } = await setup();
    const ana = await add("PERSON", "Ana");
    const team = await add("TEAM", "Ops");
    const edge = await createEdge(owner.ctx, org.id, company.id, { fromId: ana.id, relation: "MEMBER_OF", toId: team.id });
    await deleteEntity(owner.ctx, org.id, company.id, team.id);
    expect(await db().graphEdge.findUnique({ where: { id: edge.id } })).toBeNull();
    await expectCode(deleteEdge(owner.ctx, org.id, company.id, edge.id), "not_found");
  });

  it("isolates tenants and companies", async () => {
    const a = await setup();
    const b = await setup();
    const aPerson = await a.add("PERSON", "Ana");
    const bTeam = await b.add("TEAM", "B team");
    await expectCode(getGraph(b.owner.ctx, a.org.id, a.company.id), "not_found");
    await expectCode(createEntity(b.owner.ctx, a.org.id, a.company.id, { kind: "PERSON", name: "Intruder" }), "not_found");
    await expectCode(getGraph(b.owner.ctx, b.org.id, a.company.id), "not_found"); // own org id, foreign company id
    // An entity of another company can never be an edge end, nor be edited through this company.
    await expectCode(createEdge(b.owner.ctx, b.org.id, b.company.id, { fromId: aPerson.id, relation: "MEMBER_OF", toId: bTeam.id }), "not_found");
    await expectCode(updateEntity(b.owner.ctx, b.org.id, b.company.id, aPerson.id, { name: "Hijacked" }), "not_found");
    // Second company in the same organization has its own graph.
    const other = await createCompany(a.owner.ctx, a.org.id, { name: "Sister Co" });
    expect((await getGraph(a.owner.ctx, a.org.id, other.id)).entities).toHaveLength(0);
    await expectCode(deleteEntity(a.owner.ctx, a.org.id, other.id, aPerson.id), "not_found");
  });

  it("viewers and members read; managers edit", async () => {
    const { owner, org, company, add } = await setup();
    await add("PRODUCT", "App");
    const viewer = await joinAs(owner.ctx, org.id, company.id, "VIEWER");
    const member = await joinAs(owner.ctx, org.id, company.id, "MEMBER");
    const manager = await joinAs(owner.ctx, org.id, company.id, "MANAGER");
    expect((await getGraph(viewer.ctx, org.id, company.id)).entities).toHaveLength(1);
    expect((await getGraph(member.ctx, org.id, company.id)).entities).toHaveLength(1);
    await expectCode(createEntity(viewer.ctx, org.id, company.id, { kind: "PERSON", name: "V" }), "forbidden");
    await expectCode(createEntity(member.ctx, org.id, company.id, { kind: "PERSON", name: "M" }), "forbidden");
    await createEntity(manager.ctx, org.id, company.id, { kind: "PERSON", name: "Mgr" });
  });

  it("serves the graph over the API", async () => {
    const { owner, org, company } = await setup();
    const { token } = await createSession(db(), owner.user.id, { mfaPending: false, mfaVerifiedAt: new Date() });
    const cookie = `${SESSION_COOKIE}=${token}`;
    const p = params({ orgId: org.id, companyId: company.id });
    const base = `/api/v1/organizations/${org.id}/companies/${company.id}/graph`;

    const person = await entitiesRoute(req(`${base}/entities`, { cookie, body: { kind: "PERSON", name: "Ana" } }), p);
    expect(person.status).toBe(200);
    const team = await entitiesRoute(req(`${base}/entities`, { cookie, body: { kind: "TEAM", name: "Core" } }), p);
    const bad = await entitiesRoute(req(`${base}/entities`, { cookie, body: { kind: "ROBOT", name: "X" } }), p);
    expect(bad.status).toBe(400);
    const edge = await edgesRoute(req(`${base}/edges`, { cookie, body: { fromId: (await person.json()).id, relation: "MEMBER_OF", toId: (await team.json()).id } }), p);
    expect(edge.status).toBe(200);

    const res = await graphRoute(req(base, { cookie }), p);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entities).toHaveLength(2);
    expect(body.edges).toEqual([expect.objectContaining({ relation: "MEMBER_OF" })]);
    expect((await graphRoute(req(base), p)).status).toBe(401);
  });
});
