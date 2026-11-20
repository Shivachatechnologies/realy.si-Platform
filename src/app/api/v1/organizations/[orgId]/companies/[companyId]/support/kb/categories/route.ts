import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { kbCategoryInput, listKbCategories, saveKbCategory } from "@/server/modules/support/kb";

type P = { orgId: string; companyId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ({ data: await listKbCategories(ctx, orgId, companyId) }));
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/kb/categories", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => saveKbCategory(ctx, orgId, companyId, null, await body(req, kbCategoryInput)),
);
