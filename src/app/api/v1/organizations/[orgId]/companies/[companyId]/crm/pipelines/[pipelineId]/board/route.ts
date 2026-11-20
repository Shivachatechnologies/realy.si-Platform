import { route } from "@/server/core/http";
import { pipelineBoard } from "@/server/modules/crm/deals";

type P = { orgId: string; companyId: string; pipelineId: string };

/** GET ?owner=&q= — Kanban board of the pipeline. */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, pipelineId }) =>
  pipelineBoard(ctx, orgId, companyId, pipelineId, { owner: req.nextUrl.searchParams.get("owner") ?? undefined, q: req.nextUrl.searchParams.get("q")?.slice(0, 200) || undefined }),
);
