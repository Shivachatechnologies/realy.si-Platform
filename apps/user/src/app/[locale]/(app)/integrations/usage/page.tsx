import type { Metadata } from "next";
import { integrationsPage } from "@/components/integrations/frame";
import { UsageSummaryTable } from "@/components/integrations/usage-table";
import { formatCostMicros } from "@/components/integrations/usage-format";
import { Stat } from "@/components/automation/page-frame";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { formatNumber } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { usageSummary } from "@/server/modules/integrations/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("integrations.tabs.usage") };
}

const RANGES = [7, 30, 90, 365] as const;

/** Usage & estimated cost of every provider used by the platform's provider services at this company. */
export default async function UsagePage({ searchParams }: PageProps<"/[locale]/integrations/usage">) {
  const sp = await searchParams;
  const p = await integrationsPage("usage");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company } = p.ctx;
  const days = RANGES.find((d) => String(d) === sp.days) ?? 30;
  const summary = await usageSummary(viewer.ctx, org.id, company.id, { days });
  return p.render(
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("integrations.usage.calls")} value={formatNumber(summary.totals.calls, locale)} hint={t("integrations.usage.lastDays", { count: days })} />
        <Stat label={t("integrations.usage.failed")} value={formatNumber(summary.totals.failed, locale)} />
        <Stat label={t("integrations.usage.estimatedCost")} value={formatCostMicros(summary.totals.costMicros, locale)} hint={t("integrations.usage.estimateNote")} />
      </div>
      <Card>
        <CardHeader title={t("integrations.usage.title")} description={t("integrations.usage.help")} />
        <form className="flex flex-wrap gap-2 border-b p-3" action={`/${locale}/integrations/usage`}>
          <Select name="days" defaultValue={String(days)} className="w-auto" aria-label={t("integrations.usage.range")}>
            {RANGES.map((d) => (
              <option key={d} value={d}>
                {t("integrations.usage.lastDays", { count: d })}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("integrations.applyFilters")}
          </Button>
        </form>
        {summary.providers.length ? <UsageSummaryTable summary={summary} t={t} locale={locale} showProvider /> : <p className="p-4 text-muted-foreground">{t("integrations.usage.empty")}</p>}
      </Card>
    </>,
  );
}
