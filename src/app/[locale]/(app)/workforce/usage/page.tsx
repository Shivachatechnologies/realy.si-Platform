import type { Metadata } from "next";
import Link from "next/link";
import { AiAvatar } from "@/components/workforce/avatar";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { env } from "@/server/core/env";
import { aiUsageToday } from "@/server/modules/agents/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { microsToCents, priceFor } from "@/server/modules/workforce/pricing";
import { listEmployees } from "@/server/modules/workforce/service";
import { tokenUsage } from "@/server/modules/workforce/usage";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.usage.title") };
}

export default async function UsagePage({ searchParams }: PageProps<"/[locale]/workforce/usage">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <>
      <PageHeader title={t("workforce.usage.title")} subtitle={t("workforce.usage.subtitle")} />
      <WorkforceTabs locale={locale} active="usage" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "agents.read", chain))) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
  const { month } = await searchParams;
  const selected = months.find((m) => m.toISOString().slice(0, 7) === month) ?? months[0]!;
  const end = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 1));
  const scope = { organizationId: org.id, companyId: company.id };
  const [employees, usage, today, archived] = await Promise.all([
    listEmployees(viewer.ctx, org.id, company.id),
    tokenUsage(scope, selected, end),
    aiUsageToday(org.id, company.id),
    db().aiEmployee.findMany({ where: { ...scope, archivedAt: { not: null } }, select: { id: true, name: true } }),
  ]);
  const usd = (micros: number) => formatMoney({ amountMinor: microsToCents(micros), currency: "USD" }, locale);
  const unassigned = usage.byEmployee.get(null);
  const archivedUse = archived.reduce((s, a) => s + (usage.byEmployee.get(a.id)?.costMicros ?? 0), 0);
  const isCurrent = selected.getTime() === months[0]!.getTime();
  const model = env().AGENT_MODEL;
  const price = priceFor(model);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("workforce.usage.month")}
          <Select name="month" defaultValue={selected.toISOString().slice(0, 7)} className="h-8 w-48">
            {months.map((m) => (
              <option key={m.toISOString()} value={m.toISOString().slice(0, 7)}>
                {formatDate(m, locale, "UTC", { year: "numeric", month: "long" })}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("workforce.filters.apply")}
        </Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardBody className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("workforce.usage.tokens")}</span>
            <span className="tabular text-xl font-semibold">{formatNumber(usage.tokens, locale)}</span>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("workforce.usage.cost")}</span>
            <span className="tabular text-xl font-semibold">{usd(usage.costMicros)}</span>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("workforce.usage.today")}</span>
            <span className="tabular text-xl font-semibold">{formatNumber(today.used, locale)}</span>
            <span className="text-[11px] text-muted-foreground">
              {today.limit ? t("workforce.usage.dailyLimit", { limit: formatNumber(today.limit, locale) }) : t("workforce.usage.noDailyLimit")}
            </span>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title={t("workforce.usage.byEmployee")} />
        <Table>
          <THead>
            <Tr>
              <Th>{t("workforce.usage.employee")}</Th>
              <Th>{t("workforce.usage.tokens")}</Th>
              <Th>{t("workforce.usage.cost")}</Th>
              <Th>{t("workforce.usage.budget")}</Th>
            </Tr>
          </THead>
          <TBody>
            {employees.map((e) => {
              const u = usage.byEmployee.get(e.id) ?? { tokens: 0, costMicros: 0 };
              const pct = isCurrent && e.monthlyTokenBudget ? Math.round((u.tokens / e.monthlyTokenBudget) * 100) : null;
              return (
                <Tr key={e.id}>
                  <Td>
                    <Link href={`/${locale}/workforce/${e.id}`} className="flex items-center gap-2 hover:underline">
                      <AiAvatar id={e.id} initials={e.initials} size="sm" paused={e.status === "PAUSED"} />
                      {e.name}
                    </Link>
                  </Td>
                  <Td className="tabular">{formatNumber(u.tokens, locale)}</Td>
                  <Td className="tabular">{usd(u.costMicros)}</Td>
                  <Td className={pct !== null && pct >= 100 ? "tabular text-danger" : "tabular"}>
                    {e.monthlyTokenBudget ? `${formatNumber(e.monthlyTokenBudget, locale)}${pct !== null ? ` · ${pct}%` : ""}` : t("workforce.usage.unlimited")}
                  </Td>
                </Tr>
              );
            })}
            <Tr>
              <Td className="text-muted-foreground">{t("workforce.usage.unassigned")}</Td>
              <Td className="tabular">{formatNumber(unassigned?.tokens ?? 0, locale)}</Td>
              <Td className="tabular">{usd(unassigned?.costMicros ?? 0)}</Td>
              <Td />
            </Tr>
            {archivedUse ? (
              <Tr>
                <Td className="text-muted-foreground">{t("workforce.usage.removed")}</Td>
                <Td />
                <Td className="tabular">{usd(archivedUse)}</Td>
                <Td />
              </Tr>
            ) : null}
          </TBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">{t("workforce.usage.priceNote", { model, input: price.input, output: price.output })}</p>
    </div>
  );
}
