import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { unlockAllEntitlements } from "@/server/modules/entitlements/admin";
import { getEntitlements } from "@/server/modules/entitlements/service";
import { FEATURE_KEYS, LIMITS } from "@/server/modules/entitlements/catalog";
import { expectCode, makeUser, resetDb } from "../helpers";
import { platformAdmin } from "./admin-d-fixtures";

beforeAll(resetDb);

describe("internal unlock (admin)", () => {
  it("enables every feature, sets Scale limits and extends the trial; refuses non-admins", async () => {
    const owner = await makeUser();
    const org = await createOrganization(owner.ctx, { name: `Unlock ${Math.random()}` });
    await createCompany(owner.ctx, org.id, { name: "Owner Co" });
    await expectCode(unlockAllEntitlements(owner.ctx, { organizationId: org.id, reason: "owner account" }), "forbidden");

    const admin = await platformAdmin("SUPER_ADMIN", { mfa: true });
    const res = await unlockAllEntitlements(admin.ctx, { organizationId: org.id, reason: "owner account" });
    expect(res.trialEndsAt).not.toBeNull();

    const ent = await getEntitlements(org.id);
    for (const f of FEATURE_KEYS) expect(ent.features[f]).toBe(true);
    expect(ent.limits["agents.max"]).toBe(LIMITS["agents.max"].values.scale);
    expect(ent.state).toBe("trial");

    // Re-running replaces the overrides instead of stacking them.
    await unlockAllEntitlements(admin.ctx, { organizationId: org.id, reason: "again" });
    const active = await db().entitlementOverride.count({ where: { organizationId: org.id, revokedAt: null } });
    expect(active).toBe(FEATURE_KEYS.length + Object.keys(LIMITS).length);
    expect(await db().auditLog.count({ where: { organizationId: org.id, action: "entitlements.internal_unlock" } })).toBe(2);
  });
});
