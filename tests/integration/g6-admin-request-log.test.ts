import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/core/db";
import { userContext } from "@/server/core/context";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { adminIntegrationRequestLogs } from "@/server/modules/admin/org-integrations";
import { recordTenantView } from "@/server/modules/admin/tenants";
import { PLATFORM_ID } from "@/server/modules/rbac/scope";
import { expectCode, grant, makeUser, resetDb } from "../helpers";

// B34: admin integration request-log viewer (platform permission + audited tenant-view grant, filters, cursor pages).

beforeAll(resetDb);

describe("admin integration request log", () => {
  it("is cross-tenant only for platform staff who opened the organization with a reason", async () => {
    const owner = await makeUser();
    const org = await createOrganization(owner.ctx, { name: `Logs ${Math.random()}` });
    const company = await createCompany(owner.ctx, org.id, { name: "Logs Co" });
    const conn = await db().integrationConnection.create({ data: { organizationId: org.id, companyId: company.id, provider: "slack", status: "CONNECTED", connectedById: owner.user.id } });
    for (let i = 0; i < 5; i++) {
      await db().integrationRequestLog.create({
        data: { organizationId: org.id, companyId: company.id, connectionId: conn.id, provider: "slack", method: "POST", url: "slack.com/api/chat.postMessage", status: i === 4 ? 500 : 200, durationMs: 10 + i, attempts: i === 4 ? 3 : 1, requestSummary: "JSON body, 2 keys" },
      });
    }

    // The organization's own owner is not platform staff.
    await expectCode(adminIntegrationRequestLogs(owner.ctx, org.id), "forbidden");

    const staff = await makeUser({ name: "Realy Support" });
    await grant(staff.user.id, "SUPER_ADMIN", "PLATFORM", PLATFORM_ID);
    const ctx = userContext(staff.user.id, { mfaVerifiedAt: new Date(), sessionId: randomUUID() });
    // Platform permission alone is not enough: the tenant view must be opened (and audited) first.
    await expectCode(adminIntegrationRequestLogs(ctx, org.id), "forbidden");
    await recordTenantView(ctx, org.id, { reason: "customer reported failing Slack posts" });

    const first = await adminIntegrationRequestLogs(ctx, org.id, { limit: 3 });
    expect(first.data).toHaveLength(3);
    expect(first.data[0]!.status).toBe(500); // newest first
    expect(first.nextCursor).toBe(first.data[2]!.id);
    const second = await adminIntegrationRequestLogs(ctx, org.id, { limit: 3, cursor: first.nextCursor! });
    expect(second.data).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(first.providers).toEqual(["slack"]);
    expect(first.companies).toEqual([{ id: company.id, name: "Logs Co" }]);

    const errors = await adminIntegrationRequestLogs(ctx, org.id, { outcome: "errors" });
    expect(errors.data.map((r) => r.status)).toEqual([500]);
    expect((await adminIntegrationRequestLogs(ctx, org.id, { provider: "hubspot" })).data).toEqual([]);
    // Junk filters are ignored, never thrown at the page.
    expect((await adminIntegrationRequestLogs(ctx, org.id, { provider: "../../x", companyId: "nope" })).data).toHaveLength(5);
  });
});
