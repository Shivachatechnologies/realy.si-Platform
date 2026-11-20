import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { startSprint } from "@/server/modules/work/agile";

type P = { orgId: string; companyId: string; sprintId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/sprints/:sprintId/start", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, sprintId }) => startSprint(ctx, orgId, companyId, sprintId));
