import type { ScopeType, MarketType } from "@/generated/prisma/enums";
import type { Tx, Db } from "@/server/core/db";
import { notFound } from "@/server/core/errors";

export interface ScopeRef {
  type: ScopeType;
  id: string;
}

/** Path from a resource up to its root, most specific first (docs/rbac.md §1). */
export type ScopeChain = ScopeRef[];

export const PLATFORM_ID = "*";

export const platformChain = (): ScopeChain => [{ type: "PLATFORM", id: PLATFORM_ID }];

export const orgChain = (organizationId: string): ScopeChain => [{ type: "ORGANIZATION", id: organizationId }];

export const regionChain = (regionCode: string): ScopeChain => [{ type: "REGION", id: regionCode }, ...platformChain()];

export async function countryChain(client: Tx | Db, countryCode: string): Promise<ScopeChain> {
  const country = await client.country.findUnique({ where: { code: countryCode }, select: { regionCode: true } });
  if (!country) throw notFound(`Country ${countryCode}`);
  return [{ type: "COUNTRY", id: countryCode }, ...regionChain(country.regionCode)];
}

export async function marketChain(client: Tx | Db, marketType: MarketType, marketCode: string): Promise<ScopeChain> {
  switch (marketType) {
    case "GLOBAL":
      return platformChain();
    case "REGION": {
      const region = await client.region.findUnique({ where: { code: marketCode }, select: { code: true } });
      if (!region) throw notFound(`Region ${marketCode}`);
      return regionChain(marketCode);
    }
    case "COUNTRY":
      return countryChain(client, marketCode);
  }
}

/** Resolves a company inside an organization; a company of another organization is "not found". */
export async function companyChain(client: Tx | Db, organizationId: string, companyId: string): Promise<ScopeChain> {
  const company = await client.company.findFirst({
    where: { id: companyId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!company) throw notFound("Company");
  return [{ type: "COMPANY", id: companyId }, ...orgChain(organizationId)];
}

export async function workspaceChain(client: Tx | Db, organizationId: string, workspaceId: string): Promise<ScopeChain> {
  const ws = await client.workspace.findFirst({
    where: { id: workspaceId, organizationId },
    select: { id: true, companyId: true },
  });
  if (!ws) throw notFound("Workspace");
  return [{ type: "WORKSPACE", id: ws.id }, { type: "COMPANY", id: ws.companyId }, ...orgChain(organizationId)];
}

export async function projectChain(client: Tx | Db, organizationId: string, projectId: string): Promise<ScopeChain> {
  const p = await client.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, workspaceId: true, companyId: true },
  });
  if (!p) throw notFound("Project");
  return [
    { type: "PROJECT", id: p.id },
    { type: "WORKSPACE", id: p.workspaceId },
    { type: "COMPANY", id: p.companyId },
    ...orgChain(organizationId),
  ];
}

/** Build the chain for an arbitrary scope reference (used when granting roles). */
export async function chainFor(client: Tx | Db, scope: ScopeRef, organizationId: string | null): Promise<ScopeChain> {
  switch (scope.type) {
    case "PLATFORM":
      return platformChain();
    case "REGION":
      return marketChain(client, "REGION", scope.id);
    case "COUNTRY":
      return countryChain(client, scope.id);
    case "ORGANIZATION":
      if (!organizationId || scope.id !== organizationId) throw notFound("Organization");
      return orgChain(organizationId);
    case "COMPANY":
      return companyChain(client, requireOrg(organizationId), scope.id);
    case "WORKSPACE":
      return workspaceChain(client, requireOrg(organizationId), scope.id);
    case "PROJECT":
      return projectChain(client, requireOrg(organizationId), scope.id);
  }
}

function requireOrg(organizationId: string | null): string {
  if (!organizationId) throw notFound("Organization");
  return organizationId;
}

export const isPlatformScope = (t: ScopeType) => t === "PLATFORM" || t === "REGION" || t === "COUNTRY";

export const chainOrganization = (chain: ScopeChain): string | null =>
  chain.find((s) => s.type === "ORGANIZATION")?.id ?? null;
