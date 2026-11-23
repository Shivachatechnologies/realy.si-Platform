import { db } from "@/server/core/db";
import { AI_PROVIDERS } from "@/server/modules/agents/providers/catalog";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { isUuid } from "../../access";
import { ciContains, defineSearchProvider } from "../types";

/** Stream C: AI tasks, AI employees, workflows (by id or name), models and providers (static catalog). */
export const aiSearch = defineSearchProvider({
  group: "ai",
  perms: ["platform.ai.read", "platform.ai.manage"],
  empty: {
    tasks: [] as { id: string; title: string; status: string; organizationId: string }[],
    aiEmployees: [] as { id: string; name: string; status: string; profileKey: string; organizationId: string }[],
    workflows: [] as { id: string; name: string; status: string; organizationId: string }[],
    aiModels: [] as { id: string; provider: string }[],
    aiProviders: [] as { key: string; label: string }[],
  },
  async search(_ctx, q) {
    const byId = isUuid(q);
    const low = q.toLowerCase();
    const [tasks, aiEmployees, workflows] = await Promise.all([
      db().agentTask.findMany({ where: byId ? { id: q } : { title: ciContains(q) }, take: 8, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, organizationId: true } }),
      db().aiEmployee.findMany({ where: byId ? { id: q } : { name: ciContains(q), archivedAt: null }, take: 6, orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true, profileKey: true, organizationId: true } }),
      db().workflow.findMany({ where: byId ? { id: q } : { name: ciContains(q) }, take: 6, orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true, organizationId: true } }),
    ]);
    const aiModels = byId ? [] : Object.keys(MODEL_PRICES).filter((m) => m.includes(low)).slice(0, 6).map((id) => ({ id, provider: AI_PROVIDERS.find((p) => p.match(id))?.key ?? "anthropic" }));
    const aiProviders = byId ? [] : AI_PROVIDERS.filter((p) => p.key.includes(low) || p.label.toLowerCase().includes(low)).map((p) => ({ key: p.key, label: p.label }));
    return { tasks, aiEmployees, workflows, aiModels, aiProviders };
  },
});
