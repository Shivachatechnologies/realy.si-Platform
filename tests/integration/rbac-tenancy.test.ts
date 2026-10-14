import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { acceptInvitation, createOrganization, inviteMember, listMembers } from "@/server/modules/organizations/service";
import { createCompany, createProject, createWorkspace, getCompany, listCompanies, listWorkspaces } from "@/server/modules/companies/service";
import { assignRole, can, createCustomRole, revokeAssignment, systemRoleId } from "@/server/modules/rbac/service";
import { companyChain, orgChain } from "@/server/modules/rbac/scope";
import { listAuditLogs } from "@/server/modules/audit/service";
import { SYSTEM_ROLES } from "@/server/modules/rbac/catalog";
import { expectCode, makeUser, resetDb } from "../helpers";

beforeAll(resetDb);

async function setup() {
  const owner = await makeUser({ name: "Owner" });
  const org = await createOrganization(owner.ctx, { name: `Acme ${Math.random()}` });
  const company = await createCompany(owner.ctx, org.id, { name: "Acme US", incorporationCountryCode: "US" });
  return { owner, org, company };
}

/** Add `user` to `orgId` with `roleKey` at a scope, through the real invite → accept flow. */
async function join(ownerCtx: Parameters<typeof inviteMember>[0], orgId: string, roleKey: string, scopeType: "ORGANIZATION" | "COMPANY" = "ORGANIZATION", scopeId?: string) {
  const u = await makeUser();
  const { token } = await inviteMember(ownerCtx, orgId, {
    email: u.user.email,
    roleId: await systemRoleId(db(), roleKey),
    scopeType,
    scopeId,
  });
  await acceptInvitation(u.ctx, token);
  return u;
}

describe("organizations and ownership", () => {
  it("creator becomes member + ORGANIZATION_OWNER, with audit and outbox event", async () => {
    const { owner, org } = await setup();
    expect(await can(owner.ctx, "ownership.modify", orgChain(org.id))).toBe(true);
    const members = await listMembers(owner.ctx, org.id);
    expect(members).toHaveLength(1);
    expect(members[0]!.roles.map((r) => r.key)).toEqual(["ORGANIZATION_OWNER"]);
    expect(await db().event.count({ where: { type: "organization.created", organizationId: org.id } })).toBe(1);
    const audit = await listAuditLogs(owner.ctx, org.id);
    expect(audit.data.map((a) => a.action)).toEqual(expect.arrayContaining(["organization.created", "role.assigned", "company.created"]));
  });

  it("the last owner cannot be revoked", async () => {
    const { owner, org } = await setup();
    const a = await db().roleAssignment.findFirstOrThrow({ where: { organizationId: org.id, principalId: owner.user.id } });
    await expectCode(revokeAssignment(owner.ctx, org.id, a.id), "conflict");
  });
});

describe("tenant isolation", () => {
  it("another organization's data is not found, never forbidden or leaked", async () => {
    const a = await setup();
    const b = await setup();
    await expectCode(getCompany(b.owner.ctx, a.org.id, a.company.id), "not_found");
    await expectCode(getCompany(b.owner.ctx, b.org.id, a.company.id), "not_found"); // own org id, foreign company id
    await expectCode(listCompanies(b.owner.ctx, a.org.id), "not_found");
    await expectCode(createWorkspace(b.owner.ctx, b.org.id, a.company.id, { name: "Intrude" }), "not_found");
    await expectCode(listMembers(b.owner.ctx, a.org.id), "not_found");
    await expectCode(listAuditLogs(b.owner.ctx, a.org.id), "not_found");
    const page = await listCompanies(b.owner.ctx, b.org.id);
    expect(page.data.map((c) => c.id)).toEqual([b.company.id]);
  });

  it("a removed member loses access immediately even if assignments linger", async () => {
    const { owner, org, company } = await setup();
    const viewer = await join(owner.ctx, org.id, "VIEWER");
    await getCompany(viewer.ctx, org.id, company.id);
    await db().membership.update({ where: { organizationId_userId: { organizationId: org.id, userId: viewer.user.id } }, data: { status: "SUSPENDED" } });
    await expectCode(getCompany(viewer.ctx, org.id, company.id), "not_found");
  });
});

describe("roles at scopes", () => {
  it("VIEWER can read but not manage", async () => {
    const { owner, org, company } = await setup();
    const viewer = await join(owner.ctx, org.id, "VIEWER");
    await getCompany(viewer.ctx, org.id, company.id);
    await expectCode(createCompany(viewer.ctx, org.id, { name: "Nope" }), "forbidden");
    await expectCode(createWorkspace(viewer.ctx, org.id, company.id, { name: "Nope" }), "forbidden");
  });

  it("COMPANY_ADMIN manages only their company", async () => {
    const { owner, org, company } = await setup();
    const other = await createCompany(owner.ctx, org.id, { name: "Acme EU", incorporationCountryCode: "DE" });
    const admin = await join(owner.ctx, org.id, "COMPANY_ADMIN", "COMPANY", company.id);

    const ws = await createWorkspace(admin.ctx, org.id, company.id, { name: "Growth" });
    expect(ws.companyId).toBe(company.id);
    await expectCode(createWorkspace(admin.ctx, org.id, other.id, { name: "Nope" }), "forbidden");
    await expectCode(createCompany(admin.ctx, org.id, { name: "Nope" }), "forbidden");

    const visible = await listCompanies(admin.ctx, org.id);
    expect(visible.data.map((c) => c.id)).toEqual([company.id]);
  });

  it("MEMBER at a workspace can create projects there only", async () => {
    const { owner, org, company } = await setup();
    const [general] = await listWorkspaces(owner.ctx, org.id, company.id);
    const other = await createWorkspace(owner.ctx, org.id, company.id, { name: "Private" });
    const member = await makeUser();
    const { token } = await inviteMember(owner.ctx, org.id, {
      email: member.user.email,
      roleId: await systemRoleId(db(), "MEMBER"),
      scopeType: "WORKSPACE",
      scopeId: general!.id,
    });
    await acceptInvitation(member.ctx, token);
    await createProject(member.ctx, org.id, general!.id, { name: "Launch site" });
    await expectCode(createProject(member.ctx, org.id, other.id, { name: "Nope" }), "forbidden");
  });

  it("an invitation can only be accepted by its addressee", async () => {
    const { owner, org } = await setup();
    const intended = await makeUser();
    const stranger = await makeUser();
    const { token } = await inviteMember(owner.ctx, org.id, { email: intended.user.email, roleId: await systemRoleId(db(), "VIEWER") });
    await expectCode(acceptInvitation(stranger.ctx, token), "forbidden");
    await acceptInvitation(intended.ctx, token);
    await expectCode(acceptInvitation(intended.ctx, token), "not_found"); // single use
  });
});

