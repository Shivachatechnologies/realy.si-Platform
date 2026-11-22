import { z } from "zod";
import { db, Prisma, transaction, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { pageInput, prismaPage, toPage } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { reasonSchema, requireAnyPlatform, requirePlatform } from "./access";
import { notifyAdmins } from "./notifications";
import { HEALTH_SERVICE_KEYS } from "./health";

/**
 * Incident center (stream E). Incidents are opened by an admin, or by the alert engine when a detection rule marked
 * `autoIncident` fires (alerts.ts). Lifecycle: DETECTED → INVESTIGATING → IDENTIFIED → MITIGATING → MONITORING →
 * RESOLVED → CLOSED. Steps may be skipped forward; a RESOLVED incident can be reopened; CLOSED is final. Closing a
 * SEV1/SEV2 needs a published postmortem. Every change writes a timeline entry and an audit event with a reason.
 */

export const INCIDENT_READ = ["platform.incidents.read", "platform.incidents.manage"];
export const INCIDENT_MANAGE = "platform.incidents.manage";

export const INCIDENT_STATUSES = ["DETECTED", "INVESTIGATING", "IDENTIFIED", "MITIGATING", "MONITORING", "RESOLVED", "CLOSED"] as const;
export const INCIDENT_SEVERITIES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

const ORDER = Object.fromEntries(INCIDENT_STATUSES.map((s, i) => [s, i])) as Record<IncidentStatus, number>;

/** Allowed next statuses: any later step, reopen from RESOLVED (back to an active step), nothing after CLOSED. */
export function nextStatuses(from: IncidentStatus): IncidentStatus[] {
  if (from === "CLOSED") return [];
  if (from === "RESOLVED") return ["INVESTIGATING", "IDENTIFIED", "MITIGATING", "MONITORING", "CLOSED"];
  return INCIDENT_STATUSES.filter((s) => ORDER[s] > ORDER[from] && s !== "CLOSED");
}

const TIMESTAMP: Partial<Record<IncidentStatus, "acknowledgedAt" | "identifiedAt" | "mitigatedAt" | "resolvedAt" | "closedAt">> = {
  INVESTIGATING: "acknowledgedAt",
  IDENTIFIED: "identifiedAt",
  MITIGATING: "mitigatedAt",
  MONITORING: "mitigatedAt",
  RESOLVED: "resolvedAt",
  CLOSED: "closedAt",
};

const uuid = z.string().uuid();
const services = z.array(z.string().refine((s) => HEALTH_SERVICE_KEYS.includes(s), "Unknown service")).max(20);
const orgIds = z.array(uuid).max(200);
const text = (max: number) => z.string().trim().max(max);

export const incidentFilters = pageInput.extend({
  status: z.enum(INCIDENT_STATUSES).optional(),
  state: z.enum(["active", "resolved", "all"]).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  service: z.string().max(40).optional(),
  q: z.string().trim().max(200).optional(),
});

export async function listIncidents(ctx: RequestContext, raw: z.input<typeof incidentFilters> = {}) {
  await requireAnyPlatform(ctx, INCIDENT_READ);
  const f = incidentFilters.parse(raw);
  const num = f.q && /^#?\d{1,9}$/.test(f.q) ? Number(f.q.replace("#", "")) : null;
  const where: Prisma.PlatformIncidentWhereInput = {
    ...(f.status ? { status: f.status } : f.state === "active" ? { status: { notIn: ["RESOLVED", "CLOSED"] } } : f.state === "resolved" ? { status: { in: ["RESOLVED", "CLOSED"] } } : {}),
    ...(f.severity ? { severity: f.severity } : {}),
    ...(f.service ? { services: { has: f.service } } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, ...(num ? [{ number: num }] : [])] } : {}),
  };
  const [rows, byStatus] = await Promise.all([
    db().platformIncident.findMany({ where, orderBy: { id: "desc" }, ...prismaPage(f) }),
    db().platformIncident.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const page = toPage(rows, f);
  const owners = await usersById(page.data.map((i) => i.ownerId));
  return {
    ...page,
    data: page.data.map((i) => ({ ...i, owner: i.ownerId ? (owners.get(i.ownerId) ?? null) : null })),
    counts: Object.fromEntries(INCIDENT_STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0])) as Record<IncidentStatus, number>,
  };
}

