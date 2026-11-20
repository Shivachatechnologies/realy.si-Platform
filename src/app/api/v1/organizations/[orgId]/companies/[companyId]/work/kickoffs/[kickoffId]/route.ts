import { route } from "@/server/core/http";
import { getKickoff } from "@/server/modules/work/kickoff";

type P = { orgId: string; companyId: string; kickoffId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, kickoffId }) => getKickoff(ctx, orgId, companyId, kickoffId));
