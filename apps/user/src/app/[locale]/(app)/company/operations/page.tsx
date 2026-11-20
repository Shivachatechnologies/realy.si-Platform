import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { KrStatusBadge, ProgressBar } from "@/components/objectives/progress";
import { CompanyTabs } from "@/components/objectives/tabs";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { companyOperations } from "@/server/modules/objectives/overview";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("strategy.operations.title") };
}

const KR_STATUSES = ["ACHIEVED", "ON_TRACK", "AT_RISK", "OFF_TRACK", "NO_DATA"] as const;

export default async function CompanyOperationsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-3">
      <PageHeader variant="editorial" world="command" eyebrow={t("dna.worlds.command")} title={t("strategy.operations.title")} description={t("strategy.operations.subtitle")} />
      <CompanyTabs locale={locale} active="operations" />
    </div>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  const ops = await companyOperations(viewer.ctx, org.id, company.id, chain);
  if (!ops) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("strategy.operations.forbidden")}</Notice>
      </div>
    );
  }
  const n = (v: number | null) => (v === null ? "—" : formatNumber(v, locale));
  const money = (minor: bigint) => formatMoney({ amountMinor: minor, currency: ops.currency }, locale);
  const tiles = [
    { key: "departments", value: ops.departments.length, href: ops.can.hr ? "/hr" : null },
    { key: "headcount", value: ops.totals.headcount, href: ops.can.hr ? "/hr" : null },
    { key: "unassigned", value: ops.totals.unassignedHeadcount, href: ops.can.hr ? "/hr" : null },
    { key: "openProjects", value: ops.totals.openProjects, href: ops.can.projects ? "/projects" : null },
  ].filter((x) => x.value !== null);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.key} className="grid gap-1 rounded-lg border bg-surface p-3">
            <span className="text-xs text-muted-foreground">{t(`strategy.operations.tiles.${x.key}`)}</span>
            {x.href ? (
              <Link href={`/${locale}${x.href}`} className="tabular text-xl font-semibold hover:underline">
                {n(x.value)}
              </Link>
            ) : (
              <span className="tabular text-xl font-semibold">{n(x.value)}</span>
            )}
          </div>
        ))}
      </div>
      {!ops.can.hr || !ops.can.projects || !ops.can.finance || !ops.can.objectives ? (
        <p className="text-xs text-muted-foreground">
          {t("strategy.operations.partial", {
            areas: [!ops.can.hr ? t("strategy.operations.areas.hr") : null, !ops.can.projects ? t("strategy.operations.areas.projects") : null, !ops.can.finance ? t("strategy.operations.areas.finance") : null, !ops.can.objectives ? t("strategy.operations.areas.objectives") : null]
              .filter(Boolean)
              .join(", "),
          })}
        </p>
      ) : null}
      <Card>
        <CardHeader title={t("strategy.operations.departments")} description={t("strategy.operations.departmentsHint", { currency: ops.currency })} />
        {ops.departments.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">
            {t("strategy.operations.noDepartments")}{" "}
            {ops.can.hr ? (
              <Link className="text-primary hover:underline" href={`/${locale}/hr`}>
                {t("strategy.operations.setupHr")}
              </Link>
            ) : null}
          </CardBody>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("strategy.operations.columns.department")}</Th>
                {ops.can.hr ? <Th>{t("strategy.operations.columns.headcount")}</Th> : null}
                {ops.can.hr && ops.can.projects ? <Th>{t("strategy.operations.columns.openProjects")}</Th> : null}
                {ops.can.finance ? <Th>{t("strategy.operations.columns.budget")}</Th> : null}
                {ops.can.objectives ? <Th>{t("strategy.operations.columns.objectives")}</Th> : null}
                {ops.can.objectives ? <Th>{t("strategy.operations.columns.keyResults")}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {ops.departments.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-medium">{d.name}</Td>
                  {ops.can.hr ? <Td className="tabular">{n(d.headcount)}</Td> : null}
                  {ops.can.hr && ops.can.projects ? (
                    <Td className="tabular">
                      {n(d.openProjects)}
                      {d.projectsAtRisk ? <span className="ms-1 text-xs text-warning">{t("strategy.operations.atRisk", { count: d.projectsAtRisk })}</span> : null}
                    </Td>
                  ) : null}
                  {ops.can.finance ? (
                    <Td className="min-w-48">
                      {d.budget ? (
                        <div className="grid gap-1">
                          <span className="text-xs">
                            {money(d.budget.actualMinor)} / {money(d.budget.budgetMinor)}
                            {d.budget.usedPct !== null ? <span className="tabular ms-1 text-muted-foreground">({formatNumber(d.budget.usedPct / 100, locale, { style: "percent", maximumFractionDigits: 0 })})</span> : null}
                          </span>
                          <ProgressBar value={d.budget.usedPct === null ? null : Math.min(1, d.budget.usedPct / 100)} status={d.budget.usedPct !== null && d.budget.usedPct > 100 ? "OFF_TRACK" : d.budget.usedPct !== null && d.budget.usedPct > 85 ? "AT_RISK" : "ON_TRACK"} label={d.name} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("strategy.operations.noBudget")}</span>
                      )}
                    </Td>
                  ) : null}
                  {ops.can.objectives ? (
                    <Td className="tabular">
                      {d.objectives ? (
                        <Link className="hover:underline" href={`/${locale}/objectives?department=${d.id}`}>
                          {n(d.objectives)}
                        </Link>
                      ) : (
                        "0"
                      )}
                    </Td>
                  ) : null}
                  {ops.can.objectives ? (
                    <Td>
                      {d.keyResults && Object.values(d.keyResults).some(Boolean) ? (
                        <span className="flex flex-wrap gap-1">
                          {KR_STATUSES.filter((s) => d.keyResults![s]).map((s) => (
                            <KrStatusBadge key={s} status={s} label={`${t(`objectives.kr.status.${s}`)} ${d.keyResults![s]}`} />
                          ))}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
