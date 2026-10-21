import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { acceptInvitation, createOrganization, inviteMember } from "@/server/modules/organizations/service";
import { createCompany, createProject, listProjects, listWorkspaces } from "@/server/modules/companies/service";
import { systemRoleId } from "@/server/modules/rbac/service";
import { createSession, SESSION_COOKIE } from "@/server/modules/auth/session";
import { POST as createProjectRoute } from "@/app/api/v1/organizations/[orgId]/workspaces/[workspaceId]/projects/route";
import { expectCode, makeUser, resetDb } from "../helpers";
import { params, req } from "../http";

beforeAll(resetDb);

async function setup() {
  const owner = await makeUser();
  const org = await createOrganization(owner.ctx, { name: `Projects ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Build Co" });
  const [workspace] = await listWorkspaces(owner.ctx, org.id, company.id);
  return { owner, org, company, workspace: workspace! };
}

describe("projects", () => {
  it("lists a company's projects with their workspace; isolated per tenant; viewers read only", async () => {
    const a = await setup();
    const b = await setup();
    await createProject(a.owner.ctx, a.org.id, a.workspace.id, { name: "Website relaunch" });
    expect(await listProjects(a.owner.ctx, a.org.id, a.company.id)).toEqual([expect.objectContaining({ name: "Website relaunch", workspace: { id: a.workspace.id, name: "General" } })]);
    await expectCode(listProjects(b.owner.ctx, a.org.id, a.company.id), "not_found");
    await expectCode(createProject(b.owner.ctx, b.org.id, a.workspace.id, { name: "Intrude" }), "not_found");

    const viewer = await makeUser();
    const { token } = await inviteMember(a.owner.ctx, a.org.id, { email: viewer.user.email, roleId: await systemRoleId(db(), "VIEWER"), scopeType: "COMPANY", scopeId: a.company.id });
    await acceptInvitation(viewer.ctx, token);
    expect(await listProjects(viewer.ctx, a.org.id, a.company.id)).toHaveLength(1);
    await expectCode(createProject(viewer.ctx, a.org.id, a.workspace.id, { name: "Nope" }), "forbidden");
  });

  it("creates projects over the API", async () => {
    const { owner, org, company, workspace } = await setup();
    const { token } = await createSession(db(), owner.user.id, { mfaPending: false, mfaVerifiedAt: new Date() });
    const p = params({ orgId: org.id, workspaceId: workspace.id });
    const url = `/api/v1/organizations/${org.id}/workspaces/${workspace.id}/projects`;
    expect((await createProjectRoute(req(url, { cookie: `${SESSION_COOKIE}=${token}`, body: { name: "Q4 launch" } }), p)).status).toBe(200);
    expect((await createProjectRoute(req(url, { cookie: `${SESSION_COOKIE}=${token}`, body: { name: "" } }), p)).status).toBe(400);
    expect((await createProjectRoute(req(url, { body: { name: "x" } }), p)).status).toBe(401);
    expect((await listProjects(owner.ctx, org.id, company.id)).map((x) => x.name)).toEqual(["Q4 launch"]);
  });
});
