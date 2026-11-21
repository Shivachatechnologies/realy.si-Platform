import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, transaction, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, conflict, invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent, emitEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { can, mfaSatisfied } from "@/server/modules/rbac/service";
import { companyChain, orgChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { authorizeOrg } from "@/server/modules/enterprise/policy";
import { createRoleInTx } from "@/server/modules/enterprise/roles";
import { installAiEmployees, installIntegrations, installPipelines, installSkills, installWorkflows, type BridgeResult, type BridgeScope } from "./bridges";
import { compareVersions, installConfigSchema, type InstallConfig, type Manifest } from "./manifest";
import { isLive, resolveListing, type ListingView } from "./service";

/**
 * Installs listings into a company. Installs are idempotent: records whose name already exists in the company are
 * skipped, so re-installing or upgrading only adds what is new. Areas the installer lacks permission for are skipped
 * and reported; module records that need a bridge (workflows, AI employees, pipelines, skills, integrations) are
 * reported as pending until those modules are wired (bridges.ts).
 */

export interface SectionResult {
  created: number;
  skipped: number;
  pending?: boolean;
  /** Skipped because the installer lacks the permission for this area. */
  forbidden?: string;
}
export type InstallSummary = Record<string, SectionResult> & {
  _settings?: SectionResult;
};

export const installInput = z.object({
  listingKey: z.string().min(3).max(140),
  version: z.string().max(20).optional(),
  pinned: z.boolean().default(false),
  config: installConfigSchema.default({}),
});
export const upgradeInput = z.object({
  version: z.string().max(20).optional(),
  config: installConfigSchema.optional(),
});
export const installationPatchInput = z.object({ pinned: z.boolean() });

async function authorize(ctx: RequestContext, organizationId: string, companyId: string, permission: "marketplace.read" | "marketplace.install", tx?: Tx) {
  const chain = await companyChain(tx ?? db(), organizationId, companyId);
  await authorizeOrg(ctx, organizationId, permission, tx, chain);
  return chain;
}

const day = (base: Date, offset?: number) => (offset === undefined ? null : new Date(base.getTime() + offset * 86_400_000));

function startDate(config: InstallConfig) {
  if (config.startDate) return new Date(`${config.startDate}T00:00:00Z`);
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

interface ApplyArgs {
  tx: Tx;
  ctx: RequestContext;
  organizationId: string;
  companyId: string;
  chain: ScopeChain;
  installationId: string;
  version: string;
  manifest: Manifest;
  config: InstallConfig;
}

/** Create everything a manifest describes (skipping existing names) and record what was created. */
async function applyManifest(a: ApplyArgs): Promise<InstallSummary> {
  const { tx, ctx, organizationId, companyId, chain, manifest: m, config } = a;
  const summary: InstallSummary = {};
  const items: Prisma.MarketplaceInstallItemCreateManyInput[] = [];
  const record = (entityType: string, entityId: string, name: string) =>
    items.push({
      organizationId,
      companyId,
      installationId: a.installationId,
      entityType,
      entityId,
      name,
      version: a.version,
    });
  const allowed = (p: string) => can(ctx, p, chain, tx);
  const createdBy = ctx.actor.id ?? organizationId;
  const base = startDate(config);
  const enabled = (key: "includeRoles" | "includeProjects" | "includeObjectives") => config[key] !== false;

  // Departments and teams (organization structure; HR owns the records, templates may create them).
  if (m.departments.length) {
    const s: SectionResult = { created: 0, skipped: 0 };
    const t: SectionResult = { created: 0, skipped: 0 };
    if (!(await allowed("hr.manage")) && !(await allowed("companies.manage"))) {
      s.forbidden = t.forbidden = "hr.manage";
    } else {
      for (const d of m.departments) {
        let dept = await tx.department.findUnique({
          where: { companyId_name: { companyId, name: d.name } },
          select: { id: true },
        });
        if (dept) s.skipped++;
        else {
          dept = await tx.department.create({
            data: {
              organizationId,
              companyId,
              name: d.name,
              description: d.description ?? null,
            },
            select: { id: true },
          });
          s.created++;
          record("department", dept.id, d.name);
        }
        for (const team of d.teams) {
          if (
            await tx.team.findUnique({
              where: { companyId_name: { companyId, name: team.name } },
              select: { id: true },
            })
          ) {
            t.skipped++;
            continue;
          }
          const row = await tx.team.create({
            data: {
              organizationId,
              companyId,
              departmentId: dept.id,
              name: team.name,
              description: team.description ?? null,
            },
            select: { id: true },
          });
          t.created++;
          record("team", row.id, team.name);
        }
      }
    }
    summary.departments = s;
    summary.teams = t;
  }

  // Custom roles (organization-wide; only when the installer may manage roles without escalating).
  if (m.roles.length && enabled("includeRoles")) {
    const s: SectionResult = { created: 0, skipped: 0 };
    // roles.manage is MFA-gated: without a fresh verification the roles are skipped, the rest still installs.
    if (!(await can(ctx, "roles.manage", orgChain(organizationId), tx)) || !mfaSatisfied(ctx)) s.forbidden = "roles.manage";
    else {
      for (const r of m.roles) {
        if (
          await tx.role.findFirst({
            where: { organizationId, key: r.key },
            select: { id: true },
          })
        ) {
          s.skipped++;
          continue;
        }
        // Keep only permissions the installer holds (no escalation through templates).
        const held: string[] = [];
        for (const p of r.permissions) if (await can(ctx, p, orgChain(organizationId), tx).catch(() => false)) held.push(p);
        if (!held.length) {
          s.skipped++;
          continue;
        }
        const role = await createRoleInTx(
          tx,
          ctx,
          organizationId,
          {
            key: r.key,
            name: r.name,
            description: r.description,
            permissions: held,
          },
          { audited: "marketplace install" },
        );
        s.created++;
        record("role", role.id, r.name);
      }
    }
    summary.roles = s;
  }

  // Projects with starter tasks.
  const projectIds = new Map<string, string>();
  if (m.projects.length && enabled("includeProjects")) {
    const s: SectionResult = { created: 0, skipped: 0 };
    const t: SectionResult = { created: 0, skipped: 0 };
    if (!(await allowed("projects.manage"))) s.forbidden = t.forbidden = "projects.manage";
    else {
      const workspace = config.workspaceId
        ? await tx.workspace.findFirst({
            where: { id: config.workspaceId, organizationId, companyId },
            select: { id: true },
          })
        : await tx.workspace.findFirst({
            where: { organizationId, companyId },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
      if (!workspace)
        throw invalid("The company has no workspace for projects", {
          reason: "marketplace_no_workspace",
        });
      for (const p of m.projects) {
        let project = await tx.project.findFirst({
          where: { organizationId, companyId, name: p.name },
          select: { id: true },
        });
        if (project) s.skipped++;
        else {
          project = await tx.project.create({
            data: {
              organizationId,
              companyId,
              workspaceId: workspace.id,
              name: p.name,
            },
            select: { id: true },
          });
          s.created++;
          record("project", project.id, p.name);
          await writeAudit(tx, ctx, {
            category: "TENANT",
            organizationId,
            action: "project.created",
            resourceType: "project",
            resourceId: project.id,
            newValue: { name: p.name, via: "marketplace" },
          });
          await emitDomainEvent(tx, ctx, "project.created", {
            organizationId,
            companyId,
            entityType: "project",
            entityId: project.id,
            data: { name: p.name, source: "marketplace" },
          });
        }
        projectIds.set(p.name, project.id);
        const existing = new Set(
          (
            await tx.workTask.findMany({
              where: { companyId, projectId: project.id },
              select: { title: true },
            })
          ).map((x) => x.title),
        );
        let position = existing.size;
        for (const task of p.tasks) {
          if (existing.has(task.title)) {
            t.skipped++;
            continue;
          }
          const row = await tx.workTask.create({
            data: {
              organizationId,
              companyId,
              projectId: project.id,
              title: task.title,
              description: task.description ?? null,
              priority: task.priority,
              dueDate: day(base, task.dueInDays),
              position: position++,
              sourceType: "marketplace_install",
              sourceId: a.installationId,
              createdById: createdBy,
            },
            select: { id: true },
          });
          t.created++;
          record("work_task", row.id, task.title);
        }
      }
    }
    summary.projects = s;
    summary.tasks = t;
  }

  // Objectives with milestones (linked to template projects by name).
  if (m.objectives.length && enabled("includeObjectives")) {
    const s: SectionResult = { created: 0, skipped: 0 };
    const ms: SectionResult = { created: 0, skipped: 0 };
    if (!(await allowed("objectives.manage"))) s.forbidden = ms.forbidden = "objectives.manage";
    else {
      for (const o of m.objectives) {
        let objective = await tx.objective.findFirst({
          where: { organizationId, companyId, title: o.title },
          select: { id: true },
        });
        if (objective) s.skipped++;
        else {
          objective = await tx.objective.create({
            data: {
              organizationId,
              companyId,
              title: o.title,
              description: o.description ?? null,
              targetDate: day(base, o.targetInDays),
              createdById: createdBy,
            },
            select: { id: true },
          });
          s.created++;
          record("objective", objective.id, o.title);
          await emitEvent(
            tx,
            ctx,
            "objective.created",
            { objectiveId: objective.id, companyId },
            {
              organizationId,
              companyId,
              aggregateType: "objective",
              aggregateId: objective.id,
            },
          );
        }
        const existing = new Set(
          (
            await tx.milestone.findMany({
              where: { objectiveId: objective.id },
              select: { title: true },
            })
          ).map((x) => x.title),
        );
        for (const mi of o.milestones) {
          if (existing.has(mi.title)) {
            ms.skipped++;
            continue;
          }
          const projectId = mi.project
            ? (projectIds.get(mi.project) ??
              (
                await tx.project.findFirst({
                  where: { organizationId, companyId, name: mi.project },
                  select: { id: true },
                })
              )?.id ??
              null)
            : null;
          const row = await tx.milestone.create({
            data: {
              organizationId,
              companyId,
              objectiveId: objective.id,
              title: mi.title,
              dueDate: day(base, mi.dueInDays),
              projectId,
            },
            select: { id: true },
          });
          ms.created++;
          record("milestone", row.id, mi.title);
        }
      }
    }
    summary.objectives = s;
    summary.milestones = ms;
  }

  // Module records through bridges (pending until the target modules are wired).
  const scope: BridgeScope = {
    organizationId,
    companyId,
    installationId: a.installationId,
  };
  const bridged: [string, Manifest[keyof Manifest] & unknown[], (tx: Tx, ctx: RequestContext, scope: BridgeScope, items: never) => Promise<BridgeResult>][] = [
    ["workflows", m.workflows, installWorkflows],
    ["aiEmployees", m.aiEmployees, installAiEmployees],
    ["pipelines", m.pipelines, installPipelines],
    ["skills", m.skills, installSkills],
    ["integrations", m.integrations, installIntegrations],
  ];
  for (const [key, list, fn] of bridged) {
    if (!list.length) continue;
    const r = await fn(tx, ctx, scope, list as never);
    summary[key] = {
      created: r.created,
      skipped: r.skipped ?? 0,
      pending: r.pending,
    };
  }

  // Company configuration: fiscal year start and base-currency confirmation (Company OS profile).
  const fiscal = config.fiscalYearStartMonth ?? m.settings.fiscalYearStartMonth;
  if (fiscal || config.confirmCurrency) {
    const s: SectionResult = { created: 0, skipped: 0 };
    if (!(await allowed("companies.manage"))) s.forbidden = "companies.manage";
    else {
      await tx.enterpriseCompanyProfile.upsert({
        where: { companyId },
        create: {
          organizationId,
          companyId,
          fiscalYearStartMonth: fiscal ?? 1,
          currencyConfirmedAt: config.confirmCurrency ? new Date() : null,
        },
        update: {
          ...(fiscal ? { fiscalYearStartMonth: fiscal } : {}),
          ...(config.confirmCurrency ? { currencyConfirmedAt: new Date() } : {}),
        },
      });
      s.created = 1;
    }
    summary._settings = s;
  }

  if (items.length) await tx.marketplaceInstallItem.createMany({ data: items });
  return summary;
}

function pickVersion(listing: ListingView, version?: string) {
  const v = version ? listing.versions.find((x) => x.version === version) : listing.versions[0];
  if (!v) throw notFound("Version");
  return v;
}

function assertInstallable(listing: ListingView, organizationId: string) {
  const own = listing.publisher.organizationId === organizationId;
  if (!isLive(listing) && !own) throw notFound("Listing");
  if (listing.pricingModel !== "FREE") {
    throw new AppError("not_available", "Paid listings can be installed once marketplace payments launch", { reason: "marketplace_paid_unavailable" });
  }
}

/** Keep only config keys the version declares. */
function scopedConfig(manifest: Manifest, config: InstallConfig): InstallConfig {
  const out: Record<string, unknown> = {};
  for (const k of manifest.config) if (config[k] !== undefined) out[k] = config[k];
  return out as InstallConfig;
}

export async function installListing(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof installInput>) {
  const input = installInput.parse(raw);
  const result = await transaction(
    async (tx) => {
      const chain = await authorize(ctx, organizationId, companyId, "marketplace.install", tx);
      const listing = await resolveListing(tx, input.listingKey, organizationId);
      if (!listing) throw notFound("Listing");
      assertInstallable(listing, organizationId);
      const version = pickVersion(listing, input.version);
      const config = scopedConfig(version.manifest, input.config);
      const existing = await tx.marketplaceInstallation.findUnique({
        where: { companyId_listingKey: { companyId, listingKey: listing.key } },
      });
      if (existing?.status === "ACTIVE")
        throw conflict("Already installed in this company", {
          reason: "marketplace_already_installed",
          installationId: existing.id,
        });
      const data = {
        listingType: listing.type,
        listingName: listing.name,
        version: version.version,
        pinned: input.pinned,
        config: config as Prisma.InputJsonValue,
        status: "ACTIVE" as const,
        installedById: ctx.actor.id ?? organizationId,
        installedAt: new Date(),
        uninstalledAt: null,
      };
      const installation = existing
        ? await tx.marketplaceInstallation.update({
            where: { id: existing.id },
            data,
          })
        : await tx.marketplaceInstallation.create({
            data: {
              ...data,
              organizationId,
              companyId,
              listingKey: listing.key,
            },
          });
      const summary = await applyManifest({
        tx,
        ctx,
        organizationId,
        companyId,
        chain,
        installationId: installation.id,
        version: version.version,
        manifest: version.manifest,
        config,
      });
      await tx.marketplaceInstallation.update({
        where: { id: installation.id },
        data: { summary: summary as unknown as Prisma.InputJsonValue },
      });
      await writeAudit(tx, ctx, {
        category: "TENANT",
        organizationId,
        action: existing ? "marketplace.reinstalled" : "marketplace.installed",
        resourceType: "marketplace_installation",
        resourceId: installation.id,
        newValue: {
          listingKey: listing.key,
          version: version.version,
          config,
          summary,
        },
      });
      const recipients = await usersWithPermission(tx, organizationId, companyId, "marketplace.install");
      await notifyUsers(
        tx,
        organizationId,
        recipients.filter((u) => u !== ctx.actor.id),
        "marketplace.installed",
        {
          companyId,
          title: listing.name,
          href: `/marketplace/installed#${installation.id}`,
        },
      );
      return {
        id: installation.id,
        listingKey: listing.key,
        version: version.version,
        summary,
      };
    },
    { timeout: 60_000 },
  );
  return result;
}

async function activeInstallation(tx: Tx, organizationId: string, companyId: string, installationId: string) {
  if (!z.string().uuid().safeParse(installationId).success) throw notFound("Installation");
  const inst = await tx.marketplaceInstallation.findFirst({
    where: { id: installationId, organizationId, companyId, status: "ACTIVE" },
  });
  if (!inst) throw notFound("Installation");
  return inst;
}

/** Upgrade to a newer version (latest by default); idempotent apply adds only what is new. */
export async function upgradeInstallation(ctx: RequestContext, organizationId: string, companyId: string, installationId: string, raw: z.input<typeof upgradeInput>) {
  const input = upgradeInput.parse(raw);
  return transaction(
    async (tx) => {
      const chain = await authorize(ctx, organizationId, companyId, "marketplace.install", tx);
      const inst = await activeInstallation(tx, organizationId, companyId, installationId);
      const listing = await resolveListing(tx, inst.listingKey, organizationId);
      if (!listing) throw notFound("Listing");
      assertInstallable(listing, organizationId);
      const version = pickVersion(listing, input.version);
      if (compareVersions(version.version, inst.version) <= 0)
        throw invalid("Choose a newer version", {
          reason: "marketplace_not_newer",
        });
      const config = scopedConfig(version.manifest, {
        ...(inst.config as InstallConfig),
        ...(input.config ?? {}),
      });
      const summary = await applyManifest({
        tx,
        ctx,
        organizationId,
        companyId,
        chain,
        installationId: inst.id,
        version: version.version,
        manifest: version.manifest,
        config,
      });
      await tx.marketplaceInstallation.update({
        where: { id: inst.id },
        data: {
          version: version.version,
          config: config as Prisma.InputJsonValue,
          summary: summary as unknown as Prisma.InputJsonValue,
          listingName: listing.name,
        },
      });
      await writeAudit(tx, ctx, {
        category: "TENANT",
        organizationId,
        action: "marketplace.upgraded",
        resourceType: "marketplace_installation",
        resourceId: inst.id,
        oldValue: { version: inst.version },
        newValue: { version: version.version, summary },
      });
      return { id: inst.id, version: version.version, summary };
    },
    { timeout: 60_000 },
  );
}

export async function setPinned(ctx: RequestContext, organizationId: string, companyId: string, installationId: string, raw: z.input<typeof installationPatchInput>) {
  const input = installationPatchInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketplace.install", tx);
    const inst = await activeInstallation(tx, organizationId, companyId, installationId);
    const updated = await tx.marketplaceInstallation.update({
      where: { id: inst.id },
      data: { pinned: input.pinned },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: input.pinned ? "marketplace.pinned" : "marketplace.unpinned",
      resourceType: "marketplace_installation",
      resourceId: inst.id,
      newValue: { version: inst.version },
    });
    return updated;
  });
}

/** Uninstall: the installation stops receiving upgrades; records it created stay (they are company data now). */
export async function uninstall(ctx: RequestContext, organizationId: string, companyId: string, installationId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketplace.install", tx);
    const inst = await activeInstallation(tx, organizationId, companyId, installationId);
    const updated = await tx.marketplaceInstallation.update({
      where: { id: inst.id },
      data: { status: "UNINSTALLED", uninstalledAt: new Date() },
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "marketplace.uninstalled",
      resourceType: "marketplace_installation",
      resourceId: inst.id,
      oldValue: { listingKey: inst.listingKey, version: inst.version },
    });
    return updated;
  });
}

