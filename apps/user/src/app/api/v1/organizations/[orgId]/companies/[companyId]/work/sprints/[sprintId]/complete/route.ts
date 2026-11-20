import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { completeSprint, completeSprintInput } from "@/server/modules/work/agile";

type P = { orgId: string; companyId: string; sprintId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/sprints/:sprintId/complete", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ req, ctx }, { orgId, companyId, sprintId }) => completeSprint(ctx, orgId, companyId, sprintId, await body(req, completeSprintInput)));
