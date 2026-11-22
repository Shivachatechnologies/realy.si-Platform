import { route } from "@/server/core/http";
import { adminOwnAccountStatus } from "@/server/modules/admin/org-integrations";

/** Status of the organization's own Stripe / Razorpay / WhatsApp / Mailchimp accounts per company (never credentials). */
export const GET = route<{ orgId: string }>({ auth: "required" }, async ({ ctx }, { orgId }) => adminOwnAccountStatus(ctx, orgId));
