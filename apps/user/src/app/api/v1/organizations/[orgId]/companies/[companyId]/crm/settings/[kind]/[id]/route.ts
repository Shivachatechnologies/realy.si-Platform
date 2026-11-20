import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { configKind, configPatchSchema, deleteConfig, updateConfig } from "@/server/modules/crm/config";

type P = { orgId: string; companyId: string; kind: string; id: string };

export const PATCH = route<P>({ auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/crm/settings/:kind/:id", rateLimits: LIMITS.tenantWrite }, async ({ req, ctx }, { orgId, companyId, kind, id }) => {
  const k = configKind(kind);
  return updateConfig(ctx, orgId, companyId, k, id, await body(req, configPatchSchema(k)));
});
export const DELETE = route<P>({ auth: "required", name: "DELETE /organizations/:orgId/companies/:companyId/crm/settings/:kind/:id", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId, kind, id }) =>
  deleteConfig(ctx, orgId, companyId, configKind(kind), id),
);
