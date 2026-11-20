import { LIMITS } from "@/server/core/limits";
import { route } from "@/server/core/http";
import { retroActionToTask } from "@/server/modules/work/agile";

type P = { orgId: string; companyId: string; itemId: string };

export const POST = route<P>({ auth: "required", name: "POST /organizations/:orgId/companies/:companyId/work/retro/:itemId/task", rateLimits: LIMITS.tenantWrite, idempotent: true }, async ({ ctx }, { orgId, companyId, itemId }) => retroActionToTask(ctx, orgId, companyId, itemId));
