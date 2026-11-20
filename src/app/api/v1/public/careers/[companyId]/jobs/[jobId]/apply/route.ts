import { body, route } from "@/server/core/http";
import { applyInput, applyToJob } from "@/server/modules/hr/careers";
import { MAX_RESUME_BYTES } from "@/server/modules/hr/recruiting";

const HOUR = 60 * 60_000;

/** Public job application (careers page): no sign-in, rate limited per IP and per applicant email. */
export const POST = route<{ companyId: string; jobId: string }>(
  {
    auth: "none",
    name: "POST /public/careers/:companyId/jobs/:jobId/apply",
    rateLimits: [
      { name: "careers-apply:ip", limit: 10, windowMs: HOUR, sensitive: true, by: "ip" },
      { name: "careers-apply:email", limit: 5, windowMs: HOUR, sensitive: true, by: { bodyField: "email" } },
    ],
    maxBodyBytes: Math.ceil((MAX_RESUME_BYTES * 4) / 3) + 64 * 1024,
  },
  async ({ req, requestId }, { companyId, jobId }) => applyToJob(companyId, jobId, await body(req, applyInput), requestId),
);
