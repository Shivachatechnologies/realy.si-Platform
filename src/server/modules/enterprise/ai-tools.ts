import { z } from "zod";
import { db } from "@/server/core/db";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { API_KEY_ROLE_PREFIX } from "./roles";

/** AI tools of the enterprise module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const ENTERPRISE_TOOLS: Record<string, ToolDefinition> = {
  read_org_structure: def({
    name: "read_org_structure",
    version: 1,
    description:
      "Returns the company's operating structure: departments with teams, workspaces with project counts, the organization's roles (system and custom, with permission counts) and how many members hold each.",
    input: z.object({}).strict(),
    modelSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    permissions: ["companies.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read the organization structure",
    async execute(_input, { ctx, organizationId, companyId }) {
      await requirePermission(ctx, "companies.read", await companyChain(db(), organizationId, companyId));
      const [company, departments, workspaces, roles, assignments] = await Promise.all([
        db().company.findFirstOrThrow({
          where: { id: companyId, organizationId },
          select: { name: true, baseCurrency: true, timezone: true },
        }),
        db().department.findMany({
          where: { organizationId, companyId, archivedAt: null },
          orderBy: { name: "asc" },
          include: {
            teams: { where: { archivedAt: null }, select: { name: true } },
          },
        }),
        db().workspace.findMany({
          where: { organizationId, companyId },
          select: { name: true, _count: { select: { projects: true } } },
        }),
        db().role.findMany({
          where: {
            OR: [
              {
                organizationId,
                NOT: { key: { startsWith: API_KEY_ROLE_PREFIX } },
              },
              { organizationId: null, assignableAt: { has: "COMPANY" } },
            ],
          },
          select: {
            id: true,
            key: true,
            name: true,
            isSystem: true,
            _count: { select: { permissions: true } },
          },
        }),
        db().roleAssignment.groupBy({
          by: ["roleId"],
          where: { organizationId, principalType: "USER" },
          _count: { _all: true },
        }),
      ]);
      const held = new Map(assignments.map((a) => [a.roleId, a._count._all]));
      const content = [
        `Company: ${company.name} (base currency ${company.baseCurrency}, timezone ${company.timezone})`,
        `Departments:\n${departments.length ? departments.map((d) => `- ${d.name}${d.teams.length ? `: ${d.teams.map((t) => t.name).join(", ")}` : ""}`).join("\n") : "(none)"}`,
        `Workspaces:\n${workspaces.map((w) => `- ${w.name} (${w._count.projects} projects)`).join("\n")}`,
        `Roles:\n${roles.map((r) => `- ${r.name} [${r.isSystem ? "system" : "custom"} ${r.key}] ${r._count.permissions} permissions, ${held.get(r.id) ?? 0} members`).join("\n")}`,
      ].join("\n\n");
      return { content, count: departments.length };
    },
  }),
};