async function usersById(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((v): v is string => !!v))];
  if (!list.length) return new Map<string, { id: string; name: string; email: string }>();
  const rows = await db().user.findMany({ where: { id: { in: list } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u]));
}

export async function getIncident(ctx: RequestContext, id: string) {
  await requireAnyPlatform(ctx, INCIDENT_READ);
  if (!uuid.safeParse(id).success) throw notFound("Incident");
  const incident = await db().platformIncident.findUnique({ where: { id }, include: { updates: { orderBy: { createdAt: "asc" }, take: 500 } } });
  if (!incident) throw notFound("Incident");
  const [alerts, errorGroups, orgs, people] = await Promise.all([
    db().platformAlert.findMany({ where: { incidentId: id }, orderBy: { lastSeenAt: "desc" }, take: 50, select: { id: true, title: true, rule: true, severity: true, status: true, count: true, service: true, lastSeenAt: true } }),
    db().errorGroup.findMany({ where: { incidentId: id }, orderBy: { lastSeenAt: "desc" }, take: 20, select: { id: true, name: true, message: true, status: true, count: true, lastSeenAt: true } }),
    incident.affectedOrganizationIds.length ? db().organization.findMany({ where: { id: { in: incident.affectedOrganizationIds } }, select: { id: true, name: true, status: true } }) : [],
    usersById([incident.ownerId, incident.createdById, ...incident.updates.map((u) => u.authorId)]),
  ]);
  return {
    incident,
    owner: incident.ownerId ? (people.get(incident.ownerId) ?? null) : null,
    createdBy: incident.createdById ? (people.get(incident.createdById) ?? null) : null,
    timeline: incident.updates.map((u) => ({ ...u, author: u.authorId ? (people.get(u.authorId) ?? null) : null })),
    alerts,
    errorGroups,
    organizations: orgs,
    nextStatuses: nextStatuses(incident.status),
    durationMs: (incident.resolvedAt ?? new Date()).getTime() - incident.detectedAt.getTime(),
  };
}

async function assertOwner(tx: Tx, ownerId: string | null | undefined) {
  if (!ownerId) return;
  const u = await tx.user.findUnique({ where: { id: ownerId }, select: { status: true } });
  if (!u || u.status !== "ACTIVE") throw notFound("Owner");
}

async function assertOrgs(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const n = await tx.organization.count({ where: { id: { in: ids } } });
  if (n !== new Set(ids).size) throw invalid("Unknown organization in the affected list", { reason: "unknown_organization" });
}

export const createIncidentInput = z.object({
  title: text(200).min(3),
  severity: z.enum(INCIDENT_SEVERITIES),
  status: z.enum(["DETECTED", "INVESTIGATING"]).default("INVESTIGATING"),
  services: services.default([]),
  summary: text(5_000).optional(),
  customerImpact: text(5_000).optional(),
  affectedOrganizationIds: orgIds.default([]),
  ownerId: uuid.nullable().optional(),
  alertIds: z.array(uuid).max(50).default([]),
  reason: reasonSchema,
});

