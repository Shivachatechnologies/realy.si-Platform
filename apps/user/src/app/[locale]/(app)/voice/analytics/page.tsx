import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/comms/bits";
import { voicePage } from "@/components/voice/context";
import { formatDuration } from "@/components/voice/bits";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { voiceAnalytics } from "@/server/modules/voice/analytics";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.tabs.analytics") };
}

const RANGES = [7, 30, 90] as const;

export default async function VoiceAnalyticsPage({ searchParams }: PageProps<"/[locale]/voice/analytics">) {
  const p = await voicePage("analytics");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, wrap } = p;
  const sp = await searchParams;
  const days = RANGES.find((r) => String(r) === sp.days) ?? 30;
  const a = await voiceAnalytics(viewer.ctx, org.id, company.id, days);
  const maxOutcome = Math.max(1, ...a.outcomes.map((o) => o.count));
  const maxDay = Math.max(1, ...a.daily.map((d) => d.inbound + d.outbound));
  const rated = a.sentiments.filter((s) => s.key !== "UNKNOWN").reduce((s, x) => s + x.count, 0);
  return wrap(
    <div className="grid gap-4">
      <nav className="flex gap-1" aria-label={t("voice.analytics.range")}>
        {RANGES.map((r) => (
          <Link key={r} href={`/${locale}/voice/analytics?days=${r}`} aria-current={r === days ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm", r === days ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
            {t("voice.analytics.days", { days: r })}
          </Link>
        ))}
      </nav>
      <StatGrid>
        <StatTile index={0} label={t("voice.stats.calls")} value={a.total - a.awaitingApproval} />
        <StatTile index={1} label={t("voice.stats.connected")} value={a.connected} hint={a.connectRate !== null ? t("voice.stats.connectRate", { rate: a.connectRate }) : t("voice.stats.noOutbound")} />
        <StatTile index={2} label={t("voice.analytics.avgDuration")} value={a.avgDurationSec !== null ? formatDuration(a.avgDurationSec) : "—"} />
        <StatTile index={3} label={t("voice.analytics.cost")} money={{ amountMinor: a.costCents, currency: "USD" }} hint={t("voice.analytics.costHint")} />
      </StatGrid>
      {a.total === 0 ? (
        <EmptyState>{t("voice.analytics.empty")}</EmptyState>
      ) : (
        <>
          <Card>
            <CardHeader title={t("voice.analytics.volume")} description={t("voice.analytics.volumeHint")} />
            <CardBody className="grid gap-3">
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" />{t("voice.direction.OUTBOUND")}</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-info" />{t("voice.direction.INBOUND")}</span>
              </div>
              <div className="flex h-40 items-end gap-[2px]" aria-hidden>
                {a.daily.map((d) => (
                  <div key={d.day} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end gap-[2px]" title={`${formatDate(d.day, locale, tz)} · ${t("voice.direction.OUTBOUND")} ${d.outbound} · ${t("voice.direction.INBOUND")} ${d.inbound}`}>
                    {d.inbound ? <div className="rounded-t-[4px] bg-info group-hover:opacity-80" style={{ height: `${(d.inbound / maxDay) * 100}%` }} /> : null}
                    {d.outbound ? <div className={cn("bg-primary group-hover:opacity-80", d.inbound ? "" : "rounded-t-[4px]")} style={{ height: `${(d.outbound / maxDay) * 100}%` }} /> : null}
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden>
                <span>{formatDate(a.daily[0]!.day, locale, tz)}</span>
                <span>{formatDate(a.daily[a.daily.length - 1]!.day, locale, tz)}</span>
              </div>
              <table className="sr-only">
                <caption>{t("voice.analytics.volume")}</caption>
                <thead><tr><th>{t("voice.analytics.day")}</th><th>{t("voice.direction.OUTBOUND")}</th><th>{t("voice.direction.INBOUND")}</th></tr></thead>
                <tbody>{a.daily.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.outbound}</td><td>{d.inbound}</td></tr>)}</tbody>
              </table>
            </CardBody>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t("voice.analytics.outcomes")} description={t("voice.analytics.outcomesHint", { count: a.analyzed })} />
              <CardBody>
                {a.outcomes.length ? (
                  <ul className="grid gap-2">
                    {[...a.outcomes].sort((x, y) => y.count - x.count).map((o) => (
                      <li key={o.key}>
                        <Link href={`/${locale}/voice/calls?outcome=${o.key}`} className="group grid grid-cols-[9rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm sm:grid-cols-[11rem_minmax(0,1fr)_2.5rem]">
                          <span className="truncate">{t(`voice.outcomes.${o.key}`)}</span>
                          <span className="h-3 rounded-e-[4px] bg-muted"><span className="block h-full rounded-e-[4px] bg-primary group-hover:opacity-80" style={{ width: `${(o.count / maxOutcome) * 100}%` }} /></span>
                          <span className="text-end tabular-nums text-muted-foreground">{o.count}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("voice.analytics.noOutcomes")}</p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t("voice.analytics.sentiment")} description={t("voice.analytics.sentimentHint", { count: rated })} />
              <CardBody className="grid gap-3">
                {rated ? (
                  <>
                    <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" aria-hidden>
                      {a.sentiments.filter((s) => s.key !== "UNKNOWN" && s.count).map((s) => (
                        <div key={s.key} title={`${t(`voice.sentiment.${s.key}`)}: ${s.count}`} className={s.key === "POSITIVE" ? "bg-success" : s.key === "NEGATIVE" ? "bg-danger" : "bg-muted-foreground/40"} style={{ width: `${(s.count / rated) * 100}%` }} />
                      ))}
                    </div>
                    <ul className="grid gap-1 text-sm">
                      {a.sentiments.filter((s) => s.key !== "UNKNOWN").map((s) => (
                        <li key={s.key} className="flex items-center justify-between">
                          <span>{t(`voice.sentiment.${s.key}`)}</span>
                          <span className="tabular-nums text-muted-foreground">{s.count} · {Math.round((s.count / rated) * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("voice.analytics.noSentiment")}</p>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>,
  );
}
