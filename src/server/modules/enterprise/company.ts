import { z } from "zod";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitEvent } from "@/server/modules/events/emit";
import { companyChain } from "@/server/modules/rbac/scope";
import { slugify } from "@/server/modules/organizations/service";
import { assertWithinLimit, authorizeOrg } from "./policy";

/** Company OS: the company profile (core `companies` columns + enterprise_company_profiles) and workspaces. */

const blank = z.literal("").transform(() => undefined);
const iso2 = z.string().regex(/^[A-Z]{2}$/);

export const addressSchema = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: iso2.optional().or(blank),
});
export type CompanyAddress = z.infer<typeof addressSchema>;

export const companyProfileInput = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(200).optional().or(blank),
  industry: z.string().trim().max(120).optional().or(blank),
  website: z.string().trim().url().max(300).optional().or(blank),
  logoUrl: z.string().trim().url().max(500).optional().or(blank),
  description: z.string().trim().max(2000).optional().or(blank),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  timezone: z.string().max(64),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  /** Must be true when baseCurrency changes (existing money stays in the old currency). */
  confirmCurrencyChange: z.boolean().default(false),
  address: addressSchema.default({}),
});

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getCompanyProfile(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  await authorizeOrg(ctx, organizationId, "companies.read", undefined, chain);
  const [company, profile] = await Promise.all([
    db().company.findFirstOrThrow({ where: { id: companyId, organizationId } }),
    db().enterpriseCompanyProfile.findUnique({ where: { companyId } }),
  ]);
  return {
    company,
    profile: {
      industry: profile?.industry ?? null,
      website: profile?.website ?? null,
      logoUrl: profile?.logoUrl ?? null,
      description: profile?.description ?? null,
      fiscalYearStartMonth: profile?.fiscalYearStartMonth ?? 1,
      address: (profile?.address ?? {}) as CompanyAddress,
      currencyConfirmedAt: profile?.currencyConfirmedAt ?? null,
    },
  };
}

export async function updateCompanyProfile(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof companyProfileInput>) {
  const input = companyProfileInput.parse(raw);
  if (!validTimezone(input.timezone)) throw invalid(`Unknown timezone ${input.timezone}`);
  return transaction(async (tx) => {
    const chain = await companyChain(tx, organizationId, companyId);
    await authorizeOrg(ctx, organizationId, "companies.manage", tx, chain);
    const before = await tx.company.findFirstOrThrow({
      where: { id: companyId, organizationId },
    });
    const currencyChanged = before.baseCurrency !== input.baseCurrency;
    if (currencyChanged) {
      if (!input.confirmCurrencyChange)
        throw invalid("Confirm the base currency change", {
          reason: "enterprise_confirm_currency",
        });
      if (!(await tx.currency.findUnique({ where: { code: input.baseCurrency } }))) throw invalid(`Unknown currency ${input.baseCurrency}`);
    }
    const slug = slugify(input.name);
    if (
      slug !== before.slug &&
      (await tx.company.findUnique({
        where: { organizationId_slug: { organizationId, slug } },
      }))
    ) {
      throw conflict("A company with this name already exists in the organization");
    }
    const company = await tx.company.update({
      where: { id: companyId },
      data: {
        name: input.name,
        slug,
        legalName: input.legalName ?? null,
        timezone: input.timezone,
        baseCurrency: input.baseCurrency,
      },
    });
    const profileData = {
      industry: input.industry ?? null,
      website: input.website ?? null,
      logoUrl: input.logoUrl ?? null,
      description: input.description ?? null,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
      address: input.address,
      ...(currencyChanged ? { currencyConfirmedAt: new Date() } : {}),
    };
    await tx.enterpriseCompanyProfile.upsert({
      where: { companyId },
      create: { organizationId, companyId, ...profileData },
      update: profileData,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: currencyChanged ? "company.base_currency_changed" : "company.profile_updated",
      resourceType: "company",
      resourceId: companyId,
      oldValue: {
        name: before.name,
        legalName: before.legalName,
        timezone: before.timezone,
        baseCurrency: before.baseCurrency,
      },
      newValue: {
        ...profileData,
        name: input.name,
        legalName: input.legalName,
        timezone: input.timezone,
        baseCurrency: input.baseCurrency,
      },
    });
    return company;
  });
}

