import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { CommsAnnouncementStatus } from "@/generated/prisma/enums";
import { db, transaction, type Db, type Tx } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers } from "@/server/modules/notifications/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { actorId, authorize, clip, instant, isUuid, membersWith, userNames, uuid } from "./common";

export const AUDIENCES = ["ALL", "DEPARTMENT", "TEAM"] as const;
export const ANNOUNCEMENT_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

const base = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  audience: z.enum(AUDIENCES).default("ALL"),
  audienceId: uuid.nullable().optional().or(z.literal("").transform(() => null)),
  pinned: z.boolean().default(false),
  /** "now" publishes immediately, "schedule" at publishAt, "draft" keeps it unpublished. */
  mode: z.enum(["draft", "now", "schedule"]).default("draft"),
  publishAt: instant.optional().or(z.literal("").transform(() => undefined)),
});
export const announcementInput = base.refine((v) => v.mode !== "schedule" || !!v.publishAt, { path: ["publishAt"], message: "Required to schedule" });
export const updateAnnouncementInput = base.partial().extend({ status: z.enum(["ARCHIVED", "DRAFT"]).optional() });

export interface AnnouncementFilters {
  q?: string;
  status?: CommsAnnouncementStatus;
  cursor?: string;
}

export function parseAnnouncementFilters(raw: Record<string, string | string[] | undefined>): AnnouncementFilters {
  const one = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k])?.trim() || undefined;
  const status = one("status");
  const cursor = one("cursor");
  return {
    q: one("q")?.slice(0, 200),
    status: (ANNOUNCEMENT_STATUSES as readonly string[]).includes(status ?? "") ? (status as CommsAnnouncementStatus) : undefined,
    cursor: isUuid(cursor) ? cursor : undefined,
  };
}

/** Departments and teams of the company, for the audience picker. */
export async function audienceOptions(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "communication.read");
  const [departments, teams] = await Promise.all([
    db().department.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db().team.findMany({ where: { organizationId, companyId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { departments, teams };
}

async function validateAudience(tx: Tx, organizationId: string, companyId: string, audience: string, audienceId: string | null | undefined) {
  if (audience === "ALL") return null;
  if (!audienceId) throw invalid("Choose a department or team", { reason: "comms_audience_required" });
  const found =
    audience === "DEPARTMENT"
      ? await tx.department.findFirst({ where: { id: audienceId, organizationId, companyId }, select: { id: true } })
      : await tx.team.findFirst({ where: { id: audienceId, organizationId, companyId }, select: { id: true } });
  if (!found) throw invalid("Unknown department or team", { reason: "comms_audience_required" });
  return audienceId;
}

/** User ids an announcement reaches: communication readers, narrowed to the department / team's employees. */
export async function audienceUserIds(client: Tx | Db, organizationId: string, chain: ScopeChain, a: { companyId: string; audience: string; audienceId: string | null }) {
  let candidates: string[] | undefined;
  if (a.audience !== "ALL" && a.audienceId) {
    const employees = await client.employee.findMany({
      where: { companyId: a.companyId, organizationId, archivedAt: null, userId: { not: null }, ...(a.audience === "DEPARTMENT" ? { departmentId: a.audienceId } : { teamId: a.audienceId }) },
      select: { userId: true },
    });
    candidates = employees.map((e) => e.userId!);
    if (!candidates.length) return [];
  }
  return membersWith(client, organizationId, chain, "communication.read", candidates);
}

/** Visibility filter for a non-manager: published, for everyone or for the viewer's department / team. */
async function viewerAudienceWhere(organizationId: string, companyId: string, userId: string | null): Promise<Prisma.CommsAnnouncementWhereInput> {
  const employees = userId
    ? await db().employee.findMany({ where: { organizationId, companyId, userId, archivedAt: null }, select: { departmentId: true, teamId: true } })
    : [];
  const deptIds = employees.map((e) => e.departmentId).filter((d): d is string => !!d);
  const teamIds = employees.map((e) => e.teamId).filter((d): d is string => !!d);
  return {
    status: "PUBLISHED",
    OR: [{ audience: "ALL" }, { audience: "DEPARTMENT", audienceId: { in: deptIds } }, { audience: "TEAM", audienceId: { in: teamIds } }],
  };
}

const PAGE = 20;

export async function listAnnouncements(ctx: RequestContext, organizationId: string, companyId: string, f: AnnouncementFilters = {}) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  const manager = await can(ctx, "communication.manage", chain);
  const where: Prisma.CommsAnnouncementWhereInput = {
    organizationId,
    companyId,
    ...(manager ? (f.status ? { status: f.status } : { status: { not: "ARCHIVED" } }) : await viewerAudienceWhere(organizationId, companyId, ctx.actor.id)),
    ...(f.q ? { AND: [{ OR: [{ title: { contains: f.q, mode: "insensitive" } }, { body: { contains: f.q, mode: "insensitive" } }] }] } : {}),
  };
  const rows = await db().commsAnnouncement.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { publishedAt: { sort: "desc", nulls: "first" } }, { id: "desc" }],
    take: PAGE + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { _count: { select: { reads: true } }, reads: { where: { userId: ctx.actor.id ?? undefined }, select: { userId: true }, take: 1 } },
  });
  const names = await userNames(db(), rows.map((r) => r.authorId));
  const data = rows.slice(0, PAGE).map(({ reads, _count, ...r }) => ({ ...r, authorName: names.get(r.authorId) ?? null, readCount: _count.reads, read: reads.length > 0 }));
  return { data, nextCursor: rows.length > PAGE ? data[data.length - 1]!.id : null, manager };
}

