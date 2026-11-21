import "server-only";
import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SectionTabs } from "@/components/comms/bits";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { safeTimeZone } from "@/server/modules/comms/time";
import { shapeSite } from "@/server/modules/sites/service";
import { sitePath } from "@/server/modules/sites/schemas";

export const SITE_TABS = ["overview", "pages", "submissions", "settings", "domain"] as const;
export type SiteTab = (typeof SITE_TABS)[number];

/**
 * Shared loader for /website pages: locale, translator, viewer, company, permissions (marketing.read / marketing.manage),
 * the company's site (or null) and the editorial header with tabs. When there is no company or the viewer cannot read
 * the area, `gate` is the page.
 */
export async function sitesPage(active: SiteTab | null, opts: { header?: boolean } = {}) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const wrapWith = (header: ReactNode) =>
    function SitesFrame(children: ReactNode) {
      return (
        <div className="mx-auto grid w-full max-w-[1400px] gap-5">
          {header}
          {children}
        </div>
      );
    };
  const plainHeader = <PageHeader variant="editorial" world="marketing" eyebrow={t("sites.eyebrow")} title={t("sites.title")} description={t("sites.subtitle")} />;
  if (!company) return { gate: wrapWith(plainHeader)(<Card><p className="p-4 text-muted-foreground">{t("company.empty")}</p></Card>) } as const;
  const chain = await companyChain(db(), org.id, company.id);
  const [read, manage, runAi] = await Promise.all([can(viewer.ctx, "marketing.read", chain), can(viewer.ctx, "marketing.manage", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!read) return { gate: wrapWith(plainHeader)(<Notice tone="warning">{t("errors.forbidden")}</Notice>) } as const;
  const row = await db().site.findFirst({ where: { organizationId: org.id, companyId: company.id } });
  const site = row ? shapeSite(row) : null;
  const newSubmissions = site ? await db().siteFormSubmission.count({ where: { siteId: site.id, status: "NEW" } }) : 0;
  const tabs = SITE_TABS.map((k) => ({ key: k, href: `/${locale}/website${k === "overview" ? "" : `/${k}`}`, label: t(`sites.tabs.${k}`), badge: k === "submissions" ? newSubmissions : undefined }));
  const header =
    opts.header === false ? null : (
      <PageHeader
        variant="editorial"
        world="marketing"
        eyebrow={t("sites.eyebrow")}
        title={site ? site.name : t("sites.title")}
        description={site ? t("sites.subtitleSite") : t("sites.subtitle")}
        meta={
          site ? (
            <>
              <Badge tone={site.online ? "success" : "neutral"} pulse={site.online}>
                {t(site.online ? "sites.status.online" : "sites.status.offline")}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{sitePath(site.slug)}</span>
            </>
          ) : undefined
        }
        actions={
          site?.online ? (
            <Link href={sitePath(site.slug)} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "secondary" })}>
              <ExternalLink aria-hidden />
              {t("sites.viewSite")}
            </Link>
          ) : undefined
        }
      >
        {active && site ? <SectionTabs label={t("sites.title")} tabs={tabs} active={active} /> : null}
      </PageHeader>
    );
  return {
    gate: null,
    locale,
    t,
    viewer,
    org,
    company,
    site,
    newSubmissions,
    tz: safeTimeZone(company.timezone),
    base: `/api/v1/organizations/${org.id}/companies/${company.id}`,
    perms: { read, manage, runAi },
    wrap: wrapWith(header),
  } as const;
}