/** Open an incident (manual, or from alerts when `alertIds` are given). */
export async function createIncident(ctx: RequestContext, raw: z.input<typeof createIncidentInput>, opts: { source?: "manual" | "alert" } = {}) {
  const input = createIncidentInput.parse(raw);
  const result = await transaction(async (tx) => {
    if (ctx.actor.type !== "SYSTEM") await requirePlatform(ctx, INCIDENT_MANAGE);
    await assertOwner(tx, input.ownerId);
    await assertOrgs(tx, input.affectedOrganizationIds);
    const source = opts.source ?? (input.alertIds.length ? "alert" : "manual");
    const now = new Date();
    const incident = await tx.platformIncident.create({
      data: {
        title: input.title,
        severity: input.severity,
        status: input.status,
        source,
        services: [...new Set(input.services)],
        summary: input.summary || null,
        customerImpact: input.customerImpact || null,
        affectedOrganizationIds: [...new Set(input.affectedOrganizationIds)],
        ownerId: input.ownerId ?? (ctx.actor.type === "USER" ? ctx.actor.id : null),
        createdById: ctx.actor.type === "USER" ? ctx.actor.id : null,
        detectedAt: now,
        ...(input.status === "INVESTIGATING" ? { acknowledgedAt: now } : {}),
        updates: { create: { kind: "created", status: input.status, message: input.summary?.slice(0, 2_000) || input.title, authorId: ctx.actor.type === "USER" ? ctx.actor.id : null } },
      },
    });
    if (input.alertIds.length) {
      const linked = await tx.platformAlert.updateMany({ where: { id: { in: input.alertIds } }, data: { incidentId: incident.id } });
      await tx.platformAlertEvent.createMany({ data: input.alertIds.map((alertId) => ({ alertId, kind: "incident_linked", actorId: ctx.actor.id, note: `#${incident.number}` })) });
      await tx.platformIncidentUpdate.create({ data: { incidentId: incident.id, kind: "alert_linked", message: `${linked.count}`, authorId: ctx.actor.type === "USER" ? ctx.actor.id : null } });
    }
    await writeAudit(tx, ctx, { category: "ADMIN", action: "platform.incident.created", resourceType: "platform_incident", resourceId: incident.id, newValue: { number: incident.number, severity: incident.severity, status: incident.status, services: incident.services, source }, reason: input.reason });
    await emitEvent(tx, ctx, "platform.incident.opened", { incidentId: incident.id, number: incident.number, severity: incident.severity, source, services: incident.services }, { aggregateType: "platform_incident", aggregateId: incident.id });
    return incident;
  });
  await notifyAdmins(ctx, {
    permission: "platform.incidents.read",
    type: "incident.opened",
    severity: result.severity === "SEV1" || result.severity === "SEV2" ? "CRITICAL" : "WARNING",
    title: `#${result.number} ${result.title}`,
    href: `/incidents/${result.id}`,
    dedupeKey: `incident:${result.id}:opened`,
  });
  return result;
}

export const incidentStatusInput = z.object({ status: z.enum(INCIDENT_STATUSES), message: text(5_000).min(1), reason: reasonSchema });

/** Move an incident along its lifecycle with a timeline message. */
export async function changeIncidentStatus(ctx: RequestContext, id: string, raw: z.input<typeof incidentStatusInput>) {
  const input = incidentStatusInput.parse(raw);
  if (!uuid.safeParse(id).success) throw notFound("Incident");
  const result = await transaction(async (tx) => {
    await requirePlatform(ctx, INCIDENT_MANAGE);
    const cur = await tx.platformIncident.findUnique({ where: { id } });
    if (!cur) throw notFound("Incident");
    if (!nextStatuses(cur.status).includes(input.status)) throw conflict(`Cannot move an incident from ${cur.status} to ${input.status}`, { reason: "invalid_transition", from: cur.status, allowed: nextStatuses(cur.status) });
    if (input.status === "CLOSED") {
      if (!cur.resolution?.trim()) throw conflict("Write the resolution before closing the incident", { reason: "resolution_required" });
      if ((cur.severity === "SEV1" || cur.severity === "SEV2") && cur.postmortemState !== "published") throw conflict("Publish the postmortem before closing a SEV1/SEV2 incident", { reason: "postmortem_required" });
    }
    const now = new Date();
    const stamp = TIMESTAMP[input.status];
    const reopening = cur.status === "RESOLVED" && input.status !== "CLOSED";
    const updated = await tx.platformIncident.update({
      where: { id },
      data: {
        status: input.status,
        ...(stamp && !cur[stamp] ? { [stamp]: now } : {}),
        ...(input.status === "RESOLVED" ? { resolvedAt: now } : {}),
        ...(reopening ? { resolvedAt: null } : {}),
        ...(cur.status === "DETECTED" && !cur.acknowledgedAt ? { acknowledgedAt: now } : {}),
        updates: { create: { kind: "status", status: input.status, message: input.message, authorId: ctx.actor.id } },
      },
    });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "platform.incident.status_changed", resourceType: "platform_incident", resourceId: id, oldValue: { status: cur.status }, newValue: { status: input.status }, reason: input.reason });
    await emitEvent(tx, ctx, "platform.incident.status_changed", { incidentId: id, number: cur.number, from: cur.status, to: input.status }, { aggregateType: "platform_incident", aggregateId: id });
    return { updated, from: cur.status };
  });
  await notifyAdmins(ctx, {
    permission: "platform.incidents.read",
    type: "incident.status_changed",
    severity: result.updated.status === "RESOLVED" || result.updated.status === "CLOSED" ? "INFO" : "WARNING",
    title: `#${result.updated.number} ${result.from} → ${result.updated.status}`,
    href: `/incidents/${id}`,
    dedupeKey: `incident:${id}:${result.updated.status}`,
  });
  return { id, status: result.updated.status };
}

