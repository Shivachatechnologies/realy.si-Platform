import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { createOrganization } from "@/server/modules/organizations/service";
import { createSession, validateSessionToken } from "@/server/modules/auth/session";
import { listPlatformOrganizations, listPlatformUsers, setUserStatus } from "@/server/modules/admin/users";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { expectCode, grant, makeUser, resetDb } from "../helpers";

beforeAll(resetDb);

async function superAdmin() {
  const u = await makeUser({ name: "Root" });
  await grant(u.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
  return u;
}

describe("platform user administration", () => {
  it("super admins list users and organizations; tenant owners cannot", async () => {
    const admin = await superAdmin();
    const founder = await makeUser({ name: "Founder Findme" });
    await createOrganization(founder.ctx, { name: "Findme Holdings" });

    const users = await listPlatformUsers(admin.ctx, { q: "findme" });
    expect(users).toEqual([expect.objectContaining({ id: founder.user.id, status: "ACTIVE", organizations: 1, platformRoles: [] })]);
    expect(users[0]).not.toHaveProperty("passwordHash");
    expect((await listPlatformUsers(admin.ctx, { q: admin.user.email }))[0]!.platformRoles).toEqual(["SUPER_ADMIN"]);
    expect(await listPlatformOrganizations(admin.ctx, { q: "findme" })).toEqual([expect.objectContaining({ name: "Findme Holdings", members: 1, companies: 0, subscription: null })]);

    await expectCode(listPlatformUsers(founder.ctx), "forbidden");
    await expectCode(listPlatformOrganizations(founder.ctx), "forbidden");
  });

  it("suspension signs the user out everywhere and blocks sessions until reactivated; audited with a reason", async () => {
    const admin = await superAdmin();
    const target = await makeUser();
    const { token } = await createSession(db(), target.user.id, { mfaPending: false });
    expect(await validateSessionToken(token)).not.toBeNull();

    await setUserStatus(admin.ctx, target.user.id, { status: "SUSPENDED", reason: "Abuse report #12" });
    expect(await validateSessionToken(token)).toBeNull();
    const { token: fresh } = await createSession(db(), target.user.id, { mfaPending: false });
    expect(await validateSessionToken(fresh)).toBeNull(); // any session is refused while suspended

    await setUserStatus(admin.ctx, target.user.id, { status: "ACTIVE", reason: "Resolved" });
    expect(await validateSessionToken(fresh)).not.toBeNull();
    const audit = await db().auditLog.findMany({ where: { resourceId: target.user.id, category: "ADMIN" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.action, a.reason])).toEqual([
      ["user.suspended", "Abuse report #12"],
      ["user.reactivated", "Resolved"],
    ]);
  });

  it("guards: reason required, MFA required, no self-suspension, no suspending platform admins, read-only admins cannot manage", async () => {
    const admin = await superAdmin();
    const target = await makeUser();
    await expect(setUserStatus(admin.ctx, target.user.id, { status: "SUSPENDED", reason: "" })).rejects.toThrow(/>=3 characters/); // 400 over HTTP
    await expectCode(setUserStatus(admin.ctx, admin.user.id, { status: "SUSPENDED", reason: "self" }), "validation_error");
    const otherAdmin = await superAdmin();
    await expectCode(setUserStatus(admin.ctx, otherAdmin.user.id, { status: "SUSPENDED", reason: "takeover" }), "conflict");
    await expectCode(setUserStatus(admin.ctx, "not-a-uuid", { status: "SUSPENDED", reason: "x y z" }), "not_found");

    const noMfa = await makeUser({ mfa: false });
    await grant(noMfa.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
    await expectCode(setUserStatus(noMfa.ctx, target.user.id, { status: "SUSPENDED", reason: "no mfa" }), "mfa_required");

    const platformAdmin = await makeUser();
    await grant(platformAdmin.user.id, "PLATFORM_ADMIN", "PLATFORM", PLATFORM_ID);
    expect((await listPlatformUsers(platformAdmin.ctx)).length).toBeGreaterThan(0); // platform.users.read
    await expectCode(setUserStatus(platformAdmin.ctx, target.user.id, { status: "SUSPENDED", reason: "no manage" }), "forbidden");

    const founder = await makeUser();
    await expectCode(setUserStatus(founder.ctx, target.user.id, { status: "SUSPENDED", reason: "tenant user" }), "forbidden");
    expect((await db().user.findUniqueOrThrow({ where: { id: target.user.id } })).status).toBe("ACTIVE");
  });
});
