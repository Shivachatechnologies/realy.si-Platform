import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, guard, sp, usd } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { aiCostUsage } from "@/server/modules/admin/ai";
import { requireViewer } from "@/server/session";

const RANGES = [7, 30, 90] as const;

/** AI cost and usage by organization, model and day (estimated with workforce/pricing.ts list prices). */
export default async function AdminAiUsagePage({ searchParams }: PageProps<"/[locale]/admin/ai/usage">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const wanted = sp((await searchParams).days);
  const days = RANGES.find((d) => String(d) === wanted) ?? 30;
  const r = await guard(aiCostUsage(viewer.ctx, { days }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const u = r.value;
  const n = (v: number) => formatNumber(v, locale);
  const maxDay = Math.max(1, ...u.byDay.map((d) => d.costMicros));
  const base = `/${locale}/admin/ai/usage`;
  const table = (rows: { key: string; label: ReactNode; tokens: number; costMicros: number; tasks: number }[]) =>
    rows.length === 0 ? (
      <Empty>{t("admin.ai.noUsage")}</Empty>
    ) : (
      <Table>
        <THead>
          <Tr>
            <Th>{t("admin.ai.columns.name")}</Th>
            <Th>{t("admin.ai.columns.tasks")}</Th>
            <Th>{t("admin.ai.columns.tokens")}</Th>
            <Th>{t("admin.ai.columns.cost")}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.key}>
              <Td className="max-w-64 truncate">{row.label}</Td>
              <Td className="tabular">{n(row.tasks)}</Td>
              <Td className="tabular">{n(row.tokens)}</Td>
              <Td className="tabular">{usd(row.costMicros, locale)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    );
  return (
    <div className="grid gap-4">
      <AdminHeader
        title={t("admin.nav.aiUsage")}
        description={t("admin.ai.usageSubtitle")}
        actions={RANGES.map((d) => (
          <Button key={d} asChild size="sm" variant={d === days ? "secondary" : "ghost"}>
            <Link href={`${base}?days=${d}`}>{t("admin.common.lastDays", { count: d })}</Link>
          </Button>
        ))}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.ai.byOrg")} />
          {table(u.byOrg.map((o) => ({ key: o.id, label: <Link href={`/${locale}/admin/organizations/${o.id}`} className="hover:underline">{o.name}</Link>, ...o })))}
        </Card>
        <Card>
          <CardHeader title={t("admin.ai.byModel")} />
          {table(u.byModel.map((m) => ({ key: m.model, label: <span className="font-mono text-xs">{m.model}</span>, ...m })))}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.ai.byDay")} />
        {u.byDay.length === 0 ? (
          <Empty>{t("admin.ai.noUsage")}</Empty>
        ) : (
          <ul className="divide-y">
            {u.byDay.map((d) => (
              <li key={d.day} className="grid grid-cols-[7rem_minmax(0,1fr)_6rem] items-center gap-3 px-4 py-1.5 text-xs">
                <span className="text-muted-foreground">{formatDate(`${d.day}T00:00:00Z`, locale, "UTC")}</span>
                <span className="h-2 rounded-full bg-muted">
                  <span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (d.costMicros / maxDay) * 100)}%` }} />
                </span>
                <span className="text-end tabular">
                  {usd(d.costMicros, locale)} · {n(d.tokens)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
