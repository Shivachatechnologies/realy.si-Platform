import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { nudgeKit } from "@/server/modules/builder/kit";

type P = { orgId: string; companyId: string; runId: string };

/** Advance the Founder Kit as far as it can go now (polled by the kit page; the worker job does the same). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/kit/advance", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, runId }) => nudgeKit(ctx, orgId, companyId, runId),
);
