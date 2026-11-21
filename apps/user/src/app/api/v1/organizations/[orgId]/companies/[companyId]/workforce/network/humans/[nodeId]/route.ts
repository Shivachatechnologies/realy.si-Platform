import { route } from "@/server/core/http";
import { notFound } from "@/server/core/errors";
import { humanNode } from "@/server/modules/workforce/live-network";

type P = { orgId: string; companyId: string; nodeId: string };

export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, nodeId }) => {
  const n = await humanNode(ctx, orgId, companyId, decodeURIComponent(nodeId));
  if (!n) throw notFound("Person");
  return n;
});