describe("no privilege escalation", () => {
  it("ORGANIZATION_ADMIN cannot grant or invite ORGANIZATION_OWNER", async () => {
    const { owner, org } = await setup();
    const admin = await join(owner.ctx, org.id, "ORGANIZATION_ADMIN");
    const target = await join(owner.ctx, org.id, "VIEWER");
    const ownerRole = await systemRoleId(db(), "ORGANIZATION_OWNER");
    await expectCode(
      assignRole(admin.ctx, org.id, { principalType: "USER", principalId: target.user.id, roleId: ownerRole, scopeType: "ORGANIZATION", scopeId: org.id }),
      "forbidden",
    );
    await expectCode(inviteMember(admin.ctx, org.id, { email: "x@example.test", roleId: ownerRole }), "forbidden");
    // …but can grant a role they fully hold.
    await assignRole(admin.ctx, org.id, {
      principalType: "USER",
      principalId: target.user.id,
      roleId: await systemRoleId(db(), "MANAGER"),
      scopeType: "COMPANY",
      scopeId: (await db().company.findFirstOrThrow({ where: { organizationId: org.id } })).id,
    });
  });

  it("platform roles cannot be granted from inside an organization", async () => {
    const { owner, org } = await setup();
    await expectCode(
      assignRole(owner.ctx, org.id, {
        principalType: "USER",
        principalId: owner.user.id,
        roleId: await systemRoleId(db(), "SUPER_ADMIN"),
        scopeType: "PLATFORM",
        scopeId: "*",
      }),
      "validation_error",
    );
  });

  it("AI identities can never receive money-movement, ownership or role-granting permissions", async () => {
    const { owner, org } = await setup();
    await expectCode(
      assignRole(owner.ctx, org.id, {
        principalType: "AGENT",
        principalId: crypto.randomUUID(),
        roleId: await systemRoleId(db(), "ORGANIZATION_OWNER"),
        scopeType: "ORGANIZATION",
        scopeId: org.id,
      }),
      "forbidden",
    );
  });

  it("role-granting requires MFA", async () => {
    const owner = await makeUser({ mfa: false });
    const org = await createOrganization(owner.ctx, { name: "No MFA Co" });
    await expectCode(inviteMember(owner.ctx, org.id, { email: "y@example.test", roleId: await systemRoleId(db(), "VIEWER") }), "mfa_required");
  });
});

describe("custom roles", () => {
  it("Marketing Manager: marketing + analytics read, no finance or billing", async () => {
    const { owner, org, company } = await setup();
    const role = await createCustomRole(owner.ctx, org.id, {
      key: "marketing-manager",
      name: "Marketing Manager",
      permissions: ["marketing.read", "marketing.manage", "analytics.read", "companies.read"],
    });
    const mm = await makeUser();
    const { token } = await inviteMember(owner.ctx, org.id, { email: mm.user.email, roleId: role.id, scopeType: "COMPANY", scopeId: company.id });
    await acceptInvitation(mm.ctx, token);
    const chain = await companyChain(db(), org.id, company.id);
    expect(await can(mm.ctx, "marketing.manage", chain)).toBe(true);
    expect(await can(mm.ctx, "analytics.read", chain)).toBe(true);
    expect(await can(mm.ctx, "finance.manage", chain)).toBe(false);
    expect(await can(mm.ctx, "billing.manage", orgChain(org.id))).toBe(false);
  });

  it("custom roles cannot contain platform-only or unheld permissions", async () => {
    const { owner, org } = await setup();
    await expectCode(createCustomRole(owner.ctx, org.id, { key: "sneaky", name: "Sneaky", permissions: ["pricing.manage"] }), "forbidden");
    const admin = await join(owner.ctx, org.id, "ORGANIZATION_ADMIN");
    await expectCode(createCustomRole(admin.ctx, org.id, { key: "mover", name: "Mover", permissions: ["finance.transfer"] }), "forbidden");
  });
});

describe("catalog integrity", () => {
  it("every system role references only catalog permissions, and tenant roles hold no platform permissions", async () => {
    for (const r of SYSTEM_ROLES) {
      const row = await db().role.findFirstOrThrow({ where: { key: r.key, organizationId: null }, include: { permissions: { include: { permission: true } } } });
      expect(row.permissions.map((p) => p.permission.key).sort()).toEqual([...r.permissions].sort());
      const tenantScoped = r.assignableAt.some((s) => ["ORGANIZATION", "COMPANY", "WORKSPACE", "PROJECT"].includes(s));
      if (tenantScoped) expect(row.permissions.some((p) => p.permission.platformOnly)).toBe(false);
    }
  });
});
