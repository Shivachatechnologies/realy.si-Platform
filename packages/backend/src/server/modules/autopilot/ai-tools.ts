import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { getAutopilotRoom } from "./service";

/** Autopilot tools (register in tools/modules.ts). Read-only: changing a mode is a person's decision on /autopilot. */
export const AUTOPILOT_TOOLS: Record<string, ToolDefinition> = {
  read_autopilot_status: def({
    name: "read_autopilot_status",
    version: 1,
    description:
      "Returns the company's Autopilot mode (Off, Manual, Assisted, Approval required, Autonomous) for the company and each department, whether all AI is paused, and each department's live work: queued and running tasks, work finished in the last 24 hours and active department autopilots.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["agents.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 20_000,
    actionClass: "read",
    summarize: () => "Read the Autopilot status",
    async execute(_input, { ctx, organizationId, companyId }) {
      const r = await getAutopilotRoom(ctx, organizationId, companyId);
      const lines = [
        `Company mode: ${r.company.mode}${r.paused ? " (ALL AI IS PAUSED)" : ""}. Auto mode of the autonomy policy: ${r.autoModeEnabled ? "on" : "off"}.`,
        ...r.departments.map(
          (d) =>
            `- ${d.key}: ${d.mode}${d.source === "department" ? "" : " (inherited)"}; ${d.running} running, ${d.queued} queued, ${d.done24h} done / ${d.failed24h} failed in 24 h${d.autopilots.length ? `; ${d.autopilots.map((a) => `${a.key} ${a.active}/${a.total} active`).join(", ")}` : ""}`,
        ),
        `Last 24 h: ${r.stats.started24h} proactive starts, ${r.stats.blocked24h} blocked by Autopilot, ${r.stats.autoActions24h} actions done automatically.`,
      ];
      return { content: lines.join("\n"), count: r.departments.length };
    },
  }),
};
