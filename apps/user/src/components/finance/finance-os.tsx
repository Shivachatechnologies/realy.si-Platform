"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Activity, AlertTriangle, CheckCircle2, Clock, Flame, Hourglass, ShieldAlert } from "lucide-react";
import { BarsChart, Gauge, LineChart } from "@/components/crm/os-charts";
import { useI18n } from "@/i18n/client";
import { formatMoney, minorUnits } from "@/i18n/format";
import { cn } from "@/lib/utils";

/** Finance OS command center: animated money charts, profit gauge, health verdicts and a cash-flow forecast band. */

export interface CommandData {
  currency: string;
  monthly: { month: string; revenue: string; expenses: string; profit: string }[];
  cash: { month: string; inflow: string; outflow: string; net: string }[];
  forecast: { month: string; balance: string; receivables: string }[];
  startingCash: string;
  margin: number | null;
  runwayMonths: number | null;
  netBurn: string;
  overdue: string;
  receivables: string;
  payablesOverdue: string;
  payables: string;
}

type Tone = "success" | "warning" | "danger" | "neutral";
const TONE_CLS: Record<Tone, string> = {
  success: "border-success/40 bg-success/5 text-success",
  warning: "border-warning/40 bg-warning/5 text-warning",
  danger: "border-danger/40 bg-danger/5 text-danger",
  neutral: "border-border bg-surface text-muted-foreground",
};

