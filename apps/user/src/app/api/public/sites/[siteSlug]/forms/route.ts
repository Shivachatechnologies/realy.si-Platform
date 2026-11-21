import { body, route } from "@/server/core/http";
import { publicSubmissionInput, submitSiteForm } from "@/server/modules/sites/forms";

type P = { siteSlug: string };
const MIN = 60_000;

/** Public contact / lead form submission from a published site page (no auth). Rate limited per IP; per site in the service. */
export const POST = route<P>(
  {
    auth: "none",
    name: "POST /public/sites/:siteSlug/forms",
    maxBodyBytes: 32 * 1024,
    rateLimits: [
      { name: "site-form:ip", limit: 5, windowMs: MIN, by: "ip" },
      { name: "site-form:ip-hour", limit: 30, windowMs: 60 * MIN, by: "ip" },
    ],
  },
  async ({ req }, { siteSlug }) => submitSiteForm(siteSlug, await body(req, publicSubmissionInput)),
);
