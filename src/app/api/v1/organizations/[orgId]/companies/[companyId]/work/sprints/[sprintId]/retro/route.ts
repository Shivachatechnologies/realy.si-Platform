import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { addRetroItem, retroItemInput } from "@/server/modules/work/agile";

type P = { orgId: string; companyId: string; sprintId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/sprints/:sprintId/retro", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, sprintId }) => addRetroItem(ctx, orgId, companyId, sprintId, await body(req, retroItemInput)));
