import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { editInput, editItem } from "@/server/modules/builder/kit";

type P = { orgId: string; companyId: string; runId: string; key: string };

/** PATCH { content?, data? } — save the founder's edited version of a deliverable (structured part validated). */
export const PATCH = route<P>(
  { auth: "required", name: "PATCH /organizations/:orgId/companies/:companyId/builder/runs/:runId/kit/:key", rateLimits: LIMITS.tenantWrite, maxBodyBytes: 512 * 1024 },
  async ({ req, ctx }, { orgId, companyId, runId, key }) => editItem(ctx, orgId, companyId, runId, key, await body(req, editInput)),
);