export async function getAnnouncement(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const chain = await authorize(ctx, organizationId, companyId, "communication.read");
  if (!isUuid(id)) throw notFound("Announcement");
  const manager = await can(ctx, "communication.manage", chain);
  const a = await db().commsAnnouncement.findFirst({
    where: { id, organizationId, companyId, ...(manager ? {} : await viewerAudienceWhere(organizationId, companyId, ctx.actor.id)) },
    include: { reads: { orderBy: { readAt: "desc" } } },
  });
  if (!a) throw notFound("Announcement");
  const names = await userNames(db(), [a.authorId, ...a.reads.map((r) => r.userId)]);
  const audienceSize = a.status === "PUBLISHED" || manager ? (await audienceUserIds(db(), organizationId, chain, a)).length : 0;
  let audienceName: string | null = null;
  if (a.audienceId) {
    const row =
      a.audience === "DEPARTMENT"
        ? await db().department.findFirst({ where: { id: a.audienceId, companyId }, select: { name: true } })
        : await db().team.findFirst({ where: { id: a.audienceId, companyId }, select: { name: true } });
    audienceName = row?.name ?? null;
  }
  return {
    ...a,
    manager,
    audienceName,
    audienceSize,
    authorName: names.get(a.authorId) ?? null,
    read: a.reads.some((r) => r.userId === ctx.actor.id),
    reads: manager ? a.reads.map((r) => ({ userId: r.userId, name: names.get(r.userId) ?? null, readAt: r.readAt })) : [],
  };
}

/** Publish inside a transaction: status, event and audience notifications. */
async function publishInTx(tx: Tx, ctx: RequestContext, chain: ScopeChain, a: { id: string; organizationId: string; companyId: string; title: string; audience: string; audienceId: string | null; authorId: string; pinned: boolean }) {
  const now = new Date();
  await tx.commsAnnouncement.update({ where: { id: a.id }, data: { status: "PUBLISHED", publishedAt: now, publishAt: null } });
  await emitDomainEvent(tx, ctx, "announcement.published", {
    organizationId: a.organizationId,
    companyId: a.companyId,
    entityType: "announcement",
    entityId: a.id,
    data: { title: a.title, audience: a.audience, audienceId: a.audienceId, pinned: a.pinned, authorId: a.authorId, publishedAt: now },
  });
  const recipients = (await audienceUserIds(tx, a.organizationId, chain, a)).filter((u) => u !== a.authorId);
  await notifyUsers(tx, a.organizationId, recipients, "comms.announcement", { companyId: a.companyId, title: clip(a.title), href: `/communication/announcements/${a.id}` });
}

