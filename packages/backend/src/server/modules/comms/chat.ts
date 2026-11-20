import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { authorize, isUuid, plainMentions } from "./common";
import { activeConnection } from "./connections-bridge";
import { ProviderError, slackPost, teamsPost } from "./providers";

export const CHAT_PROVIDERS = ["slack", "microsoft_teams"] as const;
export const shareInput = z.object({ provider: z.enum(CHAT_PROVIDERS), subjectType: z.enum(["announcement", "meeting"]), subjectId: z.string().uuid() });

async function content(ctx: RequestContext, organizationId: string, companyId: string, type: "announcement" | "meeting", id: string) {
  if (type === "announcement") {
    const a = await db().commsAnnouncement.findFirst({ where: { id, organizationId, companyId, status: "PUBLISHED" } });
    if (!a) throw notFound("Announcement");
    return { title: a.title, text: plainMentions(a.body) };
  }
  const m = await db().commsMeeting.findFirst({ where: { id, organizationId, companyId } });
  if (!m) throw notFound("Meeting");
  // Prefer the latest completed AI summary; otherwise the decisions and notes written by people.
  const summary = (await listSubjectTasks(ctx, organizationId, companyId, "meeting", id, 10).catch(() => [])).find((t) => t.status === "COMPLETED" && t.output);
  const parts = summary?.output
    ? [summary.output]
    : [m.decisions.length ? `Decisions:\n${m.decisions.map((d) => `• ${d}`).join("\n")}` : "", m.notes ? `Notes:\n${m.notes}` : ""].filter(Boolean);
  return { title: `Meeting: ${m.title}`, text: parts.join("\n\n").slice(0, 3500) || m.title };
}

/** Post an announcement or meeting summary to the connected Slack / Teams channel. Logged with the provider's answer. */
export async function shareToChat(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof shareInput>) {
  const input = shareInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "communication.post");
  if (!isUuid(input.subjectId)) throw notFound("Record");
  const c = await content(ctx, organizationId, companyId, input.subjectType, input.subjectId);
  const conn = await activeConnection(organizationId, companyId, input.provider);
  let status: "SENT" | "FAILED" | "NOT_CONNECTED" = "NOT_CONNECTED";
  let externalId: string | null = null;
  let error: string | null = null;
  if (conn) {
    try {
      externalId = (input.provider === "slack" ? await slackPost(conn, `*${c.title}*\n\n${c.text}`) : await teamsPost(conn, c.title, c.text)).externalId;
      status = "SENT";
    } catch (err) {
      status = "FAILED";
      error = err instanceof ProviderError ? err.message.slice(0, 300) : "post failed";
    }
  }
  return transaction(async (tx) => {
    const row = await tx.commsChatPost.create({
      data: { organizationId, companyId, provider: input.provider, subjectType: input.subjectType, subjectId: input.subjectId, status, externalId, error, createdById: ctx.actor.id },
    });
    if (status !== "NOT_CONNECTED") {
      await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "comms.chat.posted", resourceType: input.subjectType, resourceId: input.subjectId, newValue: { provider: input.provider, status } });
    }
    return { id: row.id, status, error };
  });
}

export async function listChatPosts(ctx: RequestContext, organizationId: string, companyId: string, subjectType: string, subjectId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  return db().commsChatPost.findMany({ where: { organizationId, companyId, subjectType, subjectId }, orderBy: { createdAt: "desc" }, take: 10 });
}