// ───────────── Workspaces ─────────────

export const workspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function listCompanyWorkspaces(ctx: RequestContext, organizationId: string, companyId: string) {
  const chain = await companyChain(db(), organizationId, companyId);
  await authorizeOrg(ctx, organizationId, "workspaces.read", undefined, chain);
  return db().workspace.findMany({
    where: { organizationId, companyId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { projects: true } } },
  });
}

export async function createWorkspace(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof workspaceInput>) {
  const input = workspaceInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await companyChain(tx, organizationId, companyId);
    await authorizeOrg(ctx, organizationId, "workspaces.manage", tx, chain);
    await assertWithinLimit(organizationId, "workspaces", {
      client: tx,
      companyId,
    });
    const slug = slugify(input.name);
    if (
      await tx.workspace.findUnique({
        where: {
          organizationId_companyId_slug: { organizationId, companyId, slug },
        },
      })
    )
      throw conflict("A workspace with this name already exists");
    const ws = await tx.workspace.create({
      data: { organizationId, companyId, name: input.name, slug },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "workspace.created",
      resourceType: "workspace",
      resourceId: ws.id,
      newValue: ws,
    });
    await emitEvent(
      tx,
      ctx,
      "workspace.created",
      { workspaceId: ws.id, companyId },
      {
        organizationId,
        companyId,
        aggregateType: "workspace",
        aggregateId: ws.id,
      },
    );
    return ws;
  });
}

async function ownWorkspace(tx: Tx, organizationId: string, companyId: string, workspaceId: string) {
  if (!z.string().uuid().safeParse(workspaceId).success) throw notFound("Workspace");
  const ws = await tx.workspace.findFirst({
    where: { id: workspaceId, organizationId, companyId },
    include: { _count: { select: { projects: true } } },
  });
  if (!ws) throw notFound("Workspace");
  return ws;
}

export async function renameWorkspace(ctx: RequestContext, organizationId: string, companyId: string, workspaceId: string, raw: z.input<typeof workspaceInput>) {
  const input = workspaceInput.parse(raw);
  return transaction(async (tx) => {
    const chain = await companyChain(tx, organizationId, companyId);
    await authorizeOrg(ctx, organizationId, "workspaces.manage", tx, chain);
    const ws = await ownWorkspace(tx, organizationId, companyId, workspaceId);
    const slug = slugify(input.name);
    const clash = await tx.workspace.findUnique({
      where: {
        organizationId_companyId_slug: { organizationId, companyId, slug },
      },
    });
    if (clash && clash.id !== ws.id) throw conflict("A workspace with this name already exists");
    const updated = await tx.workspace.update({
      where: { id: ws.id },
      data: { name: input.name, slug },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "workspace.renamed",
      resourceType: "workspace",
      resourceId: ws.id,
      oldValue: { name: ws.name },
      newValue: { name: input.name },
    });
    return updated;
  });
}

/** Delete an empty workspace (never the company's last one). */
export async function deleteWorkspace(ctx: RequestContext, organizationId: string, companyId: string, workspaceId: string) {
  await transaction(async (tx) => {
    const chain = await companyChain(tx, organizationId, companyId);
    await authorizeOrg(ctx, organizationId, "workspaces.manage", tx, chain);
    const ws = await ownWorkspace(tx, organizationId, companyId, workspaceId);
    if (ws._count.projects > 0)
      throw conflict("Move or delete the workspace's projects first", {
        reason: "enterprise_workspace_not_empty",
      });
    if ((await tx.workspace.count({ where: { organizationId, companyId } })) <= 1)
      throw conflict("A company keeps at least one workspace", {
        reason: "enterprise_last_workspace",
      });
    await tx.workspace.delete({ where: { id: ws.id } });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "workspace.deleted",
      resourceType: "workspace",
      resourceId: ws.id,
      oldValue: { name: ws.name },
    });
  });
}
