import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SyncTable } from "@/components/integrations/sync-table";
import { IntegrationsTabs } from "@/components/integrations/tabs";
import { Forbidden, NoCompany, PageFrame } from "@/components/automation/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { providerInfo } from "@/server/modules/integrations/catalog";
import { listRequestLogs, listSyncRuns } from "@/server/modules/integrations/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata({ params }: PageProps<"/[locale]/integrations/[provider]/logs">): Promise<Metadata> {
  const { provider } = await params;
  const t = await getT();
  return { title: `${providerInfo(provider)?.name ?? t("modules.integrations.title")} · ${t("integrations.logs.title")}` };
}

const tone = (status: number | null) => (status === null || status >= 400 ? "danger" : status >= 300 ? "warning" : "success");

/** Per-connection log: every provider API call (method, path, status, timing, summaries — never secrets or bodies) and sync runs. */
export default async function IntegrationLogsPage({ params, searchParams }: PageProps<"/[locale]/integrations/[provider]/logs">) {
  const { provider } = await params;
  const sp = await searchParams;
  const info = providerInfo(provider);
  if (!info) notFound();
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const frame = (children: React.ReactNode) => (
    <PageFrame
      title={`${info.name} · ${t("integrations.logs.title")}`}
      subtitle={t("integrations.logs.help")}
      actions={
        <Link href={`/${locale}/integrations/${info.key}`} className="text-sm text-muted-foreground hover:underline">
          ← {info.name}
        </Link>
      }
    >
      {children}
    </PageFrame>
  );
  if (!company) return frame(<NoCompany message={t("company.empty")} />);
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "integrations.read", chain))) return frame(<Forbidden message={t("errors.forbidden")} />);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const outcome = one(sp.outcome) === "error" ? "error" : one(sp.outcome) === "ok" ? "ok" : undefined;
  const cursor = one(sp.cursor);
  const [logs, syncs] = await Promise.all([
    listRequestLogs(viewer.ctx, org.id, company.id, info.key, { outcome, cursor }),
    info.syncKinds?.length ? listSyncRuns(viewer.ctx, org.id, company.id, { provider: info.key, limit: 20 }) : Promise.resolve(null),
  ]);
  const tz = company.timezone ?? "UTC";
  const qs = (c?: string) => {
    const q = new URLSearchParams();
    if (outcome) q.set("outcome", outcome);
    if (c) q.set("cursor", c);
    const s = q.toString();
    return s ? `?${s}` : "";
  };
  return frame(
    <>
      <IntegrationsTabs
        locale={locale}
        active="connected"
        labels={{ marketplace: t("integrations.tabs.marketplace"), connected: t("integrations.tabs.connected"), webhooks: t("integrations.tabs.webhooks"), syncs: t("integrations.tabs.syncs") }}
      />
      <Card>
        <CardHeader title={t("integrations.logs.requests")} description={t("integrations.logs.privacy")} />
        <form className="flex flex-wrap gap-2 border-b p-3" action={`/${locale}/integrations/${info.key}/logs`}>
          <Select name="outcome" defaultValue={outcome ?? ""} className="w-auto" aria-label={t("integrations.logs.outcome")}>
            <option value="">{t("integrations.logs.allOutcomes")}</option>
            <option value="ok">{t("integrations.logs.ok")}</option>
            <option value="error">{t("integrations.logs.errors")}</option>
          </Select>
          <Button type="submit" variant="secondary">
            {t("integrations.applyFilters")}
          </Button>
        </form>
        {logs.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("integrations.logs.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("integrations.logs.time")}</Th>
                <Th>{t("integrations.logs.request")}</Th>
                <Th>{t("integrations.logs.status")}</Th>
                <Th>{t("integrations.logs.duration")}</Th>
                <Th>{t("integrations.logs.summary")}</Th>
              </Tr>
            </THead>
            <TBody>
              {logs.data.map((l) => (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(l.createdAt, locale, tz)}</Td>
                  <Td className="max-w-96">
                    <span className="me-2 font-mono text-xs font-medium">{l.method}</span>
                    <span className="break-all font-mono text-xs text-muted-foreground" dir="ltr">
                      {l.url}
                    </span>
                    {l.requestSummary ? <p className="text-xs text-muted-foreground">{l.requestSummary}</p> : null}
                  </Td>
                  <Td>
                    <Badge tone={tone(l.status)}>{l.status ?? t("integrations.logs.noResponse")}</Badge>
                    {l.attempts > 1 ? <span className="ms-1 text-xs text-muted-foreground">{t("integrations.logs.attempts", { count: l.attempts })}</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{l.durationMs} ms</Td>
                  <Td className="max-w-80 text-xs">
                    {l.responseSummary ? <p className="text-muted-foreground">{l.responseSummary}</p> : null}
                    {l.error ? <p className="text-danger">{l.error}</p> : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {logs.nextCursor || cursor ? (
          <div className="flex justify-between gap-2 border-t p-3 text-sm">
            {cursor ? <Link href={`/${locale}/integrations/${info.key}/logs${qs()}`} className="hover:underline">{t("integrations.firstPage")}</Link> : <span />}
            {logs.nextCursor ? <Link href={`/${locale}/integrations/${info.key}/logs${qs(logs.nextCursor)}`} className="hover:underline">{t("common.next")} →</Link> : null}
          </div>
        ) : null}
      </Card>
      {syncs ? (
        <Card>
          <CardHeader title={t("integrations.syncHistory")} description={t(`integrations.providers.${info.key}.sync`)} />
          {syncs.data.length ? <SyncTable rows={syncs.data} t={t} locale={locale} tz={tz} /> : <p className="p-4 text-muted-foreground">{t("integrations.syncs.empty")}</p>}
        </Card>
      ) : null}
    </>,
  );
}
