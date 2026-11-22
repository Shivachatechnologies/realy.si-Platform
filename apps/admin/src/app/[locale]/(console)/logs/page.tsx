import Link from "next/link";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, guard, sp } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { CopyButton } from "@/components/admin/copy-button";
import { SourceLine } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { LOG_LEVELS, LOG_SOURCES, searchLogs } from "@/server/modules/admin/logs";
import { requireViewer } from "@/server/session";

/** Logs explorer over the platform's structured sources (masked). Newest first, keyset pagination. */
export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const source = LOG_SOURCES.find((s) => s === sp(q.source));
  const level = LOG_LEVELS.find((s) => s === sp(q.level));
  const text = sp(q.q);
  const requestId = sp(q.requestId)?.match(/^[\w-]{4,100}$/) ? sp(q.requestId) : undefined;
  const organizationId = sp(q.org)?.match(/^[0-9a-f-]{36}$/i) ? sp(q.org) : undefined;
  const from = sp(q.from)?.match(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/) ? sp(q.from) : undefined;
  const to = sp(q.to)?.match(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/) ? sp(q.to) : undefined;
  const before = sp(q.before);
  const r = await guard(searchLogs(viewer.ctx, { source, level, q: text, requestId, organizationId, from, to, before: before && !Number.isNaN(Date.parse(before)) ? before : undefined, limit: 50 }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const page = r.value;
  const base = `/${locale}/logs`;
  const params = { source, level, q: text, requestId, org: organizationId, from, to };
  const next = page.nextBefore ? `${base}?${new URLSearchParams(Object.entries({ ...params, before: page.nextBefore }).filter((e): e is [string, string] => !!e[1]))}` : null;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<ScrollText />} title={t("admin.logs.title")} description={t("admin.logs.subtitle")} why={t("admin.logs.why")} />
      {page.auditHidden ? <Notice tone="info">{t("admin.logs.auditHidden")}</Notice> : null}
      <Card>
        <CardHeader icon={<ScrollText />} title={t("admin.logs.lines")} description={t("admin.logs.window", { from: page.window.from.toISOString().slice(0, 16), to: page.window.to.toISOString().slice(0, 16) })} />
        <FilterBar
          action={base}
          q={text}
          qLabel={t("admin.logs.search")}
          values={params}
          submitLabel={t("admin.incidents.apply")}
          filters={[
            { name: "source", label: t("admin.logs.source"), options: LOG_SOURCES.map((s) => ({ value: s, label: t(`admin.logs.sources.${s}`) })) },
            { name: "level", label: t("admin.logs.level"), options: LOG_LEVELS.map((s) => ({ value: s, label: t(`admin.logs.levels.${s}`) })) },
          ]}
          extra={
            <>
              <Input name="requestId" defaultValue={requestId} maxLength={100} aria-label={t("admin.logs.requestId")} placeholder={t("admin.logs.requestId")} className="w-full font-mono text-xs sm:w-64" />
              <Input name="org" defaultValue={organizationId} maxLength={36} aria-label={t("admin.logs.organization")} placeholder={t("admin.logs.organization")} className="w-full font-mono text-xs sm:w-72" />
              <Input name="from" type="date" defaultValue={from?.slice(0, 10)} aria-label={t("admin.logs.from")} className="w-auto" />
              <Input name="to" type="date" defaultValue={to?.slice(0, 10)} aria-label={t("admin.logs.to")} className="w-auto" />
              <Link href={base} className="self-center text-xs text-muted-foreground hover:underline">
                {t("admin.incidents.reset")}
              </Link>
            </>
          }
        />
        {page.data.length === 0 ? (
          <EmptyState icon={<ScrollText />} title={t("admin.logs.empty")} body={t("admin.logs.emptyHint")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.logs.time")}</Th>
                  <Th>{t("admin.logs.level")}</Th>
                  <Th>{t("admin.logs.source")}</Th>
                  <Th>{t("admin.logs.message")}</Th>
                  <Th>{t("admin.logs.context")}</Th>
                </Tr>
              </THead>
              <TBody>
                {page.data.map((l) => (
                  <Tr key={l.key}>
                    <Td className="whitespace-nowrap text-xs">
                      <Timestamp value={l.at} mode="absolute" />
                    </Td>
                    <Td>
                      <StatusBadge domain="logLevel" value={l.level}>
                        {t(`admin.logs.levels.${l.level}`)}
                      </StatusBadge>
                    </Td>
                    <Td className="text-xs">{t(`admin.logs.sources.${l.source}`)}</Td>
                    <Td className="max-w-[32rem]">
                      {l.href ? (
                        <Link href={`/${locale}${l.href}`} className="break-words font-mono text-xs hover:underline">
                          {l.message}
                        </Link>
                      ) : (
                        <span className="break-words font-mono text-xs">{l.message}</span>
                      )}
                      <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px] text-muted-foreground">
                        {Object.entries(l.attrs)
                          .filter(([, v]) => v !== null && v !== "")
                          .slice(0, 6)
                          .map(([k, v]) => (
                            <span key={k}>
                              {k}={String(v)}
                            </span>
                          ))}
                      </div>
                    </Td>
                    <Td className="text-[11px]">
                      {l.requestId ? (
                        <span className="inline-flex items-center gap-1">
                          <Link href={`${base}?requestId=${encodeURIComponent(l.requestId)}`} className="font-mono hover:underline">
                            {l.requestId.slice(0, 16)}
                          </Link>
                          <CopyButton value={l.requestId} label={t("admin.logs.requestId")} />
                        </span>
                      ) : null}
                      {l.organizationId ? (
                        <Link href={`/${locale}/organizations/${l.organizationId}`} className="block font-mono text-muted-foreground hover:underline">
                          {l.organizationId.slice(0, 8)}
                        </Link>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        {next ? (
          <div className="flex justify-end border-t p-3">
            <Button asChild size="sm" variant="secondary">
              <Link href={next}>{t("admin.logs.older")}</Link>
            </Button>
          </div>
        ) : null}
      </Card>
      <SourceLine source={t("admin.logs.sourcesNote")} />
    </div>
  );
}
