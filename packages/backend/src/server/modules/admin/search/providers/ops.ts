import { db } from "@/server/core/db";
import { canPlatform } from "../../access";
import { ciContains, defineSearchProvider } from "../types";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stream E: incidents (title or #number), alerts (title, rule), error groups (name, message, route) and job runs
 * (job name, BullMQ job id, run id). Each group is filtered by its own read permission.
 */
export const opsSearch = defineSearchProvider({
  group: "ops",
  perms: ["platform.controls.manage", "platform.security.read", "platform.audit.read", "platform.incidents.read", "platform.logs.read"],
  empty: {
    incidents: [] as { id: string; number: number; title: string; status: string; severity: string }[],
    alerts: [] as { id: string; title: string; status: string; severity: string; rule: string }[],
    errorGroups: [] as { id: string; name: string; message: string; status: string; count: number }[],
    jobRuns: [] as { id: string; queue: string; jobName: string; status: string }[],
  },
  async search(ctx, q) {
    const [incidents, alerts, errors, jobs] = await Promise.all([
      canPlatform(ctx, "platform.incidents.read"),
      Promise.all([canPlatform(ctx, "platform.incidents.read"), canPlatform(ctx, "platform.alerts.manage")]).then((r) => r.some(Boolean)),
      Promise.all([canPlatform(ctx, "platform.logs.read"), canPlatform(ctx, "platform.incidents.read")]).then((r) => r.some(Boolean)),
      Promise.all(["platform.security.read", "platform.organizations.read", "platform.controls.manage"].map((p) => canPlatform(ctx, p))).then((r) => r.some(Boolean)),
    ]);
    const num = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
    const id = uuidRe.test(q) ? q : null;
    const [inc, al, eg, jr] = await Promise.all([
      incidents ? db().platformIncident.findMany({ where: { OR: [{ title: ciContains(q) }, ...(num ? [{ number: num }] : []), ...(id ? [{ id }] : [])] }, orderBy: { detectedAt: "desc" }, take: 5, select: { id: true, number: true, title: true, status: true, severity: true } }) : [],
      alerts ? db().platformAlert.findMany({ where: { OR: [{ title: ciContains(q) }, { rule: ciContains(q) }, ...(id ? [{ id }] : [])] }, orderBy: { lastSeenAt: "desc" }, take: 5, select: { id: true, title: true, status: true, severity: true, rule: true } }) : [],
      errors ? db().errorGroup.findMany({ where: { OR: [{ name: ciContains(q) }, { message: ciContains(q) }, { route: ciContains(q) }, ...(id ? [{ id }] : [])] }, orderBy: { lastSeenAt: "desc" }, take: 5, select: { id: true, name: true, message: true, status: true, count: true } }) : [],
      jobs ? db().workerJobRun.findMany({ where: { OR: [{ jobName: ciContains(q) }, { jobId: q }, ...(id ? [{ id }] : [])] }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, queue: true, jobName: true, status: true } }) : [],
    ]);
    return { incidents: inc, alerts: al, errorGroups: eg.map((g) => ({ ...g, message: g.message.slice(0, 120) })), jobRuns: jr };
  },
});
