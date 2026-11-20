import "server-only";
import type { RequestContext } from "@/server/core/context";
import { listSubjectTasks } from "@/server/modules/agents/service";
import type { LiveTask } from "./use-agent-task";

/** Latest AI task attached to a subject (for HelpMeButton's `initial`), or null when none or not allowed to see it. */
export async function latestSubjectTask(ctx: RequestContext, organizationId: string, companyId: string, type: string, id: string): Promise<LiveTask | null> {
  const rows = await listSubjectTasks(ctx, organizationId, companyId, type, id, 1).catch(() => []);
  const r = rows[0];
  return r ? { id: r.id, title: r.title, status: r.status, output: r.output, errorMessage: null } : null;
}

/** The intro-strip labels every guided page uses. */
export const introLabels = (t: (k: string) => string) => ({ what: t("guideKit.intro.what"), why: t("guideKit.intro.why"), can: t("guideKit.intro.can"), next: t("guideKit.intro.next") });
