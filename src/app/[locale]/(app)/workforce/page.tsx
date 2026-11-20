import type { Metadata } from "next";
import Link from "next/link";
import { Pause, Play, UserPlus, Users } from "lucide-react";
import { ActionButton } from "@/components/workforce/action-button";
import { AiAvatar } from "@/components/workforce/avatar";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { DEPARTMENTS, employeeFilters, employeeStats, listEmployees } from "@/server/modules/workforce/service";
import { microsToCents } from "@/server/modules/workforce/pricing";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.workforce.title") };
}

export default async function WorkforcePage({ searchParams }: PageProps<"/[locale]/workforce">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const tabs = <WorkforceTabs locale={locale} active="employees" labels={{ employees: t("workforce.tabs.employees"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />;
  const header = (
    <>
      <PageHeader title={t("modules.workforce.title")} subtitle={t("workforce.subtitle")} />
      {tabs}
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  const sp = await searchParams;
  const raw = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const filters = employeeFilters.parse(raw);
  const employees = await listEmployees(viewer.ctx, org.id, company.id, raw);
  const stats = await employeeStats(org.id, company.id, employees.map((e) => e.id));
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const filtered = !!(filters.q || filters.status || filters.department);
  const groups = DEPARTMENTS.map((d) => ({ d, list: employees.filter((e) => e.department === d) })).filter((g) => g.list.length);
  const usd = (micros: number) => formatMoney({ amountMinor: microsToCents(micros), currency: "USD" }, locale);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <PageHeader
        title={t("modules.workforce.title")}
        subtitle={t("workforce.subtitle")}
        actions={
          canManage ? (
            <span className="flex flex-wrap items-start gap-2">
              <ActionButton path={`${apiBase}/workforce/starter-team`} confirm={t("workforce.starterTeam.confirm")}>
                <Users aria-hidden />
                {t("workforce.starterTeam.action")}
              </ActionButton>
              <Button asChild size="sm">
                <Link href={`/${locale}/workforce/hire`}>
                  <UserPlus aria-hidden />
                  {t("workforce.hire.title")}
                </Link>
              </Button>
            </span>
          ) : null
        }
      />
      {tabs}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("workforce.filters.search")}
          <Input name="q" defaultValue={filters.q ?? ""} className="h-8 w-56" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("workforce.filters.department")}
          <Select name="department" defaultValue={filters.department ?? ""} className="h-8 w-44">
            <option value="">{t("common.all")}</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {t(`workforce.departments.${d}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("workforce.filters.status")}
          <Select name="status" defaultValue={filters.status ?? ""} className="h-8 w-36">
            <option value="">{t("common.all")}</option>
            <option value="ACTIVE">{t("workforce.status.ACTIVE")}</option>
            <option value="PAUSED">{t("workforce.status.PAUSED")}</option>
          </Select>
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("workforce.filters.apply")}
        </Button>
        {filtered ? (
          <Link href={`/${locale}/workforce`} className="text-sm text-muted-foreground hover:underline">
            {t("workforce.filters.clear")}
          </Link>
        ) : null}
      </form>

      {employees.length === 0 ? (
        <Card>
          <CardBody className="grid justify-items-start gap-3">
            <p className="text-muted-foreground">{filtered ? t("common.noResults") : t("workforce.empty")}</p>
            {canManage && !filtered ? (
              <Button asChild size="sm">
                <Link href={`/${locale}/workforce/hire`}>{t("workforce.hire.title")}</Link>
              </Button>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.d} className="grid gap-2" aria-labelledby={`dept-${g.d}`}>
            <h2 id={`dept-${g.d}`} className="text-sm font-semibold text-muted-foreground">
              {t(`workforce.departments.${g.d}`)} <span className="font-normal">({g.list.length})</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.list.map((e) => {
                const s = stats.get(e.id)!;
                const pct = e.monthlyTokenBudget ? Math.min(100, Math.round((s.monthTokens / e.monthlyTokenBudget) * 100)) : null;
                return (
                  <Card key={e.id} className="flex flex-col">
                    <CardHeader
                      title={
                        <Link href={`/${locale}/workforce/${e.id}`} className="flex items-center gap-2 hover:underline">
                          <AiAvatar id={e.id} initials={e.initials} paused={e.status === "PAUSED"} />
                          <span className="truncate">{e.name}</span>
                        </Link>
                      }
                      description={t(`profiles.${e.profileKey}.name`)}
                      actions={<Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>{t(`workforce.status.${e.status}`)}</Badge>}
                    />
                    <CardBody className="grid flex-1 content-start gap-2 text-sm">
                      <dl className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-md bg-surface-2 p-2">
                          <dt className="text-[11px] text-muted-foreground">{t("workforce.stats.completed")}</dt>
                          <dd className="tabular font-semibold">{formatNumber(s.completed, locale)}</dd>
                        </div>
                        <div className="rounded-md bg-surface-2 p-2">
                          <dt className="text-[11px] text-muted-foreground">{t("workforce.stats.failed")}</dt>
                          <dd className="tabular font-semibold">{formatNumber(s.failed, locale)}</dd>
                        </div>
                        <div className="rounded-md bg-surface-2 p-2">
                          <dt className="text-[11px] text-muted-foreground">{t("workforce.stats.active")}</dt>
                          <dd className="tabular font-semibold">{formatNumber(s.active, locale)}</dd>
                        </div>
                      </dl>
                      <p className="text-xs text-muted-foreground">
                        {t("workforce.stats.monthUsage", { tokens: formatNumber(s.monthTokens, locale), cost: usd(s.monthCostMicros) })}
                      </p>
                      {pct !== null ? (
                        <div className="grid gap-1">
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("workforce.stats.budget")}>
                            <div className={pct >= 100 ? "h-full bg-danger" : pct >= 80 ? "h-full bg-warning" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[11px] text-muted-foreground">{t("workforce.stats.budgetUsed", { pct })}</span>
                        </div>
                      ) : null}
                      <p className="text-xs text-muted-foreground">{t(`workforce.autonomy.${e.autonomy}.name`)}</p>
                      {e.skills.length ? (
                        <div className="flex flex-wrap gap-1">
                          {e.skills.map((sk) => (
                            <Badge key={sk}>{sk}</Badge>
                          ))}
                        </div>
                      ) : null}
                    </CardBody>
                    <div className="flex flex-wrap gap-2 border-t p-3">
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/${locale}/workforce/${e.id}#assign`}>{t("workforce.assign")}</Link>
                      </Button>
                      {canManage ? (
                        <ActionButton path={`${apiBase}/workforce/employees/${e.id}/status`} body={{ status: e.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }} variant="ghost">
                          {e.status === "ACTIVE" ? <Pause aria-hidden /> : <Play aria-hidden />}
                          {e.status === "ACTIVE" ? t("workforce.employee.pause") : t("workforce.employee.resume")}
                        </ActionButton>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
