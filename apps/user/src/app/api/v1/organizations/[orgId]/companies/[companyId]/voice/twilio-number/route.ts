import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { connectTwilioNumber, twilioConnectInput } from "@/server/modules/voice/service";

type P = { orgId: string; companyId: string };

/** Point a Twilio number's Voice URL and status callback at Realy. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/voice/twilio-number", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId }) => connectTwilioNumber(ctx, orgId, companyId, await body(req, twilioConnectInput)),
);
