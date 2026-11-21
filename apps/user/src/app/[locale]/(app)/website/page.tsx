import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle, FileText, Globe, Inbox, Megaphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { AiTasksCard, type SubjectTask } from "@/components/comms/bits";
import { sitesPage } from "@/components/sites/context";
import { GenerateWebsite, OnlineToggle } from "@/components/sites/site-actions";
import { SetupWizard } from "@/components/sites/setup-wizard";
import { getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { assetFileUrl } from "@/server/modules/assets/presets";
import { siteTasks } from "@/server/modules/sites/ai";
import { getSiteOverview, setupDefaults } from "@/server/modules/sites/service";
import { hasFeature } from "@/server/modules/entitlements/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("sites.title") };
}

/** /website — the company website: guided setup when there is none, else the overview (status, pages, inbox, AI). */
export default async function WebsitePage() {
  const p = await sitesPage("overview");
  if (p.gate) return p.gate;
  const { org, company, viewer, locale, t, perms, base, site, tz, wrap } = p;
  const aiReady = aiConfigured();
  if (!site) {
    const [defaults, logos, entitled] = await Promise.all([
      setupDefaults(viewer.ctx, org.id, company.id),
      db().visualAsset.findMany({ where: { organizationId: org.id, companyId: company.id, kind: { in: ["IMAGE", "SVG"] } }, orderBy: [{ pinned: "desc" }, { scopeType: "asc" }, { createdAt: "desc" }], take: 12, select: { id: true, title: true } }),
      hasFeature(org.id, "feature.website_builder"),
    ]);
    return wrap(
      <>
        {!perms.manage ? <Notice tone="info">{t("sites.setup.readOnly")}</Notice> : null}
        {!entitled ? <Notice tone="warning">{t("sites.planLocked")}</Notice> : null}
        {perms.manage ? (
          <SetupWizard base={base} defaults={JSON.parse(JSON.stringify(defaults))} logos={logos.map((l) => ({ id: l.id, title: l.title, url: assetFileUrl(org.id, company.id, l.id) }))} aiReady={aiReady} canRunAi={perms.runAi} />
        ) : (
          <Card>
            <CardBody className="text-sm text-muted-foreground">{t("sites.empty")}</CardBody>
          </Card>
        )}
      </>,
    );
  }
  const [overview, tasks] = await Promise.all([getSiteOverview(viewer.ctx, org.id, company.id), siteTasks(viewer.ctx, org.id, company.id, site.id)]);
  const pages = overview.pages;
  const published = pages.filter((x) => x.status === "PUBLISHED").length;
  const landing = pages.filter((x) => x.kind === "LANDING").length;
  const home = pages.find((x) => x.slug === "" && x.kind === "PAGE");
  const checklist = [
    { key: "theme", done: true, href: `/${locale}/website/settings` },
    { key: "home", done: home?.status === "PUBLISHED", href: home ? `/${locale}/website/pages/${home.id}` : `/${locale}/website/pages` },
    { key: "online", done: site.online, href: null },
    { key: "form", done: overview.totalSubmissions > 0, href: `/${locale}/website/submissions` },
    { key: "domain", done: site.domainStatus === "VERIFIED", href: `/${locale}/website/domain` },
  ];
  const aiDisabled = !aiReady ? t("sites.setup.aiMissing") : !perms.runAi || !perms.manage ? t("sites.setup.aiNoPermission") : null;
  return wrap(
    <>
      <StatGrid>
        <StatTile index={0} label={t("sites.overview.published")} value={published} format="integer" hint={t("sites.overview.ofPages", { count: pages.length })} icon={<FileText className="size-4" />} />
        <StatTile index={1} label={t("sites.overview.landing")} value={landing} format="integer" icon={<Megaphone className="size-4" />} />
        <StatTile index={2} label={t("sites.overview.newLeads")} value={overview.newSubmissions} format="integer" hint={t("sites.overview.totalLeads", { count: overview.totalSubmissions })} icon={<Inbox className="size-4" />} live={overview.newSubmissions > 0} />
        <StatTile index={3} label={t("sites.overview.domain")} value={t(`sites.domain.status.${site.domainStatus}`)} hint={site.customDomain ?? t("sites.overview.noDomain")} icon={<Globe className="size-4" />} />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("sites.overview.pagesTitle")} actions={<Link href={`/${locale}/website/pages`} className={buttonVariants({ size: "sm", variant: "secondary" })}>{t("sites.overview.allPages")}</Link>} />
          <CardBody className="p-0">
            <ul className="divide-y">
              {pages.slice(0, 8).map((pg) => (
                <li key={pg.id}>
                  <Link href={`/${locale}/website/pages/${pg.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-muted/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{pg.title}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">/{pg.slug}</span>
                    </span>
                    {pg.kind === "LANDING" ? <Badge tone="accent">{t("sites.kinds.LANDING")}</Badge> : null}
                    {pg.aiDrafted ? <Badge tone="brand">{t("sites.pages.aiDraft")}</Badge> : null}
                    <Badge tone={pg.status === "PUBLISHED" ? "success" : pg.status === "SCHEDULED" ? "info" : "neutral"}>{t(`sites.pageStatus.${pg.status}`)}</Badge>
                    <span className="hidden text-xs text-muted-foreground sm:inline">{formatRelativeTime(pg.updatedAt, locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {!pages.length ? <p className="p-4 text-sm text-muted-foreground">{t("sites.pages.empty")}</p> : null}
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <Card variant="glass">
            <CardHeader title={t("sites.overview.statusTitle")} description={site.online ? t("sites.overview.onlineHint") : t("sites.overview.offlineHint")} />
            <CardBody>
              <OnlineToggle base={base} online={site.online} canManage={perms.manage} hasPublished={published > 0} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("sites.overview.checklist")} />
            <CardBody>
              <ol className="grid gap-2 text-sm">
                {checklist.map((c) => (
                  <li key={c.key} className="flex items-center gap-2.5">
                    {c.done ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    {c.href ? (
                      <Link href={c.href} className={cn("hover:underline", c.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                        {t(`sites.overview.steps.${c.key}`)}
                      </Link>
                    ) : (
                      <span className={cn(c.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{t(`sites.overview.steps.${c.key}`)}</span>
                    )}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
          <AiTasksCard
            t={t}
            locale={locale}
            tz={tz}
            title={t("sites.ai.cardTitle")}
            description={t("sites.ai.cardHint")}
            tasks={tasks as unknown as SubjectTask[]}
            notConfigured={!aiReady}
            actions={<GenerateWebsite base={base} disabledReason={aiDisabled} compact />}
          />
        </div>
      </div>
    </>,
  );
}
