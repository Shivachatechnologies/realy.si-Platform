import { z } from "zod";
import { db } from "@/server/core/db";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { composeBriefing } from "./compose";
import { factsFor } from "./summary";
import { periodFor, validTimeZone } from "./time";

/** AI tools of the briefing module (register in src/server/modules/tools/modules.ts). */
export const BRIEFING_TOOLS: Record<string, ToolDefinition> = {
  read_founder_briefing: def({
    name: "read_founder_briefing",
    version: 1,
    description:
      "Returns the founder briefing figures for yesterday, today so far or the last 7 days: AI work by department, emails/posts/meetings, leads, deals, KPIs with change, failures and blockers, approvals waiting, today's plan, risks and recommended decisions. Only figures the requester may see.",
    input: z.object({ period: z.enum(["yesterday", "today", "week"]).optional() }).strict(),
    modelSchema: { type: "object", properties: { period: { type: "string", enum: ["yesterday", "today", "week"], description: "Default yesterday." } }, required: [], additionalProperties: false },
    permissions: ["analytics.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 90_000,
    summarize: () => "Read the founder briefing",
    async execute({ period }, x) {
      const userId = x.ctx.actor.id;
      const [user, company, sub] = await Promise.all([
        userId ? db().user.findUnique({ where: { id: userId }, select: { timezone: true, locale: true } }) : null,
        db().company.findFirst({ where: { id: x.companyId, organizationId: x.organizationId }, select: { name: true, timezone: true } }),
        userId ? db().briefingSubscription.findFirst({ where: { organizationId: x.organizationId, companyId: x.companyId, userId }, select: { timezone: true } }) : null,
      ]);
      const tz = [sub?.timezone, user?.timezone, company?.timezone].find((z): z is string => !!z && validTimeZone(z)) ?? "UTC";
      const kind = period === "today" ? "EVENING" : period === "week" ? "WEEKLY" : "MORNING";
      const p = periodFor(kind, new Date(), tz);
      const data = await composeBriefing(x.ctx, x.organizationId, x.companyId, { kind, from: p.from, to: p.to, days: p.days, timezone: tz });
      return { content: factsFor(data, "en-US", company?.name ?? ""), records: (data.approvals?.items ?? []).map((a) => `approval:${a.id}`) };
    },
  }),
};
