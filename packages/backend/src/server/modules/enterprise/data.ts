import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { jsonStringify } from "@/server/core/json";
import { logger } from "@/server/core/logger";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { authorizeOrg, getOrgSettings } from "./policy";

/** Data management: full company export (streamed JSON), deletion requests (soft delete after a grace period), retention. */

export const DELETION_GRACE_DAYS = 7;
const BATCH = 500;
/** Columns never exported (credentials and token material). */
const SECRET_FIELD = /(hash|encrypted|secret|token)$/i;

interface ExportTable {
  model: string;
  delegate: string;
  fields: string[];
}

/** Every company-scoped model (has organizationId + companyId + id), discovered from the generated client. */
function companyTables(): ExportTable[] {
  const out: ExportTable[] = [];
  for (const [name, value] of Object.entries(Prisma)) {
    if (!name.endsWith("ScalarFieldEnum") || typeof value !== "object" || !value) continue;
    const fields = Object.keys(value as Record<string, string>);
    if (!fields.includes("id") || !fields.includes("companyId") || !fields.includes("organizationId")) continue;
    const model = name.slice(0, -"ScalarFieldEnum".length);
    out.push({
      model,
      delegate: model[0]!.toLowerCase() + model.slice(1),
      fields: fields.filter((f) => !SECRET_FIELD.test(f)),
    });
  }
  return out.sort((a, b) => a.model.localeCompare(b.model));
}

type FindMany = (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;

/**
 * Stream all of a company's data as one JSON document (organizations.manage). Tables are paged by id so memory stays
 * flat; secrets are omitted. The export itself is audited.
 */
export async function exportCompanyData(ctx: RequestContext, organizationId: string, companyId: string): Promise<{ stream: ReadableStream<Uint8Array>; filename: string }> {
  const chain = await companyChain(db(), organizationId, companyId);
  await authorizeOrg(ctx, organizationId, "organizations.manage", undefined, chain);
  const company = await db().company.findFirstOrThrow({
    where: { id: companyId, organizationId },
  });
  await transaction(async (tx) => {
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "company.data_exported",
      resourceType: "company",
      resourceId: companyId,
    });
    await tx.enterpriseDataRequest.create({
      data: {
        organizationId,
        companyId,
        type: "EXPORT",
        status: "COMPLETED",
        requestedById: ctx.actor.id ?? organizationId,
        completedAt: new Date(),
      },
    });
  });
  const tables = companyTables();
  const client = db() as unknown as Record<string, { findMany: FindMany }>;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          enc.encode(`{"format":"realy.company-export","version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"company":${jsonStringify(company)},"tables":{`),
        );
        let firstTable = true;
        for (const t of tables) {
          const delegate = client[t.delegate];
          if (!delegate?.findMany) continue;
          controller.enqueue(enc.encode(`${firstTable ? "" : ","}${JSON.stringify(t.model)}:[`));
          firstTable = false;
          const select = Object.fromEntries(t.fields.map((f) => [f, true]));
          let cursor: string | undefined;
          let first = true;
          for (;;) {
            const rows = await delegate.findMany({
              where: { organizationId, companyId },
              select,
              orderBy: { id: "asc" },
              take: BATCH,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });
            for (const r of rows) {
              controller.enqueue(enc.encode(`${first ? "" : ","}${jsonStringify(r)}`));
              first = false;
            }
            if (rows.length < BATCH) break;
            cursor = rows[rows.length - 1]!.id as string;
          }
          controller.enqueue(enc.encode("]"));
        }
        controller.enqueue(enc.encode("}}"));
        controller.close();
      } catch (err) {
        logger.error({ err: (err as Error).message, companyId }, "company export failed");
        controller.error(err);
      }
    },
  });
  return {
    stream,
    filename: `${company.slug}-export-${new Date().toISOString().slice(0, 10)}.json`,
  };
}

// ───────────── Deletion requests ─────────────

export const deletionRequestInput = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export const deletionActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), confirmName: z.string().max(200) }),
  z.object({ action: z.literal("cancel") }),
]);

