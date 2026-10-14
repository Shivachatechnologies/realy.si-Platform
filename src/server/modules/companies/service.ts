import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid } from "@/server/core/errors";
import { prismaPage, toPage, pageInput, type PageInput } from "@/server/core/pagination";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { can, loadGrants, requirePermission } from "@/server/modules/rbac/service";
import { companyChain, orgChain, workspaceChain } from "@/server/modules/rbac/scope";
import { slugify } from "@/server/modules/organizations/service";
import { closestLocale } from "@/i18n/config";

const iso2 = z.string().regex(/^[A-Z]{2}$/);
const DATA_REGIONS = ["US_EAST", "EU_WEST", "ME_CENTRAL", "AP_SOUTH", "AP_SOUTHEAST"] as const;

export const createCompanyInput = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(200).optional(),
  stage: z.enum(["IDEA", "FORMING", "BUILDING", "LAUNCHED", "SCALING"]).default("IDEA"),
  incorporationCountryCode: iso2.optional(),
  operatingCountryCodes: z.array(iso2).max(250).default([]),
  targetMarketCodes: z.array(iso2).max(250).default([]),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  defaultLocale: z.string().max(35).optional(),
  timezone: z.string().max(64).optional(),
  dataRegion: z.enum(DATA_REGIONS).optional(),
});
export type CreateCompanyInput = z.input<typeof createCompanyInput>;

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a company. The incorporation country only *suggests* currency/locale/timezone/data region;
 * any explicitly supplied value wins (docs/globalization.md §1). A default workspace is created.
 */
export async function createCompany(ctx: RequestContext, organizationId: string, raw: CreateCompanyInput) {
  const input = createCompanyInput.parse(raw);
  return transaction(async (tx) => {
    await requirePermission(ctx, "companies.manage", orgChain(organizationId), tx);

    const codes = [...new Set([input.incorporationCountryCode, ...input.operatingCountryCodes, ...input.targetMarketCodes].filter(Boolean) as string[])];
    const countries = await tx.country.findMany({ where: { code: { in: codes } }, include: { region: true } });
    const missing = codes.filter((c) => !countries.some((k) => k.code === c));
    if (missing.length) throw invalid(`Unknown country codes: ${missing.join(", ")}`);
    const home = countries.find((c) => c.code === input.incorporationCountryCode);

    const baseCurrency = input.baseCurrency ?? home?.defaultCurrency ?? "USD";
    if (!(await tx.currency.findUnique({ where: { code: baseCurrency } }))) throw invalid(`Unknown currency ${baseCurrency}`);
    const timezone = input.timezone ?? home?.defaultTimezone ?? "UTC";
    if (!validTimezone(timezone)) throw invalid(`Unknown timezone ${timezone}`);

    const slug = slugify(input.name);
    if (await tx.company.findUnique({ where: { organizationId_slug: { organizationId, slug } } })) {
      throw conflict("A company with this name already exists in the organization");
    }
    const company = await tx.company.create({
      data: {
        organizationId,
        name: input.name,
        legalName: input.legalName ?? null,
        slug,
        stage: input.stage,
        incorporationCountryCode: input.incorporationCountryCode ?? null,
        operatingCountryCodes: input.operatingCountryCodes,
        targetMarketCodes: input.targetMarketCodes,
        baseCurrency,
        defaultLocale: closestLocale(input.defaultLocale ?? home?.defaultLocale),
        timezone,
        dataRegion: input.dataRegion ?? home?.region.dataRegion ?? "US_EAST",
        createdById: ctx.actor.id ?? organizationId,
      },
    });
    const workspace = await tx.workspace.create({
      data: { organizationId, companyId: company.id, name: "General", slug: "general" },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "company.created",
      resourceType: "company",
      resourceId: company.id,
      newValue: company,
    });
    await emitEvent(
      tx,
      ctx,
      "company.created",
      {
        companyId: company.id,
        organizationId,
        incorporationCountryCode: company.incorporationCountryCode,
        dataRegion: company.dataRegion,
      },
      { organizationId, companyId: company.id, aggregateType: "company", aggregateId: company.id },
    );
    await emitEvent(tx, ctx, "workspace.created", { workspaceId: workspace.id, companyId: company.id }, {
      organizationId,
      companyId: company.id,
      aggregateType: "workspace",
      aggregateId: workspace.id,
    });
    return company;
  });
}

