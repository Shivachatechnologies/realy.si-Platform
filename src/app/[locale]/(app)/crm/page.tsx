import type { Metadata } from "next";
import Link from "next/link";
import { CompleteFollowUpButton, NewLeadForm } from "@/components/crm/lead-forms";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { LeadTable, type LeadRow } from "@/components/crm/lead-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { db } from "@/server/core/db";
import { effectiveProbability, isOpenStage, weightedMinor } from "@/server/modules/crm/pipeline";
import { dueFollowUps, LEAD_STAGES, LEAD_TEMPERATURES, listLeads, listOwners, parseLeadFilters } from "@/server/modules/crm/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.crm.title") };
}

const PRIORITY_TONE = { HIGH: "danger", MEDIUM: "warning", LOW: "neutral" } as const;

export default async function CrmPage({ searchParams }: PageProps<"/[locale]/crm">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{t("modules.crm.title")}</h1>
      <p className="text-muted-foreground">{t("crm.subtitle")}</p>
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
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "sales.read", chain), can(viewer.ctx, "sales.manage", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const filters = parseLeadFilters(await searchParams);
  const filtered = !!(filters.q || filters.owner || filters.stage || filters.temperature);
  const [leads, due, owners] = await Promise.all([listLeads(viewer.ctx, org.id, company.id, filters), dueFollowUps(viewer.ctx, org.id, company.id), listOwners(viewer.ctx, org.id, company.id)]);
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = company.timezone ?? "UTC";
  const money = (m: bigint, currency: string) => formatMoney({ amountMinor: m, currency }, locale);
  const open = leads.filter((l) => isOpenStage(l.stage));
  const pipelineMinor = open.reduce((sum, l) => sum + (l.valueMinor ?? 0n), 0n);
  const weightedTotal = open.reduce((sum, l) => sum + weightedMinor(l), 0n);
  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    name: l.name,
    account: l.account,
    ownerName: l.owner?.name ?? null,
    stage: l.stage,
    score: l.score,
    scoreLabel: l.scoreLabel,
    value: l.valueMinor != null ? money(l.valueMinor, l.currency) : null,
    weighted: l.valueMinor != null ? money(weightedMinor(l), l.currency) : null,
    probability: effectiveProbability(l),
    closeDate: l.expectedCloseDate ? formatDate(l.expectedCloseDate, locale, "UTC") : null,
    nextFollowUp: l.followUps[0] ? formatDate(l.followUps[0].dueAt, locale, tz) : null,
  }));
  const now = new Date();

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <CrmTabs locale={locale} active="leads" labels={{ leads: t("crm.leads"), dashboard: t("crm.dashboard") }} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("crm.openLeads")}</p>
          <p className="text-xl font-semibold">{open.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("crm.pipelineValue")}</p>
          <p className="text-xl font-semibold">{money(pipelineMinor, company.baseCurrency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("crm.weightedPipeline")}</p>
          <p className="text-xl font-semibold">{money(weightedTotal, company.baseCurrency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t("crm.dueToday")}</p>
          <p className="text-xl font-semibold">{due.length}</p>
        </Card>
      </div>
      {filtered ? <p className="text-xs text-muted-foreground">{t("crm.statsFiltered")}</p> : null}

      {due.length ? (
        <Card>
          <CardHeader title={t("crm.followUpsDue")} />
          <ul className="grid divide-y">
            {due.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Badge tone={PRIORITY_TONE[f.priority]}>{t(`crm.priorities.${f.priority}`)}</Badge>
                <Link href={`/${locale}/crm/${f.lead.id}`} className="font-medium hover:underline">
                  {f.lead.name}
                </Link>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.note}</span>
                {f.lead.owner ? <span className="text-xs text-muted-foreground">{f.lead.owner.name}</span> : null}
                <Badge tone={f.dueAt < now ? "warning" : "neutral"}>{f.dueAt < now ? t("crm.overdueOn", { date: formatDate(f.dueAt, locale, tz) }) : formatDate(f.dueAt, locale, tz)}</Badge>
                {canManage ? <CompleteFollowUpButton base={base} followUpId={f.id} /> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("crm.leads")} description={t("crm.count", { count: leads.length })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_11rem_10rem_9rem_auto]" action={`/${locale}/crm`}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("crm.search")} placeholder={t("crm.searchPlaceholder")} />
          <Select name="owner" defaultValue={filters.owner ?? ""} aria-label={t("crm.owner")}>
            <option value="">{t("crm.allOwners")}</option>
            <option value="me">{t("crm.myLeads")}</option>
            <option value="unassigned">{t("crm.unassigned")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select name="stage" defaultValue={filters.stage ?? ""} aria-label={t("crm.stage")}>
            <option value="">{t("crm.allStages")}</option>
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`crm.stages.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="temperature" defaultValue={filters.temperature ?? ""} aria-label={t("crm.temperature")}>
            <option value="">{t("crm.allTemperatures")}</option>
            {LEAD_TEMPERATURES.map((s) => (
              <option key={s} value={s}>
                {t(`crm.scoreLabels.${s}`)}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              {t("crm.applyFilters")}
            </Button>
            {filtered ? (
              <Link href={`/${locale}/crm`} className="self-center text-xs text-muted-foreground hover:underline">
                {t("crm.clearFilters")}
              </Link>
            ) : null}
          </div>
        </form>
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("crm.addLead")}</summary>
            <NewLeadForm base={base} locale={locale} owners={owners} viewerId={viewer.user.id} />
          </details>
        ) : null}
        {leads.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("crm.empty")}</p>
        ) : (
          <LeadTable base={base} locale={locale} rows={rows} owners={owners} canManage={canManage} />
        )}
      </Card>
    </div>
  );
}
