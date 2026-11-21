import { route } from "@/server/core/http";
import { liveSignals } from "@/server/modules/workforce/live-network";

type P = { orgId: string; companyId: string };

/** Live signals (tasks, delegations, approvals, calls, escalations) since ?since= (≤ 10 minutes back). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => liveSignals(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)));
