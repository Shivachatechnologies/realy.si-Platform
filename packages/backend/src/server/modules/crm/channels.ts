import "server-only";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { getControls } from "@/server/core/platform-controls";
import { activeConnection } from "@/server/modules/comms/connections-bridge";
import { companyEmailProvider } from "@/server/modules/email/provider";
import { isCompanyAiPaused } from "@/server/modules/workforce/autonomy-policy";

/**
 * Which external providers the revenue engine can use for this company right now (all through Integrations):
 * research (lead discovery / enrichment), AI text (drafting, qualification), a connected mailbox or SendGrid (sending)
 * and a calendar (meeting invites). Pages show "not connected" states from this; services re-check before acting.
 */

export interface RevenueChannels {
  research: string[];
  aiText: string[];
  /** Contact-data providers (prospecting: decision makers, verified emails). */
  contacts: string[];
  mailbox: { id: string; provider: "gmail" | "outlook"; address: string } | null;
  sendgrid: boolean;
  calendar: "google_calendar" | "outlook_calendar" | null;
}

export async function revenueChannels(organizationId: string, companyId: string): Promise<RevenueChannels> {
  // Research, AI text and contact data run on the platform's keys (platform-managed providers).
  const { availablePlatformProviders } = await import("@/server/modules/integrations/platform-managed");
  const have = new Set<string>(await availablePlatformProviders(["tavily", "exa", "serpapi", "openai", "gemini", "apollo", "hunter", "pdl"]));
  const [mailbox, sendgrid, calendar] = await Promise.all([connectedMailbox(organizationId, companyId), companyEmailProvider(organizationId, companyId), connectedCalendar(organizationId, companyId)]);
  return {
    research: ["tavily", "exa", "serpapi"].filter((p) => have.has(p)),
    aiText: ["openai", "gemini"].filter((p) => have.has(p)),
    contacts: ["apollo", "hunter", "pdl"].filter((p) => have.has(p)),
    mailbox: mailbox ? { id: mailbox.id, provider: mailbox.provider, address: mailbox.address } : null,
    sendgrid: sendgrid?.scope === "company",
    calendar,
  };
}

/** The company's first mailbox whose Google / Microsoft connection is active. */
export async function connectedMailbox(organizationId: string, companyId: string) {
  const accounts = await db().commsEmailAccount.findMany({ where: { organizationId, companyId, provider: { in: ["gmail", "outlook"] } }, orderBy: { createdAt: "asc" }, take: 5 });
  for (const a of accounts) {
    const conn = await activeConnection(organizationId, companyId, a.provider as "gmail" | "outlook");
    if (conn) return { id: a.id, provider: a.provider as "gmail" | "outlook", address: a.address, conn };
  }
  return null;
}

export async function connectedCalendar(organizationId: string, companyId: string) {
  for (const p of ["google_calendar", "outlook_calendar"] as const) if (await activeConnection(organizationId, companyId, p)) return p;
  return null;
}

/**
 * Kill switches for AI features: the platform's (Admin → Platform Controls) and, when a company is given, the company's
 * own "Pause all AI" (Autonomy). Every AI step of the revenue engine checks this before generating or sending anything.
 */
export async function aiPaused(organizationId?: string, companyId?: string) {
  const c = await getControls();
  if (!c.aiWorkforceEnabled || c.aiExecutionPaused) return true;
  return !!organizationId && !!companyId && (await isCompanyAiPaused(organizationId, companyId));
}
export async function assertAiAllowed(organizationId?: string, companyId?: string) {
  const c = await getControls();
  if (!c.aiWorkforceEnabled || c.aiExecutionPaused) throw new AppError("not_available", "AI is paused for the platform right now. Nothing was generated.", { reason: "ai_paused" });
  if (organizationId && companyId && (await isCompanyAiPaused(organizationId, companyId)))
    throw new AppError("not_available", "All AI in this company is paused (Autonomy → Pause all AI). Nothing was generated.", { reason: "company_ai_paused" });
}
