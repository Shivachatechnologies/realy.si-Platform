import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { API_KEY_ROLE_PREFIX } from "./roles";
import { authorizeOrg, getOrgLimits, limitUsage } from "./policy";

// ───────────── Tenant audit trail ─────────────

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const auditFilterInput = z.object({
  actor: z.string().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  resource: z.string().trim().max(80).optional(),
  category: z.enum(["TENANT", "ADMIN", "SECURITY"]).optional(),
  from: day.optional(),
  to: day.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditFilters = z.infer<typeof auditFilterInput>;

export function parseAuditFilters(raw: Record<string, string | string[] | undefined>): AuditFilters {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    if (s) flat[k] = s;
  }
  const r = auditFilterInput.safeParse(flat);
  if (r.success) return r.data;
  // Drop invalid URL params one by one rather than failing the page.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(flat)) if (auditFilterInput.safeParse({ ...out, [k]: v }).success) out[k] = v;
  return auditFilterInput.parse(out);
}

function auditWhere(organizationId: string, f: AuditFilters): Prisma.AuditLogWhereInput {
  return {
    organizationId,
    ...(f.actor ? { actorId: f.actor } : {}),
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.resource ? { resourceType: f.resource } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.from || f.to
      ? {
          createdAt: {
            ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}),
            ...(f.to
              ? {
                  lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000),
                }
              : {}),
          },
        }
      : {}),
  };
}

async function actorNames(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, string>();
  const [users, sas] = await Promise.all([
    db().user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    }),
    db().serviceAccount.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    }),
  ]);
  return new Map([...users, ...sas].map((u) => [u.id, u.name]));
}

/** Organization audit trail with filters and cursor pagination (audit.read). */
export async function searchAudit(ctx: RequestContext, organizationId: string, f: AuditFilters) {
  await authorizeOrg(ctx, organizationId, "audit.read");
  const rows = await db().auditLog.findMany({
    where: auditWhere(organizationId, f),
    orderBy: { id: "desc" },
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > f.limit;
  const data = more ? rows.slice(0, f.limit) : rows;
  const names = await actorNames(data.map((r) => r.actorId));
  const types = await db().auditLog.findMany({
    where: { organizationId },
    distinct: ["resourceType"],
    select: { resourceType: true },
    take: 100,
  });
  return {
    data: data.map((r) => ({
      ...r,
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
    })),
    nextCursor: more ? data[data.length - 1]!.id : null,
    resourceTypes: types.map((a) => a.resourceType).sort(),
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Neutralize spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const AUDIT_EXPORT_MAX = 50_000;

/** CSV export of the filtered audit trail (streamed, up to 50,000 rows). */
export async function exportAuditCsv(ctx: RequestContext, organizationId: string, f: AuditFilters): Promise<ReadableStream<Uint8Array>> {
  await authorizeOrg(ctx, organizationId, "audit.read");
  const where = auditWhere(organizationId, f);
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        enc.encode(
          ["created_at", "category", "actor_type", "actor_id", "actor_name", "action", "resource_type", "resource_id", "ip", "request_id", "reason", "old_value", "new_value"].join(
            ",",
          ) + "\n",
        ),
      );
      let cursor: string | undefined;
      let sent = 0;
      while (sent < AUDIT_EXPORT_MAX) {
        const rows = await db().auditLog.findMany({
          where,
          orderBy: { id: "desc" },
          take: 1000,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (!rows.length) break;
        const names = await actorNames(rows.map((r) => r.actorId));
        const lines = rows.map((r) =>
          [
            r.createdAt.toISOString(),
            r.category,
            r.actorType,
            r.actorId,
            r.actorId ? names.get(r.actorId) : "",
            r.action,
            r.resourceType,
            r.resourceId,
            r.ip,
            r.requestId,
            r.reason,
            r.oldValue,
            r.newValue,
          ]
            .map(csvCell)
            .join(","),
        );
        controller.enqueue(enc.encode(lines.join("\n") + "\n"));
        sent += rows.length;
        cursor = rows[rows.length - 1]!.id;
        if (rows.length < 1000) break;
      }
      controller.close();
    },
  });
}

// ───────────── Usage analytics ─────────────

export interface DailyPoint {
  day: string;
  tasks: number;
  tokens: number;
  apiCalls: number;
}

/** Usage over the last `days` days plus current counts and limits (organizations.read). */
export async function usageAnalytics(ctx: RequestContext, organizationId: string, days = 30) {
  await authorizeOrg(ctx, organizationId, "organizations.read");
  const since = new Date(Date.now() - days * 86_400_000);
  const [aiRows, apiRows] = await Promise.all([
    db().$queryRaw<{ day: Date; tasks: bigint; tokens: bigint | null }[]>(
      Prisma.sql`SELECT date_trunc('day', created_at) AS day, count(*)::bigint AS tasks, sum(coalesce(input_tokens,0) + coalesce(output_tokens,0))::bigint AS tokens
            FROM agent_tasks WHERE organization_id = ${organizationId}::uuid AND created_at >= ${since} GROUP BY 1 ORDER BY 1`,
    ),
    db().$queryRaw<{ day: Date; calls: bigint | null }[]>(
      Prisma.sql`SELECT date_trunc('day', occurred_at) AS day, sum(quantity)::bigint AS calls
            FROM usage_records WHERE organization_id = ${organizationId}::uuid AND meter = 'api.request' AND occurred_at >= ${since} GROUP BY 1 ORDER BY 1`,
    ),
  ]);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const ai = new Map(aiRows.map((r) => [key(r.day), r]));
  const api = new Map(apiRows.map((r) => [key(r.day), Number(r.calls ?? 0)]));
  const series: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const k = key(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
    series.push({
      day: k,
      tasks: Number(ai.get(k)?.tasks ?? 0),
      tokens: Number(ai.get(k)?.tokens ?? 0),
      apiCalls: api.get(k) ?? 0,
    });
  }
  const where = { organizationId };
  const [members, companies, workspaces, projects, workTasks, documents, chunks, leads, graphEntities, installations, apiKeys, customRoles, tokensToday, limits] =
    await Promise.all([
      limitUsage(db(), organizationId, "members"),
      limitUsage(db(), organizationId, "companies"),
      db().workspace.count({ where }),
      db().project.count({ where }),
      db().workTask.count({ where }),
      db().brainDocument.count({ where }),
      db().brainChunk.count({ where }),
      db().lead.count({ where }),
      db().graphEntity.count({ where }),
      db().marketplaceInstallation.count({
        where: { ...where, status: "ACTIVE" },
      }),
      limitUsage(db(), organizationId, "apiKeys"),
      db().role.count({
        where: {
          organizationId,
          isSystem: false,
          NOT: { key: { startsWith: API_KEY_ROLE_PREFIX } },
        },
      }),
      limitUsage(db(), organizationId, "aiTokens"),
      getOrgLimits(organizationId),
    ]);
  return {
    series,
    totals: {
      tasks: series.reduce((n, p) => n + p.tasks, 0),
      tokens: series.reduce((n, p) => n + p.tokens, 0),
      apiCalls: series.reduce((n, p) => n + p.apiCalls, 0),
    },
    counts: {
      members,
      companies,
      workspaces,
      projects,
      workTasks,
      documents,
      chunks,
      leads,
      graphEntities,
      installations,
      apiKeys,
      customRoles,
    },
    tokensToday,
    limits,
  };
}