export const updateIncidentInput = z
  .object({
    title: text(200).min(3).optional(),
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    services: services.optional(),
    summary: text(5_000).nullable().optional(),
    customerImpact: text(5_000).nullable().optional(),
    rootCause: text(10_000).nullable().optional(),
    mitigation: text(10_000).nullable().optional(),
    resolution: text(10_000).nullable().optional(),
    ownerId: uuid.nullable().optional(),
    affectedOrganizationIds: orgIds.optional(),
    reason: reasonSchema,
  })
  .refine((v) => Object.keys(v).some((k) => k !== "reason"), { message: "Nothing to change" });

const FIELDS = ["title", "severity", "services", "summary", "customerImpact", "rootCause", "mitigation", "resolution", "ownerId", "affectedOrganizationIds"] as const;

/** Edit fields (owner, severity, affected services and customers, root cause, mitigation, resolution). */
export async function updateIncident(ctx: RequestContext, id: string, raw: z.input<typeof updateIncidentInput>) {
  const input = updateIncidentInput.parse(raw);
  if (!uuid.safeParse(id).success) throw notFound("Incident");
  return transaction(async (tx) => {
    await requirePlatform(ctx, INCIDENT_MANAGE);
    const cur = await tx.platformIncident.findUnique({ where: { id } });
    if (!cur) throw notFound("Incident");
    if (cur.status === "CLOSED") throw conflict("A closed incident can no longer be edited", { reason: "incident_closed" });
    await assertOwner(tx, input.ownerId);
    if (input.affectedOrganizationIds) await assertOrgs(tx, input.affectedOrganizationIds);
    const data: Prisma.PlatformIncidentUpdateInput = {};
    const changed: string[] = [];
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};
    for (const k of FIELDS) {
      const v = input[k];
      if (v === undefined) continue;
      const norm = typeof v === "string" ? v || null : Array.isArray(v) ? [...new Set(v as string[])] : v;
      (data as Record<string, unknown>)[k] = norm;
      changed.push(k);
      // Long texts are audited as "changed", not copied.
      const long = k === "summary" || k === "customerImpact" || k === "rootCause" || k === "mitigation" || k === "resolution";
      oldValue[k] = long ? !!cur[k] : cur[k];
      newValue[k] = long ? !!norm : norm;
    }
    await tx.platformIncident.update({
      where: { id },
      data: { ...data, updates: { create: { kind: input.ownerId !== undefined && changed.length === 1 ? "owner" : "field", message: changed.join(", "), authorId: ctx.actor.id } } },
    });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "platform.incident.updated", resourceType: "platform_incident", resourceId: id, oldValue, newValue, reason: input.reason });
    return { id, changed };
  });
}

export const incidentNoteInput = z.object({ message: text(5_000).min(1) });

/** Timeline note (no status change). Notes are not sensitive changes; they are audited without a reason. */
export async function addIncidentNote(ctx: RequestContext, id: string, raw: z.input<typeof incidentNoteInput>) {
  const input = incidentNoteInput.parse(raw);
  if (!uuid.safeParse(id).success) throw notFound("Incident");
  return transaction(async (tx) => {
    await requirePlatform(ctx, INCIDENT_MANAGE);
    const cur = await tx.platformIncident.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!cur) throw notFound("Incident");
    const u = await tx.platformIncidentUpdate.create({ data: { incidentId: id, kind: "note", message: input.message, authorId: ctx.actor.id } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "platform.incident.note_added", resourceType: "platform_incident", resourceId: id, newValue: { updateId: u.id } });
    return { id: u.id };
  });
}

export const postmortemInput = z.object({ postmortem: text(50_000), state: z.enum(["draft", "published"]), reason: reasonSchema });

