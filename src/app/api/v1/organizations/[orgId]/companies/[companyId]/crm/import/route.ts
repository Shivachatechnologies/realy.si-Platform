import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { importCsv, importInput } from "@/server/modules/crm/csv";

type P = { orgId: string; companyId: string };

/** POST { entity, csv, mode: "preview" | "commit" } */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/crm/import", rateLimits: LIMITS.tenantWrite, idempotent: true, maxBodyBytes: 2_500_000 },
  async ({ req, ctx }, { orgId, companyId }) => importCsv(ctx, orgId, companyId, await body(req, importInput)),
);
