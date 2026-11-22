import { db, type Tx } from "@/server/core/db";
import type { AgentProfile } from "./profile-types";
import { HIERARCHY_TOOLS, profileByKey } from "./profiles";

/**
 * Company-defined AI roles (G1, B24): a profile key starting with `custom_` resolves, per company, to an
 * AiRoleProfile row (role prompt, tool allow-list chosen from the registered tools, turn limit). Built-in keys always
 * resolve to code profiles, so a company can never shadow a built-in role. The runtime, tool gateway, approvals,
 * autonomy and budgets treat a custom role exactly like a built-in one.
 */

export const CUSTOM_ROLE_PREFIX = "custom_";
export const isCustomRoleKey = (key: string) => key.startsWith(CUSTOM_ROLE_PREFIX);
/** Upper bound on a custom role's turns (the largest built-in limit). */
export const MAX_CUSTOM_TURNS = 15;

export interface Scope {
  organizationId: string;
  companyId: string;
}

/** The company's custom role as an AgentProfile (hierarchy tools added like every role), or null. */
export async function customProfile(scope: Scope, key: string, tx?: Tx): Promise<AgentProfile | null> {
  if (!isCustomRoleKey(key)) return null;
  const row = await (tx ?? db()).aiRoleProfile.findFirst({ where: { ...scope, key, archivedAt: null }, select: { key: true, department: true, instructions: true, tools: true, maxTurns: true } });
  if (!row) return null;
  return { key: row.key, department: row.department, instructions: row.instructions, tools: [...new Set([...row.tools, ...HIERARCHY_TOOLS])], maxTurns: Math.min(Math.max(row.maxTurns, 1), MAX_CUSTOM_TURNS) };
}

/** Built-in profile, else the company's custom role (archived roles no longer resolve). */
export async function resolveProfile(scope: Scope, key: string, tx?: Tx): Promise<AgentProfile | undefined> {
  return profileByKey(key) ?? (await customProfile(scope, key, tx)) ?? undefined;
}
