import { body, route } from "@/server/core/http";
import { isAppLocale, DEFAULT_LOCALE } from "@/i18n/config";
import { createPublicTicket, publicTicketInput } from "@/server/modules/support/tickets";

const MIN = 60_000;

/** Public support form (no login). Rate limited per IP and per submitted email; honeypot field `website`. */
export const POST = route<{ companyId: string }>(
  {
    auth: "none",
    name: "POST /public/support/:companyId/tickets",
    rateLimits: [
      { name: "support-form:ip", limit: 5, windowMs: 15 * MIN, sensitive: true, by: "ip" },
      { name: "support-form:email", limit: 5, windowMs: 60 * MIN, by: { bodyField: "email" } },
    ],
  },
  async ({ req }, { companyId }) => {
    const locale = req.nextUrl.searchParams.get("locale");
    return createPublicTicket(companyId, await body(req, publicTicketInput), isAppLocale(locale) ? locale : DEFAULT_LOCALE);
  },
);
