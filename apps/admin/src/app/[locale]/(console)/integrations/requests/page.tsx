import Link from "next/link";
import { ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, NextPage, guard, sp } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SourceNote } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { integrationRequestLogExplorer } from "@/server/modules/admin/integrations";
import { PROVIDERS } from "@/server/modules/integrations/catalog";
import { requireViewer } from "@/server/session";

/** Cross-organization integration request log (summaries only; kept 30 days). */
export default async function IntegrationRequestsPage({ searchParams }: PageProps<"/[locale]/integrations/requests">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { provider: sp(q.provider), org: sp(q.org), outcome: sp(q.outcome) };
  const r = await guard(integrationRequestLogExplorer(viewer.ctx, { ...params, cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const d = r.value;
  const base = `/${locale}/integrations/requests`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: t("admin.integrations.requestLog") }]} />
      <AdminHeader icon={<ScrollText />} title={t("admin.integrations.requestLog")} description={t("admin.integrations.requestLogSubtitle")} meta={<SourceNote source="integration_request_logs" at={new Date()} label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} />} />
      <Card>
        <FilterBar
          action={base}
          values={params}
          submitLabel={t("admin.settings.kit.apply")}
          filters={[
            { name: "provider", label: t("admin.integrations.provider"), options: PROVIDERS.map((p) => ({ value: p.key, label: p.name })) },
            { name: "outcome", label: t("admin.integrations.outcome"), options: [{ value: "errors", label: t("admin.integrations.outcomes.errors") }, { value: "ok", label: t("admin.integrations.outcomes.ok") }] },
          ]}
          extra={params.org ? <input type="hidden" name="org" value={params.org} /> : undefined}
        />
        {d.data.length === 0 ? (
          <EmptyState icon={<ScrollText />} title={t("admin.settings.kit.noEvents")} body={t("admin.common.tryOtherFilters")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.integrations.request")}</Th>
                <Th>{t("admin.integrations.status")}</Th>
                <Th>{t("admin.apiLogs.duration")}</Th>
                <Th>{t("admin.settings.kit.organization")}</Th>
                <Th>{t("admin.settings.kit.when")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.data.map((x) => (
                <Tr key={x.id}>
                  <Td className="max-w-md text-xs">
                    <span className="font-mono">{x.method} {x.url}</span>
                    <div className="text-[11px] text-muted-foreground">{x.provider}{x.attempts > 1 ? ` · ×${x.attempts}` : ""}{x.error ? ` · ${x.error.slice(0, 100)}` : ""}</div>
                  </Td>
                  <Td>{x.status !== null ? <StatusBadge domain="httpClass" value={`${Math.floor(x.status / 100)}xx`}>{String(x.status)}</StatusBadge> : <StatusBadge domain="httpClass" value="5xx">—</StatusBadge>}</Td>
                  <Td className="text-xs tabular-nums">{x.durationMs} ms</Td>
                  <Td className="text-xs"><Link href={`/${locale}/organizations/${x.organizationId}/integrations`} className="hover:underline">{x.organizationName}</Link></Td>
                  <Td className="text-xs text-muted-foreground"><Timestamp value={x.createdAt} mode="relative" /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={d.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
