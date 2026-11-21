import "server-only";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/comms/bits";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { StudioReel } from "./graphics";

export const STUDIO_TABS = ["overview", "images", "library"] as const;
export type StudioTab = (typeof STUDIO_TABS)[number] | "project" | "asset";

/**
 * Shared loader for the /studio pages: locale, translator, viewer, company, permissions and the editorial header with
 * tabs. When there is no company or the viewer cannot read marketing, `gate` holds the page to render instead.
 */
export async function studioPage(active: StudioTab, opts: { title?: string; description?: string; eyebrow?: string } = {}) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-3">
      <PageHeader
        variant="editorial"
        world="marketing"
        eyebrow={opts.eyebrow ?? t("creative.eyebrow")}
        title={opts.title ?? t("creative.title")}
        description={opts.description ?? t("creative.subtitle")}
        illustration={<StudioReel className="w-full max-w-[18rem]" />}
      />
      <SectionTabs label={t("creative.title")} tabs={STUDIO_TABS.map((k) => ({ key: k, href: `/${locale}/studio${k === "overview" ? "" : `/${k}`}`, label: t(`creative.tabs.${k}`) }))} active={active} />
    </div>
  );
  const wrap = (children: ReactNode) => (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      {header}
      {children}
    </div>
  );
  if (!company) return { gate: wrap(<Card><p className="p-4 text-muted-foreground">{t("company.empty")}</p></Card>) } as const;
  const chain = await companyChain(db(), org.id, company.id);
  const [read, manage, integrations] = await Promise.all([can(viewer.ctx, "marketing.read", chain), can(viewer.ctx, "marketing.manage", chain), can(viewer.ctx, "integrations.manage", chain)]);
  if (!read) return { gate: wrap(<Notice tone="warning">{t("errors.forbidden")}</Notice>) } as const;
  return {
    gate: null,
    locale,
    t,
    viewer,
    org,
    company,
    tz: company.timezone || "UTC",
    base: `/api/v1/organizations/${org.id}/companies/${company.id}`,
    perms: { read, manage, integrations },
    wrap,
  } as const;
}
