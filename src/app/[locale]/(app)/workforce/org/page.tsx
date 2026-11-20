import type { Metadata } from "next";
import Link from "next/link";
import { Crown } from "lucide-react";
import { AiAvatar } from "@/components/workforce/avatar";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import type { Translate } from "@/i18n/translate";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { orgChart, type OrgNode } from "@/server/modules/workforce/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.org.title") };
}

const LEVEL_TONE = { EXECUTIVE: "brand", MANAGER: "accent", SPECIALIST: "neutral" } as const;

function Node({ n, t, locale }: { n: OrgNode; t: Translate; locale: string }) {
  return (
    <li className="relative grid gap-2 ps-6 before:absolute before:start-2 before:top-0 before:h-5 before:w-3 before:rounded-es-md before:border-b before:border-s before:border-border before:content-[''] after:absolute after:start-2 after:top-5 after:bottom-0 after:border-s after:border-border after:content-[''] last:after:hidden">
      <Link href={`/${locale}/workforce/${n.id}`} className="flex max-w-md items-center gap-2 rounded-md border bg-surface p-2 text-sm hover:bg-muted/50">
        <AiAvatar id={n.id} initials={n.initials} size="sm" paused={n.status === "PAUSED"} />
        <span className="grid min-w-0 flex-1">
          <span className="truncate font-medium">{n.name}</span>
          <span className="truncate text-xs text-muted-foreground">{n.jobTitle ?? t(`profiles.${n.profileKey}.name`)}</span>
        </span>
        <Badge tone={LEVEL_TONE[n.level]}>{t(`workforce.levels.${n.level}.name`)}</Badge>
        {n.status === "PAUSED" ? <Badge>{t("workforce.status.PAUSED")}</Badge> : null}
      </Link>
      {n.reports.length ? (
        <ul className="grid gap-2">
          {n.reports.map((r) => (
            <Node key={r.id} n={r} t={t} locale={locale} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Org chart: founder → AI executives → department managers → specialists. */
export default async function OrgChartPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <>
      <PageHeader title={t("workforce.org.title")} subtitle={t("workforce.org.subtitle")} />
      <WorkforceTabs locale={locale} active="org" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;
  const chart = await orgChart(viewer.ctx, org.id, company.id);
  const founderName = chart.founders.length ? chart.founders.map((f) => f.name).join(", ") : t("workforce.org.founder");

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {chart.count === 0 ? (
        <Card>
          <CardBody className="grid justify-items-start gap-3">
            <p className="text-muted-foreground">{t("workforce.empty")}</p>
            {canManage ? (
              <Button asChild size="sm">
                <Link href={`/${locale}/workforce/hire`}>{t("workforce.hire.title")}</Link>
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <div className="flex max-w-md items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-sm">
              <span className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground">
                <Crown aria-hidden className="size-4" />
              </span>
              <span className="grid">
                <span className="font-medium">{founderName}</span>
                <span className="text-xs text-muted-foreground">{t("workforce.org.founderRole")}</span>
              </span>
            </div>
            <ul className="mt-2 grid gap-2" aria-label={t("workforce.org.title")}>
              {chart.roots.map((n) => (
                <Node key={n.id} n={n} t={t} locale={locale} />
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">{t("workforce.org.hint")}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
