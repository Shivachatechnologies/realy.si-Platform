import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { deleteKbCategory, kbCategoryInput, saveKbCategory } from "@/server/modules/support/kb";

type P = { orgId: string; companyId: string; categoryId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/support/kb/categories/:categoryId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, categoryId }) => saveKbCategory(ctx, orgId, companyId, categoryId, await body(req, kbCategoryInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/support/kb/categories/:categoryId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, categoryId }) => deleteKbCategory(ctx, orgId, companyId, categoryId),
);
