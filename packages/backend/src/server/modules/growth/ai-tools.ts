import { z } from "zod";
import { db } from "@/server/core/db";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { listInsights } from "./service";
import { GROWTH_SIGNALS } from "./signals";

/** AI tools of the growth module (registered through BI_TOOLS, see bi/ai-tools.ts). */
export const GROWTH_TOOLS: Record<string, ToolDefinition> = {
  read_growth_insights: def({
    name: "read_growth_insights",
    version: 1,
    description: "Returns the growth engine's insights: signals detected from the company's data (no customers, low conversion, revenue decline, delayed projects, complaints up, strong campaigns, decision overload) with evidence, status and the AI work assigned.",
    input: z.object({ status: z.enum(["OPEN", "ACTED", "DISMISSED"]).optional(), signal: z.enum(GROWTH_SIGNALS).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["OPEN", "ACTED", "DISMISSED"] }, signal: { type: "string", enum: [...GROWTH_SIGNALS] } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["agents.read", "analytics.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read growth insights",
    async execute(input, { ctx, organizationId, companyId }) {
      const page = await listInsights(ctx, organizationId, companyId, { ...input, limit: 30 });
      if (!page.data.length) return { content: "No growth insights match.", count: 0 };
      const settings = await db().growthSettings.findUnique({ where: { companyId }, select: { autonomy: true } });
      const lines = page.data.map(
        (i) =>
          `- ${i.id} [${i.status}, ${i.severity}] ${i.signal} (${i.weekKey}) evidence ${JSON.stringify(i.evidence)}${i.task ? `; task ${i.task.id} ${i.task.status}` : ""}${i.aiEmployee ? ` by ${i.aiEmployee.name}` : ""}${i.note ? `; note ${i.note}` : ""}`,
      );
      return { content: `Growth autonomy: ${settings?.autonomy ?? "RECOMMEND"}\n${lines.join("\n")}`, count: page.data.length, records: page.data.map((i) => `growth_insight:${i.id}`) };
    },
  }),
};
