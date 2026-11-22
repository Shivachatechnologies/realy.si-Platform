import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { CUSTOM_ROLE_PREFIX, MAX_CUSTOM_TURNS } from "@/server/modules/agents/role-profiles";
import { HIERARCHY_TOOLS, profileByKey } from "@/server/modules/agents/profiles";
import { NEVER_FOR_AGENTS } from "@/server/modules/rbac/catalog";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { allTools, loadTools } from "@/server/modules/tools/registry";
import { DEPARTMENTS } from "./service";

/**
 * Company-defined AI roles (G1, B24): a role prompt, a tool allow-list chosen from the registered tools and a turn
 * limit, stored as data (AiRoleProfile) and resolved per company by agents/role-profiles.ts. A custom role can never
 * get a tool an agent may not hold (NEVER_FOR_AGENTS) and never more turns than the largest built-in role.
 */

export const MAX_CUSTOM_ROLES = 50;
const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "role";

export const roleInput = z.object({
  name: z.string().trim().min(2).max(80),
  department: z.enum(DEPARTMENTS),
  description: z.string().trim().max(500).nullable().optional(),
  instructions: z.string().trim().min(20).max(6000),
  tools: z.array(z.string().regex(/^[a-z_]{2,60}$/)).min(1).max(40),
  maxTurns: z.number().int().min(1).max(MAX_CUSTOM_TURNS).default(8),
});
export const updateRoleInput = roleInput.partial();

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "agents.read" | "agents.manage") {
  await requirePermission(ctx, permission, await companyChain(db(), organizationId, companyId));
}

/** Tools a custom role may be given: every registered tool an agent may hold (hierarchy tools are always added). */
export async function assignableTools(): Promise<{ name: string; description: string; needsApproval: boolean }[]> {
  await loadTools();
  return Object.values(allTools())
    .filter((t) => !t.permissions.some((p) => NEVER_FOR_AGENTS.has(p)) && !(HIERARCHY_TOOLS as readonly string[]).includes(t.name))
    .map((t) => ({ name: t.name, description: t.description, needsApproval: t.autonomy !== "AUTONOMOUS" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function checkTools(tools: string[]) {
  const ok = new Set((await assignableTools()).map((t) => t.name));
  const bad = tools.filter((t) => !ok.has(t));
  if (bad.length) throw invalid(`Unknown or not assignable tools: ${bad.join(", ")}`, { reason: "workforce_role_tool_invalid" });
}

export async function listRoles(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "agents.read");
  return db().aiRoleProfile.findMany({ where: { organizationId, companyId, archivedAt: null }, orderBy: { createdAt: "asc" }, take: MAX_CUSTOM_ROLES });
}

export async function createRole(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof roleInput>) {
  const input = roleInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.manage");
  await checkTools(input.tools);
  return transaction(async (tx) => {
    if ((await tx.aiRoleProfile.count({ where: { organizationId, companyId, archivedAt: null } })) >= MAX_CUSTOM_ROLES) throw conflict(`A company can define at most ${MAX_CUSTOM_ROLES} roles`, { reason: "workforce_role_limit" });
    // Keys are letters and underscores only (profile key format); a taken key gets a letter suffix (_b, _c, …).
    const base = `${CUSTOM_ROLE_PREFIX}${slug(input.name)}`;
    let key = base;
    for (let n = 2; profileByKey(key) || (await tx.aiRoleProfile.findFirst({ where: { companyId, key }, select: { id: true } })); n++) {
      if (n > 27) throw conflict("Too many roles with this name; choose another name", { reason: "workforce_role_name_taken" });
      key = `${base}_${String.fromCharCode(95 + n)}`;
    }
    const r = await tx.aiRoleProfile.create({
      data: { organizationId, companyId, key, name: input.name, department: input.department, description: input.description ?? null, instructions: input.instructions, tools: [...new Set(input.tools)], maxTurns: input.maxTurns, createdById: ctx.actor.id ?? organizationId },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_role.created", resourceType: "ai_role_profile", resourceId: r.id, newValue: { companyId, key, name: r.name, tools: r.tools, maxTurns: r.maxTurns } });
    return r;
  });
}

export async function updateRole(ctx: RequestContext, organizationId: string, companyId: string, roleId: string, raw: z.input<typeof updateRoleInput>) {
  const input = updateRoleInput.parse(raw);
  await authorize(ctx, organizationId, companyId, "agents.manage");
  if (input.tools) await checkTools(input.tools);
  if (!z.string().uuid().safeParse(roleId).success) throw notFound("Role");
  return transaction(async (tx) => {
    const before = await tx.aiRoleProfile.findFirst({ where: { id: roleId, organizationId, companyId, archivedAt: null } });
    if (!before) throw notFound("Role");
    const r = await tx.aiRoleProfile.update({ where: { id: roleId }, data: { ...input, ...(input.tools ? { tools: [...new Set(input.tools)] } : {}), ...(input.description !== undefined ? { description: input.description ?? null } : {}) } });
    // AI employees on this role keep only tools the role still has (their allow-list narrows, never widens).
    if (input.tools) {
      const employees = await tx.aiEmployee.findMany({ where: { companyId, profileKey: r.key, archivedAt: null }, select: { id: true, allowedTools: true } });
      for (const e of employees) if (e.allowedTools.length) await tx.aiEmployee.update({ where: { id: e.id }, data: { allowedTools: e.allowedTools.filter((t) => r.tools.includes(t)) } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_role.updated", resourceType: "ai_role_profile", resourceId: r.id, oldValue: { name: before.name, tools: before.tools, maxTurns: before.maxTurns }, newValue: { companyId, name: r.name, tools: r.tools, maxTurns: r.maxTurns } });
    return r;
  });
}

/** Archive a role: refused while active AI employees still hold it (reassign them first). */
export async function archiveRole(ctx: RequestContext, organizationId: string, companyId: string, roleId: string) {
  await authorize(ctx, organizationId, companyId, "agents.manage");
  if (!z.string().uuid().safeParse(roleId).success) throw notFound("Role");
  return transaction(async (tx) => {
    const r = await tx.aiRoleProfile.findFirst({ where: { id: roleId, organizationId, companyId, archivedAt: null } });
    if (!r) throw notFound("Role");
    const held = await tx.aiEmployee.count({ where: { companyId, profileKey: r.key, archivedAt: null } });
    if (held) throw conflict(`${held} AI employee(s) still have this role; change their role first`, { reason: "workforce_role_in_use" });
    await tx.aiRoleProfile.update({ where: { id: r.id }, data: { archivedAt: new Date() } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "ai_role.archived", resourceType: "ai_role_profile", resourceId: r.id, oldValue: { key: r.key, name: r.name } });
    return { ok: true };
  });
}
