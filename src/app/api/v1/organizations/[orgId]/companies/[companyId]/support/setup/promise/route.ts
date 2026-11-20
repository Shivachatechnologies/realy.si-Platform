import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { promiseInput, savePromise } from "@/server/modules/support/setup";

type P = { orgId: string; companyId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/support/setup/promise", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId }) =>
  savePromise(ctx, orgId, companyId, await body(req, promiseInput)),
);
