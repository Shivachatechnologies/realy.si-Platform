import { notFound } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { projectReport } from "@/server/modules/work/delivery";

type P = { orgId: string; companyId: string; projectId: string };

/** Project status report export (Markdown, from the project's real tasks, milestones and risks). */
export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/companies/:companyId/work/projects/:projectId/report" }, async ({ ctx }, { orgId, companyId, projectId }) => {
  const r = await projectReport(ctx, orgId, companyId, projectId);
  if (!r) throw notFound("Project");
  const file = `${r.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project"}-status.md`;
  return new Response(r.markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${encodeURIComponent(file)}"`, "cache-control": "no-store" } });
});
