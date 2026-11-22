import Link from "next/link";
import { Bug } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, guard, NextPage, QuickFilters, sp, StatGrid, StatTile } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SourceLine } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { observabilityStatus } from "@/server/core/observability";
import { ERROR_STATUSES, listErrorGroups } from "@/server/modules/admin/errors";
import { requireViewer } from "@/server/session";

const SINCE = ["1h", "24h", "7d", "30d"] as const;

/** Error groups captured from API 5xx, page render errors and failed worker jobs (fingerprinted, scrubbed). */
export default async function ErrorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const status = ERROR_STATUSES.find((s) => s === sp(q.status));
  const source = (["user", "admin", "worker"] as const).find((s) => s === sp(q.source));
  const since = SINCE.find((s) => s === sp(q.since));
  const text = sp(q.q);
  const cursor = sp(q.cursor);
  const r = await guard(listErrorGroups(viewer.ctx, { status, source, since, q: text, cursor: cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined, limit: 30 }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const page = r.value;
  const base = `/${locale}/errors`;
  const params = { status, source, since, q: text };
  const sentry = observabilityStatus().sentry;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Bug />} title={t("admin.errors.title")} description={t("admin.errors.subtitle")} why={t("admin.errors.why")} />
      {sentry ? <Notice tone="info">{t("admin.errors.sentryToo")}</Notice> : null}
      <StatGrid>
        <StatTile label={t("admin.errors.status.OPEN")} value={formatNumber(page.counts.OPEN, locale)} href={`${base}?status=OPEN`} tone={page.counts.OPEN ? "danger" : undefined} />
        <StatTile label={t("admin.errors.status.REGRESSED")} value={formatNumber(page.counts.REGRESSED, locale)} href={`${base}?status=REGRESSED`} tone={page.counts.REGRESSED ? "danger" : undefined} />
        <StatTile label={t("admin.errors.events24h")} value={formatNumber(page.events24h, locale)} href={`${base}?since=24h`} />
        <StatTile label={t("admin.errors.status.RESOLVED")} value={formatNumber(page.counts.RESOLVED, locale)} href={`${base}?status=RESOLVED`} tone="success" />
      </StatGrid>
      <SourceLine source={t("admin.errors.source")} />
      <Card>
        <CardHeader icon={<Bug />} title={t("admin.errors.groups")} />
        <QuickFilters base={base} name="since" value={since} params={{ status, source, q: text }} label={t("admin.errors.filterSince")} options={[{ value: "", label: t("admin.errors.allTime") }, ...SINCE.map((s) => ({ value: s, label: t(`admin.errors.since.${s}`) }))]} />
        <FilterBar
          action={base}
          q={text}
          qLabel={t("admin.errors.search")}
          values={params}
          submitLabel={t("admin.incidents.apply")}
          filters={[
            { name: "status", label: t("admin.errors.fields.status"), options: ERROR_STATUSES.map((s) => ({ value: s, label: t(`admin.errors.status.${s}`) })) },
            { name: "source", label: t("admin.errors.fields.source"), options: (["user", "admin", "worker"] as const).map((s) => ({ value: s, label: t(`admin.errors.sources.${s}`) })) },
          ]}
          extra={
            <Link href={base} className="self-center text-xs text-muted-foreground hover:underline">
              {t("admin.incidents.reset")}
            </Link>
          }
        />
        {page.data.length === 0 ? (
          <EmptyState icon={<Bug />} title={t("admin.errors.empty")} body={t("admin.errors.emptyHint")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.errors.fields.error")}</Th>
                  <Th>{t("admin.errors.fields.status")}</Th>
                  <Th>{t("admin.errors.fields.source")}</Th>
                  <Th className="text-end">{t("admin.errors.fields.events")}</Th>
                  <Th className="text-end">{t("admin.errors.fields.last24h")}</Th>
                  <Th>{t("admin.errors.fields.lastSeen")}</Th>
                  <Th>{t("admin.errors.fields.release")}</Th>
                </Tr>
              </THead>
              <TBody>
                {page.data.map((g) => (
                  <Tr key={g.id}>
                    <Td className="max-w-[28rem]">
                      <Link href={`${base}/${g.id}`} className="font-medium hover:underline">
                        {g.name}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{g.message}</div>
                      {g.route ? <div className="truncate font-mono text-[11px] text-muted-foreground">{g.route}</div> : null}
                    </Td>
                    <Td>
                      <StatusBadge domain="errorGroup" value={g.status}>
                        {t(`admin.errors.status.${g.status}`)}
                      </StatusBadge>
                    </Td>
                    <Td className="text-xs">{t(`admin.errors.sources.${g.source === "user" || g.source === "admin" || g.source === "worker" ? g.source : "user"}`)}</Td>
                    <Td className="text-end tabular-nums">{formatNumber(g.count, locale)}</Td>
                    <Td className="text-end tabular-nums">{formatNumber(g.events24h, locale)}</Td>
                    <Td className="text-xs">
                      <Timestamp value={g.lastSeenAt} mode="relative" />
                    </Td>
                    <Td className="font-mono text-[11px]">{g.lastRelease ?? "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <NextPage base={base} params={params} cursor={page.nextCursor} label={t("admin.system.jobs.next")} />
      </Card>
    </div>
  );
}