export async function listDataRequests(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  await authorizeOrg(ctx, organizationId, "organizations.read", undefined, chain);
  return db().enterpriseDataRequest.findMany({
    where: { organizationId, companyId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/** Ask for a company to be deleted (companies.manage). Nothing happens until someone with companies.delete confirms. */
export async function requestDeletion(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof deletionRequestInput>) {
  const input = deletionRequestInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await companyChain(tx, organizationId, companyId);
    await authorizeOrg(ctx, organizationId, "companies.manage", tx, chain);
    const open = await tx.enterpriseDataRequest.findFirst({
      where: {
        companyId,
        type: "DELETION",
        status: { in: ["PENDING", "SCHEDULED"] },
      },
    });
    if (open)
      throw conflict("A deletion request is already open", {
        reason: "enterprise_deletion_open",
      });
    const r = await tx.enterpriseDataRequest.create({
      data: {
        organizationId,
        companyId,
        type: "DELETION",
        status: "PENDING",
        reason: input.reason ?? null,
        requestedById: ctx.actor.id ?? organizationId,
      },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "company.deletion_requested",
      resourceType: "company",
      resourceId: companyId,
      newValue: { requestId: r.id, reason: input.reason },
    });
    const deleters = await usersWithPermission(tx, organizationId, companyId, "companies.delete");
    await notifyUsers(
      tx,
      organizationId,
      deleters.filter((u) => u !== ctx.actor.id),
      "enterprise.deletion_requested",
      {
        companyId,
        title: (await tx.company.findUniqueOrThrow({ where: { id: companyId } })).name,
        href: "/settings/data",
      },
    );
    return r;
  });
}

/** Confirm (companies.delete + typed company name → scheduled after the grace period) or cancel a deletion request. */
export async function actOnDeletion(ctx: RequestContext, organizationId: string, companyId: string, requestId: string, raw: z.input<typeof deletionActionInput>) {
  const input = deletionActionInput.parse(raw);
  if (!z.string().uuid().safeParse(requestId).success) throw notFound("Request");
  return transaction(async (tx) => {
    const chain = await companyChain(tx, organizationId, companyId);
    const r = await tx.enterpriseDataRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
        companyId,
        type: "DELETION",
        status: { in: ["PENDING", "SCHEDULED"] },
      },
    });
    if (!r) throw notFound("Request");
    if (input.action === "cancel") {
      await authorizeOrg(ctx, organizationId, "companies.manage", tx, chain);
      const u = await tx.enterpriseDataRequest.update({
        where: { id: r.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await writeAudit(tx, ctx, {
        category: "SECURITY",
        organizationId,
        action: "company.deletion_cancelled",
        resourceType: "company",
        resourceId: companyId,
        newValue: { requestId: r.id },
      });
      return u;
    }
    await authorizeOrg(ctx, organizationId, "companies.delete", tx, chain);
    if (r.status !== "PENDING") throw conflict("Already confirmed");
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
    });
    if (input.confirmName.trim() !== company.name)
      throw invalid("Type the company name exactly to confirm", {
        reason: "enterprise_confirm_name",
      });
    const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000);
    const u = await tx.enterpriseDataRequest.update({
      where: { id: r.id },
      data: { status: "SCHEDULED", confirmedById: ctx.actor.id, scheduledFor },
    });
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      organizationId,
      action: "company.deletion_confirmed",
      resourceType: "company",
      resourceId: companyId,
      newValue: { requestId: r.id, scheduledFor },
    });
    return u;
  });
}

/** Periodic: soft-delete companies whose confirmed deletion passed its grace period (deletedAt; data is retained). */
export async function processScheduledDeletions(): Promise<number> {
  const due = await db().enterpriseDataRequest.findMany({
    where: {
      type: "DELETION",
      status: "SCHEDULED",
      scheduledFor: { lte: new Date() },
    },
    take: 20,
  });
  const ctx = systemContext();
  let n = 0;
  for (const r of due) {
    await transaction(async (tx) => {
      const fresh = await tx.enterpriseDataRequest.findUnique({
        where: { id: r.id },
      });
      if (fresh?.status !== "SCHEDULED") return;
      await tx.company.updateMany({
        where: {
          id: r.companyId,
          organizationId: r.organizationId,
          deletedAt: null,
        },
        data: { deletedAt: new Date(), status: "ARCHIVED" },
      });
      await tx.enterpriseDataRequest.update({
        where: { id: r.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await writeAudit(tx, ctx, {
        category: "SECURITY",
        organizationId: r.organizationId,
        action: "company.deleted",
        resourceType: "company",
        resourceId: r.companyId,
        newValue: { requestId: r.id, confirmedById: r.confirmedById },
        reason: "confirmed deletion request",
      });
      n++;
    });
  }
  return n;
}

/** Periodic: apply organizations' retention settings (audit trail; read notifications and closed data requests). */
export async function applyRetention(): Promise<number> {
  const orgs = await db().enterpriseOrgSettings.findMany({
    where: {
      OR: [{ auditRetentionDays: { not: null } }, { dataRetentionDays: { not: null } }],
    },
    select: { organizationId: true },
  });
  let removed = 0;
  for (const { organizationId } of orgs) {
    const s = await getOrgSettings(organizationId);
    if (s.auditRetentionDays) {
      const before = new Date(Date.now() - s.auditRetentionDays * 86_400_000);
      removed += (
        await db().auditLog.deleteMany({
          where: {
            organizationId,
            category: "TENANT",
            createdAt: { lt: before },
          },
        })
      ).count;
    }
    if (s.dataRetentionDays) {
      const before = new Date(Date.now() - s.dataRetentionDays * 86_400_000);
      removed += (
        await db().notification.deleteMany({
          where: { organizationId, readAt: { lt: before } },
        })
      ).count;
      removed += (
        await db().enterpriseDataRequest.deleteMany({
          where: {
            organizationId,
            status: { in: ["COMPLETED", "CANCELLED"] },
            updatedAt: { lt: before },
          },
        })
      ).count;
    }
  }
  return removed;
}
