import { route } from "@/server/core/http";
import { executionStatus } from "@/server/modules/work/execution";

type P = { orgId: string; companyId: string; projectId: string };

/** Execution tracking of one project (progress, ready/blocked work, root blockers, computed health). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, projectId }) => executionStatus(ctx, orgId, companyId, projectId));
