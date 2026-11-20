import { body, route } from "@/server/core/http";
import { joinWaitlist, waitlistInput } from "@/server/modules/site/waitlist";

const MIN = 60_000;

/** Public waitlist sign-up from the marketing site (no auth). Rate limited per IP and per submitted email; idempotent per email. */
export const POST = route(
  {
    auth: "none",
    name: "POST /public/waitlist",
    idempotent: true,
    maxBodyBytes: 16 * 1024,
    rateLimits: [
      { name: "waitlist:ip", limit: 5, windowMs: MIN, by: "ip" },
      { name: "waitlist:ip-hour", limit: 30, windowMs: 60 * MIN, by: "ip" },
      { name: "waitlist:email", limit: 3, windowMs: 60 * MIN, by: { bodyField: "email" } },
    ],
  },
  async ({ req }) => joinWaitlist(await body(req, waitlistInput)),
);
