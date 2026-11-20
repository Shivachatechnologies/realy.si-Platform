import { route } from "@/server/core/http";
import { listDelegations } from "@/server/modules/workforce/delegation";

type P = { orgId: string; companyId: string };

/** Delegations proposed by supervised AI managers (?status=PROPOSED|CREATED|REJECTED|FAILED). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId }) => ({
  items: await listDelegations(ctx, orgId, companyId, Object.fromEntries(req.nextUrl.searchParams)),
}));
