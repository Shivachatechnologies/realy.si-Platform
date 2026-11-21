import { z } from "zod";
import { LIMITS } from "@/server/core/limits";
import { body, route } from "@/server/core/http";
import { notFound } from "@/server/core/errors";
import { completePlaidLink, startPlaidLink } from "@/server/modules/integrations/services/banking";

type P = { orgId: string; companyId: string; provider: string };

const startInput = z.object({ locale: z.string().max(10).default("en-US") });

/** Start linking a bank with Plaid Hosted Link; returns the URL to send the founder to. */
export const POST = route<P>(
  { auth: "required", name: "POST /organizations/:orgId/companies/:companyId/integrations/:provider/bank-link", rateLimits: LIMITS.tenantWrite, idempotent: true },
  async ({ req, ctx }, { orgId, companyId, provider }) => {
    if (provider !== "plaid") throw notFound("Integration");
    const { locale } = startInput.parse(await body(req, startInput));
    return startPlaidLink(ctx, orgId, companyId, locale);
  },
);

/** Finish linking after Plaid redirects back: exchange the session's public tokens and store the banks encrypted. */
export const PUT = route<P>(
  { auth: "required", name: "PUT /organizations/:orgId/companies/:companyId/integrations/:provider/bank-link", rateLimits: LIMITS.tenantWrite },
  async ({ ctx }, { orgId, companyId, provider }) => {
    if (provider !== "plaid") throw notFound("Integration");
    return completePlaidLink(ctx, orgId, companyId);
  },
);
