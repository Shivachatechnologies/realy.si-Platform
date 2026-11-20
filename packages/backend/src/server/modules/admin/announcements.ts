import { z } from "zod";
import { db, transaction, type Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import { writeAudit } from "@/server/modules/audit/service";
import { BANNER_KEY, bannerSchema, invalidateBanner } from "@/server/modules/cms/public";
import { notifyUsers } from "@/server/modules/notifications/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { reasonSchema, requireAnyPlatform } from "./access";

/**
 * Platform notifications (Admin → Announcements): in-app announcements to the active members of all or selected
 * organizations (notifyUsers, kind "platform.announcement"), their history, and the site-wide banner (maintenance
 * notices) rendered by the user app's PlatformBanner. platform.controls.manage.
 */

const MANAGE = "platform.controls.manage";
const MAX_ORGS_PER_SEND = 5000;

export async function announcementsOverview(ctx: RequestContext) {
  await requireAnyPlatform(ctx, [MANAGE, "platform.content.manage", "platform.audit.read"]);
  const [history, bannerRow, orgCount] = await Promise.all([
    db().platformAnnouncement.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db().platformSetting.findUnique({ where: { key: BANNER_KEY } }),
    db().organization.count({ where: { status: "ACTIVE" } }),
  ]);
  const authors = await db().user.findMany({ where: { id: { in: [...new Set(history.map((h) => h.createdById))] } }, select: { id: true, name: true } });
  const parsed = bannerSchema.safeParse(bannerRow?.value);
  return {
    history: history.map((h) => ({ ...h, author: authors.find((a) => a.id === h.createdById)?.name ?? "—" })),
    banner: parsed.success ? parsed.data : bannerSchema.parse({}),
    bannerUpdatedAt: bannerRow?.updatedAt ?? null,
    activeOrganizations: orgCount,
  };
}

export const announcementInput = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().max(1000).default(""),
  href: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/(?!\/)[^\s]*$/, "Use an in-app path starting with /")
    .default("/"),
  audience: z.union([z.literal("all"), z.array(z.string().uuid()).min(1).max(500)]),
  reason: reasonSchema,
});

/** Send an announcement: one in-app notification per active member of every targeted active organization. */
export async function sendAnnouncement(ctx: RequestContext, raw: z.input<typeof announcementInput>) {
  const input = announcementInput.parse(raw);
  return transaction(
    async (tx) => {
      await requirePermission(ctx, MANAGE, platformChain(), tx);
      const orgs = await tx.organization.findMany({ where: { status: "ACTIVE", ...(input.audience === "all" ? {} : { id: { in: input.audience } }) }, select: { id: true }, take: MAX_ORGS_PER_SEND + 1 });
      if (!orgs.length) throw invalid("No active organization matches this audience", { reason: "announcement_no_audience" });
      if (orgs.length > MAX_ORGS_PER_SEND) throw invalid(`At most ${MAX_ORGS_PER_SEND} organizations per announcement`, { reason: "announcement_too_many" });
      const members = await tx.membership.findMany({ where: { organizationId: { in: orgs.map((o) => o.id) }, status: "ACTIVE", user: { status: "ACTIVE" } }, select: { organizationId: true, userId: true } });
      let recipients = 0;
      for (const o of orgs) {
        recipients += await notifyUsers(
          tx,
          o.id,
          members.filter((m) => m.organizationId === o.id).map((m) => m.userId),
          "platform.announcement",
          { title: input.title, href: input.href },
        );
      }
      const row = await tx.platformAnnouncement.create({
        data: { title: input.title, body: input.body, href: input.href, audience: toJson(input.audience) as Prisma.InputJsonValue, orgCount: orgs.length, recipients, createdById: ctx.actor.id! },
      });
      await writeAudit(tx, ctx, { category: "ADMIN", action: "platform.announcement_sent", resourceType: "platform_announcement", resourceId: row.id, newValue: { title: input.title, orgCount: orgs.length, recipients }, reason: input.reason });
      return { id: row.id, orgCount: orgs.length, recipients };
    },
    { timeout: 60_000 },
  );
}

export const bannerInput = bannerSchema.extend({ reason: reasonSchema });

/** Set or clear the site-wide banner (shown in the user app within about a minute). */
export async function setBanner(ctx: RequestContext, raw: z.input<typeof bannerInput>) {
  const { reason, ...value } = bannerInput.parse(raw);
  if (value.active && !value.message) throw invalid("Write the banner message first", { reason: "banner_empty" });
  if (value.href && !/^\/(?!\/)[^\s]*$/.test(value.href) && !/^https:\/\/[^\s]+$/.test(value.href)) throw invalid("Use a path starting with / or an https link");
  await transaction(async (tx) => {
    await requirePermission(ctx, MANAGE, platformChain(), tx);
    const before = await tx.platformSetting.findUnique({ where: { key: BANNER_KEY } });
    const json = toJson(value) as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({ where: { key: BANNER_KEY }, create: { key: BANNER_KEY, value: json, updatedById: ctx.actor.id!, reason }, update: { value: json, updatedById: ctx.actor.id!, reason } });
    await writeAudit(tx, ctx, { category: "ADMIN", action: value.active ? "platform.banner_set" : "platform.banner_cleared", resourceType: "platform_control", resourceId: BANNER_KEY, oldValue: before?.value ?? null, newValue: value, reason });
  });
  invalidateBanner();
  return value;
}
