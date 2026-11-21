import { route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { exportMemory } from "@/server/modules/brain/memory-store";

type P = { orgId: string; companyId: string };

/** JSON export of the shared memory the viewer may read (brain.manage; audited). */
export const GET = route<P>({ auth: "required", name: "GET /organizations/:orgId/companies/:companyId/brain/memory/export", rateLimits: LIMITS.tenantWrite }, async ({ ctx }, { orgId, companyId }) => {
  const data = await exportMemory(ctx, orgId, companyId);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="company-memory-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
});
