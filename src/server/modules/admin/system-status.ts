import { env } from "@/server/core/env";
import { redis } from "@/server/core/rate-limit";
import { observabilityStatus } from "@/server/core/observability";
import { emailConfigured } from "@/server/modules/email/service";
import { oauthCredentials } from "@/server/modules/auth/oauth";
import { billingConfigured } from "@/server/modules/billing/stripe-billing";

export interface ServiceStatus {
  key: "stripe" | "stripeWebhook" | "email" | "oauthGoogle" | "oauthGithub" | "oauthMicrosoft" | "sentry" | "otel" | "redis";
  configured: boolean;
}

/** Which external services are configured. Booleans only — never values or secrets. */
export async function systemStatus(): Promise<ServiceStatus[]> {
  const obs = observabilityStatus();
  const redisOk = await redis().ping().then((r) => r === "PONG", () => false);
  return [
    { key: "stripe", configured: billingConfigured() },
    { key: "stripeWebhook", configured: !!env().STRIPE_WEBHOOK_SECRET },
    { key: "email", configured: emailConfigured() },
    { key: "oauthGoogle", configured: !!oauthCredentials("google") },
    { key: "oauthGithub", configured: !!oauthCredentials("github") },
    { key: "oauthMicrosoft", configured: !!oauthCredentials("microsoft") },
    { key: "sentry", configured: obs.sentry },
    { key: "otel", configured: obs.otel },
    { key: "redis", configured: redisOk },
  ];
}
