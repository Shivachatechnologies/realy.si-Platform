import type { Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import type { AuditCategory } from "@/generated/prisma/enums";
import { toJson } from "@/server/core/json";
import { db } from "@/server/core/db";
import { pageInput, prismaPage, toPage, type PageInput } from "@/server/core/pagination";
import { requirePermission } from "@/server/modules/rbac/service";
import { orgChain, platformChain } from "@/server/modules/rbac/scope";

export interface AuditEntry {
  category: AuditCategory;
  organizationId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

/** Append an audit record inside the caller's transaction (commits atomically with the change). */
export async function writeAudit(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      category: entry.category,
      organizationId: entry.organizationId ?? null,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      oldValue: entry.oldValue === undefined ? undefined : toJson(entry.oldValue),
      newValue: entry.newValue === undefined ? undefined : toJson(entry.newValue),
      reason: entry.reason ?? null,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });
}

/** Tenant audit trail (audit.read @ organization) or the platform trail (platform.audit.read) when organizationId is null. */
export async function listAuditLogs(
  ctx: RequestContext,
  organizationId: string | null,
  rawPage: Partial<PageInput> & { category?: AuditCategory } = {},
) {
  const page = pageInput.parse(rawPage);
  if (organizationId) await requirePermission(ctx, "audit.read", orgChain(organizationId));
  else await requirePermission(ctx, "platform.audit.read", platformChain());
  const rows = await db().auditLog.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      ...(rawPage.category ? { category: rawPage.category } : {}),
    },
    orderBy: { id: "desc" },
    ...prismaPage(page),
  });
  return toPage(rows, page);
}
