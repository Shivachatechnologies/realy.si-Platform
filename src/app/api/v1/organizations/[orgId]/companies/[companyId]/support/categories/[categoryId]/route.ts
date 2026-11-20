import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { archiveCategory, categoryInput, saveCategory } from "@/server/modules/support/config";

type P = { orgId: string; companyId: string; categoryId: string };

export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/support/categories/:categoryId", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, categoryId }) => saveCategory(ctx, orgId, companyId, categoryId, await body(req, categoryInput)),
);
export const DELETE = route<P>(
  { auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/support/categories/:categoryId", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, categoryId }) => archiveCategory(ctx, orgId, companyId, categoryId),
);