export async function createAnnouncement(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof announcementInput>) {
  const input = announcementInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    const audienceId = await validateAudience(tx, organizationId, companyId, input.audience, input.audienceId);
    const publishAt = input.mode === "schedule" && input.publishAt ? new Date(input.publishAt) : null;
    if (publishAt && publishAt.getTime() < Date.now() - 60_000) throw invalid("Schedule time is in the past", { reason: "comms_schedule_past" });
    const a = await tx.commsAnnouncement.create({
      data: {
        organizationId,
        companyId,
        title: input.title,
        body: input.body,
        audience: input.audience,
        audienceId,
        pinned: input.pinned,
        status: publishAt ? "SCHEDULED" : "DRAFT",
        publishAt,
        authorId: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "announcement.created", resourceType: "announcement", resourceId: a.id, newValue: { title: a.title, mode: input.mode, audience: a.audience } });
    if (input.mode === "now") await publishInTx(tx, ctx, chain, a);
    return a;
  });
}

export async function updateAnnouncement(ctx: RequestContext, organizationId: string, companyId: string, id: string, raw: z.input<typeof updateAnnouncementInput>) {
  const input = updateAnnouncementInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    if (!isUuid(id)) throw notFound("Announcement");
    const before = await tx.commsAnnouncement.findFirst({ where: { id, organizationId, companyId } });
    if (!before) throw notFound("Announcement");
    const audience = input.audience ?? before.audience;
    const audienceId = input.audience !== undefined || input.audienceId !== undefined ? await validateAudience(tx, organizationId, companyId, audience, input.audienceId ?? before.audienceId) : before.audienceId;
    let status = before.status;
    let publishAt = before.publishAt;
    if (input.status) status = input.status;
    if (before.status !== "PUBLISHED" && input.mode === "schedule") {
      if (!input.publishAt) throw invalid("Required to schedule", { reason: "comms_schedule_past" });
      publishAt = new Date(input.publishAt);
      if (publishAt.getTime() < Date.now() - 60_000) throw invalid("Schedule time is in the past", { reason: "comms_schedule_past" });
      status = "SCHEDULED";
    } else if (before.status !== "PUBLISHED" && input.mode === "draft") {
      status = "DRAFT";
      publishAt = null;
    }
    const a = await tx.commsAnnouncement.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        audience,
        audienceId,
        status,
        publishAt,
      },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "announcement.updated",
      resourceType: "announcement",
      resourceId: id,
      oldValue: { title: before.title, status: before.status, pinned: before.pinned },
      newValue: { title: a.title, status: a.status, pinned: a.pinned },
    });
    if (input.mode === "now" && before.status !== "PUBLISHED") await publishInTx(tx, ctx, chain, a);
    return a;
  });
}

export async function deleteAnnouncement(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "communication.manage", tx);
    if (!isUuid(id)) throw notFound("Announcement");
    const a = await tx.commsAnnouncement.findFirst({ where: { id, organizationId, companyId } });
    if (!a) throw notFound("Announcement");
    await tx.commsComment.deleteMany({ where: { companyId, subjectType: "announcement", subjectId: id } });
    await tx.commsAnnouncement.delete({ where: { id } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "announcement.deleted", resourceType: "announcement", resourceId: id, oldValue: { title: a.title, status: a.status } });
    return { ok: true };
  });
}

/** Read receipt for the viewer (idempotent). */
export async function markAnnouncementRead(ctx: RequestContext, organizationId: string, companyId: string, id: string) {
  const a = await getAnnouncement(ctx, organizationId, companyId, id);
  if (a.status !== "PUBLISHED" || !ctx.actor.id) return { ok: true };
  await db().commsAnnouncementRead.upsert({
    where: { announcementId_userId: { announcementId: a.id, userId: ctx.actor.id } },
    create: { announcementId: a.id, companyId, userId: ctx.actor.id },
    update: {},
  });
  return { ok: true };
}

/** Worker: publish scheduled announcements whose time has come. */
export async function publishDueAnnouncements(): Promise<number> {
  const due = await db().commsAnnouncement.findMany({ where: { status: "SCHEDULED", publishAt: { lte: new Date() } }, take: 50 });
  let n = 0;
  for (const a of due) {
    const ctx = systemContext();
    await transaction(async (tx) => {
      // Re-check inside the transaction so concurrent workers publish once.
      const claimed = await tx.commsAnnouncement.updateMany({ where: { id: a.id, status: "SCHEDULED" }, data: { status: "PUBLISHED" } });
      if (!claimed.count) return;
      const chain = await companyChain(tx, a.organizationId, a.companyId);
      await publishInTx(tx, ctx, chain, a);
      n++;
    });
  }
  return n;
}