/** Save the Markdown postmortem (draft or published). */
export async function savePostmortem(ctx: RequestContext, id: string, raw: z.input<typeof postmortemInput>) {
  const input = postmortemInput.parse(raw);
  if (!uuid.safeParse(id).success) throw notFound("Incident");
  return transaction(async (tx) => {
    await requirePlatform(ctx, INCIDENT_MANAGE);
    const cur = await tx.platformIncident.findUnique({ where: { id }, select: { id: true, status: true, postmortemState: true } });
    if (!cur) throw notFound("Incident");
    if (cur.status === "CLOSED") throw conflict("A closed incident can no longer be edited", { reason: "incident_closed" });
    if (input.state === "published" && !input.postmortem.trim()) throw invalid("An empty postmortem cannot be published", { reason: "postmortem_empty" });
    await tx.platformIncident.update({ where: { id }, data: { postmortem: input.postmortem || null, postmortemState: input.state, updates: { create: { kind: "postmortem", message: input.state, authorId: ctx.actor.id } } } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "platform.incident.postmortem_saved", resourceType: "platform_incident", resourceId: id, oldValue: { state: cur.postmortemState }, newValue: { state: input.state, length: input.postmortem.length }, reason: input.reason });
    return { id, state: input.state };
  });
}

export const linkAlertsInput = z.object({ alertIds: z.array(uuid).min(1).max(50), reason: reasonSchema });

export async function linkAlertsToIncident(ctx: RequestContext, id: string, raw: z.input<typeof linkAlertsInput>) {
  const input = linkAlertsInput.parse(raw);
  if (!uuid.safeParse(id).success) throw notFound("Incident");
  return transaction(async (tx) => {
    await requirePlatform(ctx, INCIDENT_MANAGE);
    const cur = await tx.platformIncident.findUnique({ where: { id }, select: { id: true, number: true } });
    if (!cur) throw notFound("Incident");
    const r = await tx.platformAlert.updateMany({ where: { id: { in: input.alertIds } }, data: { incidentId: id } });
    await tx.platformAlertEvent.createMany({ data: input.alertIds.map((alertId) => ({ alertId, kind: "incident_linked", actorId: ctx.actor.id, note: `#${cur.number}` })) });
    await tx.platformIncidentUpdate.create({ data: { incidentId: id, kind: "alert_linked", message: `${r.count}`, authorId: ctx.actor.id } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: "platform.incident.alerts_linked", resourceType: "platform_incident", resourceId: id, newValue: { alertIds: input.alertIds }, reason: input.reason });
    return { linked: r.count };
  });
}

/**
 * Alert engine: open a system incident for a fired detection rule (no admin involved). Skips when an active incident
 * already covers the alert's group. Returns the incident id or null.
 */
export async function openIncidentForAlert(alert: { id: string; title: string; service: string | null; groupKey: string; severity: string }): Promise<string | null> {
  const existing = await db().platformIncident.findFirst({
    where: { status: { notIn: ["RESOLVED", "CLOSED"] }, ...(alert.service ? { services: { has: alert.service } } : {}), source: "alert" },
    select: { id: true },
  });
  if (existing) {
    await db().platformAlert.update({ where: { id: alert.id }, data: { incidentId: existing.id, events: { create: { kind: "incident_linked", note: "auto" } } } });
    return existing.id;
  }
  const ctx = systemContext();
  const incident = await createIncident(
    ctx,
    {
      title: alert.title.slice(0, 200),
      severity: alert.severity === "CRITICAL" ? "SEV2" : "SEV3",
      status: "DETECTED",
      services: alert.service && HEALTH_SERVICE_KEYS.includes(alert.service) ? [alert.service] : [],
      summary: `Opened automatically by the alert engine (rule group ${alert.groupKey}).`,
      alertIds: [alert.id],
      reason: "alert engine: detection rule fired",
    },
    { source: "alert" },
  );
  return incident.id;
}

/** Active platform staff (holders of a PLATFORM/REGION/COUNTRY role) for owner and assignee pickers. */
export async function platformStaffOptions(): Promise<{ id: string; name: string; email: string }[]> {
  const grants = await db().roleAssignment.findMany({
    where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { principalId: true },
    take: 500,
  });
  const ids = [...new Set(grants.map((g) => g.principalId))];
  if (!ids.length) return [];
  return db().user.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" }, take: 200 });
}