export function FinanceCommandCenter({ data, locale }: { data: CommandData; locale: string }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const f = (k: string, v?: Record<string, string | number>) => t(`finance.os.${k}`, v);
  const scale = 10 ** minorUnits(data.currency);
  const major = (minor: string) => Number(minor) / scale;
  const fmt = (v: number) => formatMoney({ amountMinor: BigInt(Math.round(v * scale)), currency: data.currency }, locale, { display: "narrowSymbol" });
  const money = (minor: string) => formatMoney({ amountMinor: minor, currency: data.currency }, locale);
  const label = (k: string) => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));

  // Health verdicts (plain language, from real figures).
  const runwayTone: Tone = data.runwayMonths === null ? "success" : data.runwayMonths >= 12 ? "success" : data.runwayMonths >= 6 ? "warning" : "danger";
  const runwayText = data.runwayMonths === null ? f("health.runwayPositive") : f(`health.runway.${runwayTone}`, { months: data.runwayMonths });
  const burnTone: Tone = BigInt(data.netBurn) === 0n ? "success" : runwayTone;
  const overdueTone: Tone = BigInt(data.overdue) === 0n ? "success" : BigInt(data.overdue) * 4n > BigInt(data.receivables || "0") ? "danger" : "warning";
  const payTone: Tone = BigInt(data.payablesOverdue) === 0n ? "success" : "danger";
  const marginTone: Tone = data.margin === null ? "neutral" : data.margin >= 15 ? "success" : data.margin >= 0 ? "warning" : "danger";
  const health = [
    { key: "runway", icon: Hourglass, tone: runwayTone, title: f("health.runwayTitle"), value: data.runwayMonths === null ? "∞" : f("months", { count: data.runwayMonths }), text: runwayText, href: "/finance/cashflow" },
    { key: "burn", icon: Flame, tone: burnTone, title: f("health.burnTitle"), value: money(data.netBurn), text: BigInt(data.netBurn) === 0n ? f("health.burnNone") : f("health.burnText"), href: "/finance/cashflow" },
    { key: "overdue", icon: Clock, tone: overdueTone, title: f("health.overdueTitle"), value: money(data.overdue), text: overdueTone === "success" ? f("health.overdueNone") : f("health.overdueText"), href: "/finance/receivables" },
    { key: "payables", icon: ShieldAlert, tone: payTone, title: f("health.payablesTitle"), value: money(data.payablesOverdue), text: payTone === "success" ? f("health.payablesNone") : f("health.payablesText"), href: "/finance/payables" },
  ];

  // Forecast band: high = every open invoice paid on time; low = none of them paid.
  const high = data.forecast.map((m) => major(m.balance));
  const cumRecv = data.forecast.map((_, i) => data.forecast.slice(0, i + 1).reduce((sum, m) => sum + major(m.receivables), 0));
  const low = data.forecast.map((m, i) => major(m.balance) - cumRecv[i]!);
  const hasMonthly = data.monthly.some((m) => m.revenue !== "0" || m.expenses !== "0");
  const hasCash = data.cash.some((m) => m.inflow !== "0" || m.outflow !== "0");

  return (
    <div className="grid gap-4">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {health.map((h, i) => {
          const Icon = h.tone === "success" ? CheckCircle2 : h.tone === "danger" ? AlertTriangle : h.icon;
          return (
            <motion.li key={h.key} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
              <Link href={`/${locale}${h.href}`} className={cn("hover-lift grid h-full gap-1 rounded-lg border p-3", TONE_CLS[h.tone])}>
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon aria-hidden className="size-3.5" />
                  {h.title}
                </span>
                <span className="text-xl font-semibold text-foreground tabular-nums">{h.value}</span>
                <span className="text-xs text-foreground/80">{h.text}</span>
              </Link>
            </motion.li>
          );
        })}
      </ul>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="grid gap-2 rounded-lg border bg-surface p-4 shadow-elev-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Activity aria-hidden className="size-4 text-success" />
            {f("charts.pnl")}
          </h3>
          <p className="text-xs text-muted-foreground">{f("charts.pnlHint")}</p>
          {hasMonthly ? (
            <LineChart
              label={f("charts.pnl")}
              labels={data.monthly.map((m) => label(m.month))}
              format={fmt}
              series={[
                { name: f("moneyIn"), values: data.monthly.map((m) => major(m.revenue)), color: "var(--success)", area: true },
                { name: f("moneyOut"), values: data.monthly.map((m) => major(m.expenses)), color: "var(--danger)", area: true },
                { name: f("profit"), values: data.monthly.map((m) => major(m.profit)), color: "var(--primary)", dashed: true },
              ]}
            />
          ) : (
            <EmptyChart text={f("charts.pnlEmpty")} href={`/${locale}/finance/start?flow=income`} cta={f("flows.income.title")} />
          )}
        </section>
        <section className="grid content-start gap-2 rounded-lg border bg-surface p-4 shadow-elev-2">
          <h3 className="text-sm font-semibold">{f("charts.gauge")}</h3>
          <Gauge value={data.margin === null ? null : data.margin / 100} label={f("charts.gaugeLabel")} valueText={data.margin === null ? "—" : `${data.margin}%`} tone={marginTone} />
          <p className="text-center text-xs text-muted-foreground">{data.margin === null ? f("charts.gaugeNone") : f(`charts.gauge_${marginTone}`)}</p>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="grid gap-2 rounded-lg border bg-surface p-4 shadow-elev-2">
          <h3 className="text-sm font-semibold">{f("charts.cash")}</h3>
          <p className="text-xs text-muted-foreground">{f("charts.cashHint")}</p>
          {hasCash ? (
            <BarsChart
              label={f("charts.cash")}
              labels={data.cash.map((m) => label(m.month))}
              format={fmt}
              series={[
                { name: f("cashIn"), values: data.cash.map((m) => major(m.inflow)), color: "var(--success)" },
                { name: f("cashOut"), values: data.cash.map((m) => major(m.outflow)), color: "var(--warning)" },
              ]}
            />
          ) : (
            <EmptyChart text={f("charts.cashEmpty")} href={`/${locale}/finance/start?flow=expense`} cta={f("flows.expense.title")} />
          )}
        </section>
        <section className="grid gap-2 rounded-lg border bg-surface p-4 shadow-elev-2">
          <h3 className="text-sm font-semibold">{f("charts.forecast")}</h3>
          <p className="text-xs text-muted-foreground">{f("charts.forecastHint", { cash: money(data.startingCash) })}</p>
          <LineChart
            label={f("charts.forecast")}
            labels={data.forecast.map((m) => label(m.month))}
            format={fmt}
            series={[{ name: f("charts.forecastLine"), values: high, color: "var(--success)" }]}
            band={{ low, high, color: "var(--info)", name: f("charts.forecastBand") }}
          />
          {low.some((v) => v < 0) ? <p className="text-xs text-danger">{f("charts.forecastRisk")}</p> : null}
        </section>
      </div>
    </div>
  );
}

function EmptyChart({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="grid place-items-center gap-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      <p>{text}</p>
      <Link href={href} className="font-medium text-success hover:underline">
        {cta}
      </Link>
    </div>
  );
}
