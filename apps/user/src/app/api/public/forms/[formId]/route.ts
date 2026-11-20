import { body, route } from "@/server/core/http";
import { publicSubmissionInput, submitForm } from "@/server/modules/marketing/forms";

type P = { formId: string };
const MIN = 60_000;

/** Public lead-capture submission (no auth). Same-origin only (the hosted /f/<formId> page); rate limited per IP and per form. */
export const POST = route<P>(
  {
    auth: "none",
    name: "POST /public/forms/:formId",
    maxBodyBytes: 32 * 1024,
    rateLimits: [
      { name: "public-form:ip", limit: 10, windowMs: MIN, by: "ip" },
      { name: "public-form:ip-hour", limit: 60, windowMs: 60 * MIN, by: "ip" },
    ],
  },
  async ({ req }, { formId }) => submitForm(formId, await body(req, publicSubmissionInput)),
);
