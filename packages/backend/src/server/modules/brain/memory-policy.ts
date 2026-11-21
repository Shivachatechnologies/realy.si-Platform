import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { PERMISSIONS } from "@/server/modules/rbac/catalog";
import { can, effectivePermissions } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";

/**
 * Governance vocabulary of the shared company memory: layers, scopes, sensitivity and the read rules every query
 * applies (tenant + permission). Pure data and helpers — no writes.
 *
 * Read rule for a memory or document (on top of brain.read and tenant isolation):
 *  - an explicit `readPermission` (e.g. finance.read) must be held by the reader;
 *  - department knowledge of a finance / HR / payroll department needs that area's read permission;
 *  - RESTRICTED sensitivity needs brain.manage;
 *  - expired rows are never returned.
 */

export const MEMORY_LAYERS = ["COMPANY", "KNOWLEDGE", "DOCUMENT", "PRODUCT", "BRAND", "CUSTOMER", "DEPARTMENT", "EMPLOYEE", "TASK", "CONVERSATION"] as const;
export type MemoryLayerKey = (typeof MEMORY_LAYERS)[number];
export const MEMORY_SCOPES = ["COMPANY", "DEPARTMENT", "EMPLOYEE", "TASK"] as const;
export type MemoryScopeKey = (typeof MEMORY_SCOPES)[number];
export const MEMORY_SENSITIVITIES = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export type MemorySensitivityKey = (typeof MEMORY_SENSITIVITIES)[number];
export const MEMORY_SOURCE_KINDS = ["MANUAL", "AI_APPROVED", "AI_EMPLOYEE", "CONVERSATION", "ROLLUP", "IMPORT"] as const;

/** Layers whose rows are written by AI tasks for themselves (no approval): the AI employee's and the task's own notes. */
export const SELF_SCOPES: readonly MemoryScopeKey[] = ["EMPLOYEE", "TASK"];

/** Default retention (days) of layers without a company policy; null = keep. */
export const DEFAULT_RETENTION_DAYS: Partial<Record<MemoryLayerKey, number>> = { CONVERSATION: 180, TASK: 365 };

/** Tenant read permissions that can gate a memory (e.g. finance.read, hr.read). */
export const READ_PERMISSIONS = PERMISSIONS.filter((p) => !p.platformOnly && p.key.endsWith(".read")).map((p) => p.key);

/** Area read permission implied by a department's name (finance / HR / payroll knowledge is not company-wide). */
export function permissionForDepartment(name: string): string | null {
  const n = name.toLowerCase();
  if (/payroll|lohn|salar/.test(n)) return "payroll.read";
  if (/financ|accounting|treasury|controlling|buchhalt|finanz|المالي|财务|वित्त/.test(n)) return "finance.read";
  if (/\bhr\b|human|people|talent|recruit|personal|personnel|الموارد|人力|मानव/.test(n)) return "hr.read";
  return null;
}

export interface ReadAccess {
  organizationId: string;
  companyId: string;
  chain: ScopeChain;
  /** Read permissions the reader holds (subset of READ_PERMISSIONS). */
  allowedPerms: string[];
  manage: boolean;
  /** Departments whose knowledge the reader may not see (implied area permission missing). */
  deniedDepartments: string[];
}

/** What the reader may see in this company's memory. `null` when they may not read Company Brain at all. */
export async function readAccess(ctx: RequestContext, organizationId: string, companyId: string): Promise<ReadAccess | null> {
  const chain = await companyChain(db(), organizationId, companyId);
  if (!(await can(ctx, "brain.read", chain))) return null;
  const perms = new Set(await effectivePermissions(ctx, chain));
  const departments = await db().department.findMany({ where: { organizationId, companyId }, select: { id: true, name: true } });
  return {
    organizationId,
    companyId,
    chain,
    allowedPerms: READ_PERMISSIONS.filter((p) => perms.has(p)),
    manage: perms.has("brain.manage"),
    deniedDepartments: departments.filter((d) => {
      const p = permissionForDepartment(d.name);
      return p !== null && !perms.has(p);
    }).map((d) => d.id),
  };
}

/** Prisma filter: memories the reader may see (tenant + governance + not expired). */
export function memoryReadWhere(a: ReadAccess, now = new Date()): Prisma.CompanyMemoryWhereInput {
  return {
    organizationId: a.organizationId,
    companyId: a.companyId,
    AND: [
      { OR: [{ readPermission: null }, { readPermission: { in: a.allowedPerms } }] },
      a.manage ? {} : { sensitivity: { not: "RESTRICTED" } },
      a.deniedDepartments.length ? { OR: [{ departmentId: null }, { departmentId: { notIn: a.deniedDepartments } }] } : {},
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  };
}

/** SQL filter for alias `m` (company_memories). */
export function memoryReadSql(a: ReadAccess): Prisma.Sql {
  return Prisma.sql`m.organization_id = ${a.organizationId}::uuid AND m.company_id = ${a.companyId}::uuid
    AND (m.read_permission IS NULL OR m.read_permission = ANY(${a.allowedPerms}::text[]))
    AND (${a.manage} OR m.sensitivity::text <> 'RESTRICTED')
    AND (m.department_id IS NULL OR NOT (m.department_id = ANY(${a.deniedDepartments}::uuid[])))
    AND (m.expires_at IS NULL OR m.expires_at > now())`;
}

/** SQL filter for aliases `d` (brain_documents) and `p` (LEFT JOIN brain_document_policies). */
export function documentReadSql(a: ReadAccess): Prisma.Sql {
  return Prisma.sql`d.organization_id = ${a.organizationId}::uuid AND d.company_id = ${a.companyId}::uuid AND d.status = 'READY'
    AND (p.read_permission IS NULL OR p.read_permission = ANY(${a.allowedPerms}::text[]))
    AND (${a.manage} OR p.sensitivity IS NULL OR p.sensitivity::text <> 'RESTRICTED')
    AND (d.department_id IS NULL OR NOT (d.department_id = ANY(${a.deniedDepartments}::uuid[])))
    AND (p.expires_at IS NULL OR p.expires_at > now())`;
}

/** May the reader see this one row? (Same rule as the SQL filters.) */
export function canReadRow(a: ReadAccess, row: { readPermission: string | null; sensitivity: string | null; departmentId: string | null; expiresAt?: Date | null }) {
  if (row.readPermission && !a.allowedPerms.includes(row.readPermission)) return false;
  if (row.sensitivity === "RESTRICTED" && !a.manage) return false;
  if (row.departmentId && a.deniedDepartments.includes(row.departmentId)) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  return true;
}