/**
 * Companies visible to the actor: all of them with org-level `companies.read`, otherwise only the
 * companies where the actor holds a company-scoped grant.
 */
export async function listCompanies(ctx: RequestContext, organizationId: string, rawPage: Partial<PageInput> = {}) {
  const page = pageInput.parse(rawPage);
  const chain = orgChain(organizationId);
  let filter: { id?: { in: string[] } } = {};
  if (!(await can(ctx, "companies.read", chain))) {
    if (ctx.actor.type === "SYSTEM" || !ctx.actor.id) return toPage([], page);
    // Not an org-wide reader: membership is still required to see anything at all.
    const member = ctx.actor.type !== "USER" || (await db().membership.findFirst({ where: { organizationId, userId: ctx.actor.id, status: "ACTIVE" } }));
    if (!member) await requirePermission(ctx, "companies.read", chain); // throws not_found
    const grants = await loadGrants(db(), ctx.actor.type as "USER", ctx.actor.id);
    const ids = grants.filter((g) => g.scopeType === "COMPANY" && g.permissions.has("companies.read")).map((g) => g.scopeId);
    filter = { id: { in: ids } };
  }
  const rows = await db().company.findMany({
    where: { organizationId, deletedAt: null, ...filter },
    orderBy: { id: "asc" },
    ...prismaPage(page),
  });
  return toPage(rows, page);
}

export async function getCompany(ctx: RequestContext, organizationId: string, companyId: string) {
  // A company of another organization resolves to not_found, as does any company for a non-member.
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "companies.read", chain);
  return db().company.findFirstOrThrow({ where: { id: companyId, organizationId } });
}

export const createWorkspaceInput = z.object({ name: z.string().trim().min(1).max(80) });

export async function createWorkspace(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof createWorkspaceInput>) {
  const input = createWorkspaceInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await companyChain(tx, organizationId, companyId);
    await requirePermission(ctx, "workspaces.manage", chain, tx);
    const slug = slugify(input.name);
    if (await tx.workspace.findUnique({ where: { organizationId_companyId_slug: { organizationId, companyId, slug } } })) {
      throw conflict("A workspace with this name already exists");
    }
    const ws = await tx.workspace.create({ data: { organizationId, companyId, name: input.name, slug } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "workspace.created", resourceType: "workspace", resourceId: ws.id, newValue: ws });
    await emitEvent(tx, ctx, "workspace.created", { workspaceId: ws.id, companyId }, {
      organizationId,
      companyId,
      aggregateType: "workspace",
      aggregateId: ws.id,
    });
    return ws;
  });
}

export async function listWorkspaces(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "workspaces.read", chain);
  return db().workspace.findMany({ where: { organizationId, companyId }, orderBy: { createdAt: "asc" } });
}

export const createProjectInput = z.object({ name: z.string().trim().min(1).max(120) });

export async function createProject(ctx: RequestContext, organizationId: string, workspaceId: string, raw: z.input<typeof createProjectInput>) {
  const input = createProjectInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await workspaceChain(tx, organizationId, workspaceId);
    await requirePermission(ctx, "projects.manage", chain, tx);
    const companyId = chain.find((s) => s.type === "COMPANY")!.id;
    const project = await tx.project.create({ data: { organizationId, companyId, workspaceId, name: input.name } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "project.created", resourceType: "project", resourceId: project.id, newValue: project });
    return project;
  });
}
