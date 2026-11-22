import { forbidden } from "@/server/core/errors";
import { customerConnectMode, providerInfo } from "./catalog";

/**
 * What customers may do with integrations in the user app (docs/integrations.md "Who manages what"). Everything
 * API-related — provider credentials, connection settings, Realy API keys, inbound and outbound webhooks — is managed
 * by the platform admin in the Control Center. The only customer action is an OAuth login to the customer's OWN
 * account (Google, Slack, HubSpot, …): a plain Connect / Disconnect button and the connection status.
 *
 * The backend services stay as they are; the user app's routes refuse these writes with 403 and the admin app calls
 * the same services on the organization's behalf (modules/admin/org-integrations.ts).
 */

/** The provider has an OAuth path to the customer's own account (the only thing the customer connects). */
export function hasCustomerOAuth(provider: string): boolean {
  const info = providerInfo(provider);
  return !!info && customerConnectMode(info) === "oauth";
}

export type AdminManagedArea = "credentials" | "settings" | "api_keys" | "webhooks" | "connection";

const MESSAGES: Record<AdminManagedArea, string> = {
  credentials: "API keys and credentials are managed by Realy. Customers never enter them; connect your own accounts with the Connect button.",
  settings: "Integration settings are managed by the Realy platform administrator.",
  api_keys: "Realy API keys are not available to customers.",
  webhooks: "Webhooks are managed by the Realy platform administrator.",
  connection: "This integration cannot be connected or disconnected here. Only accounts you sign in to with Connect can be.",
};

/** 403 for a customer-side API / credential control (user app). */
export function adminManaged(area: AdminManagedArea, details: Record<string, unknown> = {}) {
  return forbidden(MESSAGES[area], { reason: "integrations_admin_managed", area, ...details });
}
