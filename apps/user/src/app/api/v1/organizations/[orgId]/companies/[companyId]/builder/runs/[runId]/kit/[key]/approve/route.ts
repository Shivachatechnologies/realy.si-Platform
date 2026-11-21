import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { approveItem } from "@/server/modules/builder/kit";

type P = { orgId: string; companyId: string; runId: string; key: string };

/** POST { approved } — mark the deliverable approved by the founder (or take the approval back). */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/builder/runs/:runId/kit/:key/approve", rateLimits: LIMITS.tenantWrite },
  async ({ req, ctx }, { orgId, companyId, runId, key }) => approveItem(ctx, orgId, companyId, runId, key, (await body(req, z.object({ approved: z.boolean().default(true) }))).approved ?? true),
);
