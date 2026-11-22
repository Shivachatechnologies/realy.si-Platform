import { db } from "@/server/core/db";
import { isUuid } from "../../access";
import { ciContains, defineSearchProvider } from "../types";

/** Stream C: AI tasks (id/title). */
export const aiSearch = defineSearchProvider({
  group: "ai",
  perms: ["platform.ai.read"],
  empty: { tasks: [] as { id: string; title: string; status: string; organizationId: string }[] },
  async search(_ctx, q) {
    const tasks = await db().agentTask.findMany({ where: isUuid(q) ? { id: q } : { title: ciContains(q) }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, organizationId: true } });
    return { tasks };
  },
});
