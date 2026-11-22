import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatMetric } from "@/components/bi/format";
import { formatNumber, formatRelativeTime } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { CommandCenterMetrics } from "@/server/modules/bi/command-center";
import { cn } from "@/lib/utils";

/**
 * The Command Center's live operations board: money, growth, work, people and AI, customers and the platform, each
 * area with the real registry metrics of the last 30 days (vs the 30 before) that the viewer may read, plus AI credits
 * this month and open alerts. Missing data is shown as "no data", never as zero; an area with nothing visible says
 * so. Values come from the company's metric snapshot and carry its time.
 */
export function OpsBoard({ t, locale, data, alerts }: { t: Translate; locale: string; data: CommandCenterMetrics; alerts: { critical: number; warning: number } }) {
  const fmt = (v: number | null, unit: Parameters<typeof formatMetric>[1]) => (v === null ? t("dna.command.board.noData") : formatMetric(v, unit, locale, data.currency, { compact: true }));
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.board.map((b) => (
          <section key={b.area} aria-labelledby={`ops-${b.area}`} className="grid content-start gap-2 rounded-2xl border bg-surface/60 p-4 backdrop-blur">
            <h3 id={`ops-${b.area}`} className="text-micro font-medium text-muted-foreground uppercase">
              {t(`dna.command.board.areas.${b.area}`)}
            </h3>
            {b.values.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dna.command.board.areaHidden")}</p>
            ) : (
              <ul className="grid gap-1.5">
                {b.values.map((m) => {
                  const Icon = m.changePct === null || Math.abs(m.changePct) < 0.5 ? Minus : m.changePct > 0 ? ArrowUpRight : ArrowDownRight;
                  return (
                    <li key={m.key}>
                      <Link href={`/${locale}${m.href ?? "/analytics"}`} className="flex items-baseline gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted/60">
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{t(m.labelKey)}</span>
                        <span className={cn("numeral font-mono text-sm", m.value === null && "text-xs text-muted-foreground")}>{fmt(m.value, m.unit)}</span>
                        {m.value !== null && m.changePct !== null ? (
                          <span className={cn("inline-flex items-center text-[11px]", m.trend === 1 ? "text-success" : m.trend === -1 ? "text-danger" : "text-muted-foreground")}>
                            <Icon aria-hidden className="size-3 rtl:-scale-x-100" />
                            {formatNumber(Math.abs(m.changePct) / 100, locale, { style: "percent", maximumFractionDigits: 0 })}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {data.credits ? (
          <Link href={`/${locale}/settings/billing`} className="inline-flex items-baseline gap-2 hover:underline">
            <span className="text-muted-foreground">{t("dna.command.board.credits")}</span>
            <span className="numeral font-mono">
              {data.credits.limit === null ? t("dna.command.board.creditsUnlimited", { used: formatNumber(data.credits.used, locale) }) : t("dna.command.board.creditsOf", { used: formatNumber(data.credits.used, locale), limit: formatNumber(data.credits.limit, locale) })}
            </span>
          </Link>
        ) : null}
        <Link href={`/${locale}/analytics/health`} className="inline-flex items-baseline gap-2 hover:underline">
          <span className="text-muted-foreground">{t("dna.command.board.alerts")}</span>
          <span className={cn("numeral font-mono", alerts.critical ? "text-danger" : alerts.warning ? "text-warning" : "text-success")}>
            {alerts.critical + alerts.warning === 0 ? t("dna.command.board.noAlerts") : t("dna.command.board.alertCounts", { critical: alerts.critical, warning: alerts.warning })}
          </span>
        </Link>
        <span className="ms-auto text-xs text-muted-foreground">{t("dna.command.board.asOf", { when: formatRelativeTime(data.computedAt, locale) })}</span>
      </div>
    </div>
  );
}
