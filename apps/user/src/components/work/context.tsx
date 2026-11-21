import "server-only";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

/**
 * Shared loader for the work pages (projects, product, operations): viewer, company, permissions and API base.
 * `gate` is the page to render instead when there is no company or the viewer can't read the area.
 */
export async function workContext(area: "projects" | "operations", title: string, subtitle?: string) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = <PageHeader title={title} subtitle={subtitle} />;
  if (!company) return { gate: <Shell header={header}><Card><p className="p-4 text-muted-foreground">{t("company.empty")}</p></Card></Shell> } as const;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canRunAgents] = await Promise.all([can(viewer.ctx, `${area}.read`, chain), can(viewer.ctx, `${area}.manage`, chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) return { gate: <Shell header={header}><Notice tone="warning">{t("errors.forbidden")}</Notice></Shell> } as const;
  return {
    gate: null,
    locale,
    t,
    viewer,
    org,
    company,
    canManage,
    canRunAgents,
    header,
    base: `/api/v1/organizations/${org.id}/companies/${company.id}/work`,
    tz: company.timezone ?? "UTC",
  } as const;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="grid min-w-0 gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Shell({ header, children, wide = true }: { header?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto grid ${wide ? "max-w-[1400px]" : "max-w-[1000px]"} min-w-0 gap-4`}>
      {header}
      {children}
    </div>
  );
}
