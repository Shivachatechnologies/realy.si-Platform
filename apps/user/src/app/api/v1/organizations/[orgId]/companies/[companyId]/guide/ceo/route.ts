import { route } from "@/server/core/http";
import { ceoOverview } from "@/server/modules/guide/ceo";

type P = { orgId: string; companyId: string };

/** GET — the AI CEO's week: priorities, delegated work and why, outcomes, decisions for the founder, last review. */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId }) => ceoOverview(ctx, orgId, companyId));
