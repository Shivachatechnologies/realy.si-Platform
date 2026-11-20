import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { integrationsPage } from "@/components/integrations/frame";
import { UsageSummaryTable } from "@/components/integrations/usage-table";
import { formatCostMicros } from "@/components/integrations/usage-format";
import { Stat } from "@/components/automation/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { providerInfo } from "@/server/modules/integrations/catalog";
import { listUsage, usageSummary, USAGE_STATUSES } from "@/server/modules/integrations/service";

export async function generateMetadata({ params }: PageProps<"/[locale]/integrations/[provider]/usage">): Promise<Metadata> {
  const { provider } = await params;
  const t = await getT();
  return { title: `${providerInfo(provider)?.name ?? t("modules.integrations.title")} · ${t("integrations.usage.title")}` };
}

/** Per-connection usage: 30-day totals by operation and every metered call (newest first). */
export default async function ProviderUsagePage({ params, searchParams }: PageProps<"/[locale]/integrations/[provider]/usage">) {
  const { provider } = await params;
  const info = providerInfo(provider);
  if (!info) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
  const loc = await getLocale();
  const p = await integrationsPage("usage", {
    title: `${info.name} · ${(await getT(loc))("integrations.usage.title")}`,
    actions: (
      <Link href={`/${loc}/integrations/${info.key}`} className="text-sm text-muted-foreground hover:underline">
        ← {info.name}
      </Link>
    ),
  });
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, tz } = p.ctx;
  const filters = { operation: one(sp.operation), status: one(sp.status), cursor: one(sp.cursor) };
  const [page, summary] = await Promise.all([listUsage(viewer.ctx, org.id, company.id, provider, filters), usageSummary(viewer.ctx, org.id, company.id, { provider })]);
  const operations = summary.providers[0]?.operations.map((o) => o.operation) ?? [];
  const qs = (cursor: string) => `?${new URLSearchParams({ ...(filters.operation ? { operation: filters.operation } : {}), ...(filters.status ? { status: filters.status } : {}), cursor })}`;
  return p.render(
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("integrations.usage.calls")} value={formatNumber(summary.totals.calls, locale)} hint={t("integrations.last30Days")} />
        <Stat label={t("integrations.usage.failed")} value={formatNumber(summary.totals.failed, locale)} />
        <Stat label={t("integrations.usage.estimatedCost")} value={formatCostMicros(summary.totals.costMicros, locale)} hint={t("integrations.usage.estimateNote")} />
      </div>
      {summary.providers.length ? (
        <Card>
          <CardHeader title={t("integrations.usage.byOperation")} description={t("integrations.last30Days")} />
          <UsageSummaryTable summary={summary} t={t} locale={locale} />
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("integrations.usage.calls")} description={t("integrations.usage.help")} />
        <form className="flex flex-wrap gap-2 border-b p-3" action={`/${locale}/integrations/${provider}/usage`}>
          <Select name="operation" defaultValue={filters.operation ?? ""} className="w-auto" aria-label={t("integrations.usage.operation")}>
            <option value="">{t("integrations.usage.allOperations")}</option>
            {operations.map((o) => (
              <option key={o} value={o}>
                {t(`integrations.usage.operations.${o.replace(".", "_")}`)}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={filters.status ?? ""} className="w-auto" aria-label={t("common.status")}>
            <option value="">{t("common.all")}</option>
            {USAGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`integrations.usage.statuses.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("integrations.applyFilters")}
          </Button>
        </form>
        {page.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("integrations.usage.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("integrations.logs.time")}</Th>
                <Th>{t("integrations.usage.operation")}</Th>
                <Th>{t("common.status")}</Th>
                <Th className="text-end">{t("integrations.usage.units")}</Th>
                <Th className="text-end">{t("integrations.usage.estimatedCost")}</Th>
                <Th>{t("integrations.usage.details")}</Th>
              </Tr>
            </THead>
            <TBody>
              {page.data.map((u) => {
                const meta = (u.meta && typeof u.meta === "object" && !Array.isArray(u.meta) ? u.meta : {}) as Record<string, unknown>;
                return (
                  <Tr key={u.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(u.createdAt, locale, tz)}</Td>
                    <Td>{t(`integrations.usage.operations.${u.operation.replace(".", "_")}`)}</Td>
                    <Td>
                      <Badge tone={u.status === "SUCCEEDED" ? "success" : "danger"}>{t(`integrations.usage.statuses.${u.status}`)}</Badge>
                    </Td>
                    <Td className="text-end tabular-nums text-xs">
                      {formatNumber(u.units, locale)} {t(`integrations.usage.unitNames.${u.unit}`)}
                    </Td>
                    <Td className="text-end tabular-nums text-xs">{u.estimatedCostMicros === null ? "—" : formatCostMicros(u.estimatedCostMicros, locale)}</Td>
                    <Td className="max-w-80 text-xs">
                      {typeof meta.model === "string" ? <p className="font-mono text-muted-foreground">{meta.model}</p> : null}
                      {u.error ? <p className="text-danger">{u.error}</p> : null}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        {page.nextCursor || filters.cursor ? (
          <div className="flex justify-between gap-2 border-t p-3 text-sm">
            {filters.cursor ? <Link href={`/${locale}/integrations/${provider}/usage`} className="hover:underline">{t("integrations.firstPage")}</Link> : <span />}
            {page.nextCursor ? <Link href={`/${locale}/integrations/${provider}/usage${qs(page.nextCursor)}`} className="hover:underline">{t("common.next")} →</Link> : null}
          </div>
        ) : null}
      </Card>
    </>,
  );
}
