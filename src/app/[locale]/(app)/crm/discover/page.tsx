import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { DiscoverForm, ProspectCard } from "@/components/crm/revenue/discover";
import { ConnectNotice } from "@/components/crm/revenue/panels";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { revenueChannels } from "@/server/modules/crm/channels";
import { listProspectSearches, prospectResults } from "@/server/modules/crm/discovery";
import { param } from "@/server/modules/crm/common";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.discover") };
}

/** Lead discovery: describe your ideal customer, get real web results from the connected research provider, pick leads. */
export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="discover">{null}</CrmFrame>;
  const { t, locale, tz, org, company, viewer, base } = c;
  const q = await searchParams;
  const [channels, searches, current] = await Promise.all([
    revenueChannels(org.id, company.id),
    listProspectSearches(viewer.ctx, org.id, company.id),
    prospectResults(viewer.ctx, org.id, company.id, param(q, "search")),
  ]);
  const fresh = current?.prospects.filter((p) => p.status === "NEW").length ?? 0;
  return (
    <CrmFrame active="discover" eyebrow={t("crm.rev.discover.eyebrow")} title={t("crm.rev.discover.title")} subtitle={t("crm.rev.discover.subtitle")}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid content-start gap-4">
          <section className="grid gap-3 rounded-xl border bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_8%,var(--surface)),var(--surface)_65%)] p-4 shadow-elev-1 sm:p-5">
            {!channels.research.length ? (
              <ConnectNotice locale={locale} text={t("crm.rev.discover.noProvider")} connect={t("crm.rev.connect")} />
            ) : c.canManage ? (
              <DiscoverForm base={base} locale={locale} initialAudience={current?.audience ?? ""} />
            ) : (
              <Notice tone="info">{t("crm.rev.readOnly")}</Notice>
            )}
          </section>
          {current ? (
            <section className="grid gap-3" aria-labelledby="results-h">
              <div className="grid gap-0.5">
                <h2 id="results-h" className="font-display text-2xl">
                  {t("crm.rev.discover.results", { count: current.resultCount })}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("crm.rev.discover.resultsMeta", { query: current.query, provider: current.provider ?? "—", date: formatDateTime(current.createdAt, locale, tz), fresh })}
                </p>
              </div>
              {current.prospects.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {current.prospects.map((p) => (
                    <ProspectCard key={p.id} base={base} locale={locale} canManage={c.canManage} p={{ id: p.id, title: p.title, url: p.url, domain: p.domain, snippet: p.snippet, status: p.status, suggestedName: p.suggestedName, leadId: p.leadId, knownLeadId: p.knownLeadId }} />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{t("crm.rev.discover.noResults")}</p>
              )}
              <p className="text-xs text-muted-foreground">{t("crm.rev.discover.next")}</p>
            </section>
          ) : null}
        </div>
        <aside className="grid content-start gap-3 rounded-xl border bg-surface p-4 shadow-elev-1">
          <h2 className="flex items-center gap-2 font-display text-lg">
            <History className="size-4 text-primary" aria-hidden />
            {t("crm.rev.discover.history")}
          </h2>
          {searches.length ? (
            <ul className="grid gap-2 text-sm">
              {searches.map((s) => (
                <li key={s.id}>
                  <Link href={`/${locale}/crm/discover?search=${s.id}`} aria-current={current?.id === s.id ? "page" : undefined} className={current?.id === s.id ? "font-semibold" : "hover:underline"}>
                    {s.audience ?? s.query}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {t("crm.rev.discover.historyMeta", { results: s.resultCount, added: s._count.prospects, date: formatDateTime(s.createdAt, locale, tz) })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("crm.rev.discover.historyEmpty")}</p>
          )}
        </aside>
      </div>
    </CrmFrame>
  );
}