export async function listInstallations(ctx: RequestContext, organizationId: string, companyId: string, opts: { includeUninstalled?: boolean } = {}) {
  await authorize(ctx, organizationId, companyId, "marketplace.read");
  return db().marketplaceInstallation.findMany({
    where: {
      organizationId,
      companyId,
      ...(opts.includeUninstalled ? {} : { status: "ACTIVE" }),
    },
    orderBy: { installedAt: "desc" },
    take: 200,
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        take: 500,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          name: true,
          version: true,
        },
      },
    },
  });
}

/** The company's installation of one listing (if any), for the detail page. */
export async function installationFor(ctx: RequestContext, organizationId: string, companyId: string, listingKey: string) {
  await authorize(ctx, organizationId, companyId, "marketplace.read");
  return db().marketplaceInstallation.findUnique({
    where: { companyId_listingKey: { companyId, listingKey } },
  });
}

/**
 * Install a manifest generated at runtime (AI Company Builder) the same way listings install: one installation per
 * source (`listingKey`, e.g. "builder/<runId>") that every apply adds to; applying is idempotent (existing names are
 * skipped). Runs inside the caller's permissions; areas they may not manage are skipped and reported.
 */
export async function installGeneratedManifest(
  ctx: RequestContext,
  organizationId: string,
  companyId: string,
  input: { listingKey: string; name: string; version?: string; manifest: Manifest; config?: InstallConfig },
) {
  const version = input.version ?? "1.0.0";
  const config = installConfigSchema.parse(input.config ?? {});
  return transaction(
    async (tx) => {
      const chain = await authorize(ctx, organizationId, companyId, "marketplace.install", tx);
      const existing = await tx.marketplaceInstallation.findUnique({ where: { companyId_listingKey: { companyId, listingKey: input.listingKey } } });
      const installation =
        existing ??
        (await tx.marketplaceInstallation.create({
          data: {
            organizationId,
            companyId,
            listingKey: input.listingKey,
            listingType: "COMPANY_TEMPLATE",
            listingName: input.name,
            version,
            config: config as Prisma.InputJsonValue,
            status: "ACTIVE",
            installedById: ctx.actor.id ?? organizationId,
          },
        }));
      const summary = await applyManifest({ tx, ctx, organizationId, companyId, chain, installationId: installation.id, version, manifest: input.manifest, config });
      const previous = (existing?.summary ?? {}) as unknown as Record<string, SectionResult>;
      const merged: InstallSummary = { ...previous };
      for (const [k, v] of Object.entries(summary)) {
        const p = previous[k];
        merged[k] = p ? { ...v, created: p.created + v.created, skipped: v.skipped } : v;
      }
      await tx.marketplaceInstallation.update({
        where: { id: installation.id },
        data: { summary: merged as unknown as Prisma.InputJsonValue, status: "ACTIVE", uninstalledAt: null },
      });
      await writeAudit(tx, ctx, {
        category: "TENANT",
        organizationId,
        action: "marketplace.generated_installed",
        resourceType: "marketplace_installation",
        resourceId: installation.id,
        newValue: { listingKey: input.listingKey, summary },
      });
      return { installationId: installation.id, summary };
    },
    { timeout: 60_000 },
  );
}
