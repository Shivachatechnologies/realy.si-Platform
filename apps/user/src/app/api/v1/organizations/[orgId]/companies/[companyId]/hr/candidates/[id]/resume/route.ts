import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { getResumeFile, MAX_RESUME_BYTES, resumeInput, uploadResume } from "@/server/modules/hr/recruiting";

type P = { orgId: string; companyId: string; id: string };

/** Download the candidate's resume (hr.manage). */
export const GET = route<P>({ auth: "required" }, async ({ ctx }, { orgId, companyId, id }) => {
  const file = await getResumeFile(ctx, orgId, companyId, id);
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
export const POST = route<P>(
  {
    auth: "required",
    name: "POST /organizations/:orgId/companies/:companyId/hr/candidates/:id/resume",
    rateLimits: LIMITS.tenantWrite,
    idempotent: true,
    maxBodyBytes: Math.ceil((MAX_RESUME_BYTES * 4) / 3) + 64 * 1024,
  },
  async ({ req, ctx }, { orgId, companyId, id }) => uploadResume(ctx, orgId, companyId, id, await body(req, resumeInput)),
);
