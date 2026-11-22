import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/core/db";
import { createOrganization } from "@/server/modules/organizations/service";
import { createCompany } from "@/server/modules/companies/service";
import { createPost } from "@/server/modules/marketing/social";
import { makeUser, resetDb } from "../helpers";

beforeAll(resetDb);

describe("marketing social posts", () => {
  it("creates a draft post with targets (composite target relation)", async () => {
    const owner = await makeUser();
    const org = await createOrganization(owner.ctx, { name: `Social ${Math.random()}` });
    const company = await createCompany(owner.ctx, org.id, { name: "Social Co" });
    const account = await db().marketingSocialAccount.create({ data: { organizationId: org.id, companyId: company.id, createdById: owner.user.id, provider: "LINKEDIN", name: "LI page" } });
    const post = await createPost(owner.ctx, org.id, company.id, { title: "Launch", text: "We are live.", targets: [{ accountId: account.id }] });
    const targets = await db().marketingSocialPostTarget.findMany({ where: { postId: post.id } });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.companyId).toBe(company.id);
  });
});
