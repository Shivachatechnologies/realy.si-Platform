import "server-only";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { getControls } from "@/server/core/platform-controls";
import { activeConnection } from "@/server/modules/comms/connections-bridge";
import { companyEmailProvider } from "@/server/modules/email/provider";

/**
 * Which external providers the revenue engine can use for this company right now (all through Integrations):
 * research (lead discovery / enrichment), AI text (drafting, qualification), a connected mailbox or SendGrid (sending)
 * and a calendar (meeting invites). Pages show "not connected" states from this; services re-check before acting.
 */

export interface RevenueChannels {
  research: string[];
  aiText: string[];
  mailbox: { id: string; provider: "gmail" | "outlook"; address: string } | null;
  sendgrid: boolean;
  calendar: "google_calendar" | "outlook_calendar" | null;
}

export async function revenueChannels(organizationId: string, companyId: string): Promise<RevenueChannels> {
  const rows = await db().integrationConnection.findMany({
    where: { organizationId, companyId, provider: { in: ["tavily", "exa", "serpapi", "openai", "gemini"] }, status: { not: "DISCONNECTED" }, credentialsEnc: { not: null } },
    select: { provider: true },
  });
  const have = new Set(rows.map((r) => r.provider));
  const [mailbox, sendgrid, calendar] = await Promise.all([connectedMailbox(organizationId, companyId), companyEmailProvider(organizationId, companyId), connectedCalendar(organizationId, companyId)]);
  return {
    research: ["tavily", "exa", "serpapi"].filter((p) => have.has(p)),
    aiText: ["openai", "gemini"].filter((p) => have.has(p)),
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

/** Platform kill switches for AI features (Admin → Platform Controls). */
export async function aiPaused() {
  const c = await getControls();
  return !c.aiWorkforceEnabled || c.aiExecutionPaused;
}
export async function assertAiAllowed() {
  if (await aiPaused()) throw new AppError("not_available", "AI is paused for the platform right now. Nothing was generated.", { reason: "ai_paused" });
}
