import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, BellRing, CalendarClock, CheckCircle2, FileWarning, Gauge, PiggyBank, TrendingDown } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { financePage } from "@/components/finance/page-context";
import { RunwayDial } from "@/components/finance/runway-dial";
import { UsageBar } from "@/components/finance/widgets";
import { formatDateTime } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { financeAlertCenter } from "@/server/modules/finance/alerts";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.alerts") };
}

function AlertCard({ level, icon, title, children, action }: { level: "critical" | "warning"; icon: ReactNode; title: string; children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <article className={cn("reveal grid gap-3 rounded-lg border bg-surface p-4 shadow-elev-1", level === "critical" ? "border-danger/40" : "border-warning/40")}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-md [&_svg]:size-4", level === "critical" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning")}>
          {icon}
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="font-semibold">{title}</h3>
          <div className="grid gap-2 text-sm text-muted-foreground">{children}</div>
        </div>
      </div>
      {action ? (
        <Link href={action.href} className="inline-flex min-h-9 items-center gap-1 justify-self-start rounded-md bg-muted px-3 text-sm font-medium hover:bg-muted/70">
          {action.label}
          <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
        </Link>
      ) : null}
    </article>
  );
}

/** Financial alerts: low runway, cash going negative, overdue invoices and bills, budgets running out — live from the books. */
export default async function FinanceAlertsPage() {
  const p = await financePage("alerts");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, day, tz } = p;
  const a = await financeAlertCenter(viewer.ctx, org.id, company.id);
  const f = (path: string) => `/${locale}/finance${path}`;
  const monthLabel = (k: string) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${k}-01T00:00:00Z`));

  return p.frame(
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Card variant="glass">
          <CardHeader icon={<Gauge />} title={t("finance.alerts.runwayTitle")} description={t("finance.alerts.runwayHint")} />
          <CardBody className="grid gap-3">
            <RunwayDial
              months={a.runway.months}
              label={t("finance.alerts.runwayLabel")}
              valueText={a.runway.months === null ? t("finance.alerts.noBurn") : t("finance.dashboard.months", { count: a.runway.months })}
              scaleLabels={{ critical: t("finance.alerts.zones.critical"), warning: t("finance.alerts.zones.warning"), healthy: t("finance.alerts.zones.healthy") }}
            />
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md bg-muted/50 p-2">
                <dt className="text-xs text-muted-foreground">{t("finance.metrics.cashBalance")}</dt>
                <dd className="font-medium tabular-nums">{money(a.runway.cash)}</dd>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <dt className="text-xs text-muted-foreground">{t("finance.metrics.burnRate")}</dt>
                <dd className="font-medium tabular-nums">{money(a.runway.netBurn)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {t("finance.alerts.runwayExplain")}{" "}
              <Link href={f("/learn#runway")} className="font-medium text-primary hover:underline">
                {t("finance.flow.whatIsThis")}
              </Link>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<BellRing />} title={t("finance.alerts.historyTitle")} description={t("finance.alerts.historyHint")} />
          <CardBody>
            {a.history.length ? (
              <ol className="relative grid gap-3 border-s ps-4">
                {a.history.map((h) => (
                  <li key={h.id} className="relative text-sm">
                    <span aria-hidden className={cn("absolute -start-[21px] top-1.5 size-2.5 rounded-full", h.kind === "runway_low" ? "bg-warning" : "bg-danger")} />
                    <p className="font-medium">{t(`finance.alerts.kinds.${h.kind}`)}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(h.sentAt, locale, tz)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">{t("finance.alerts.historyEmpty")}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <section aria-label={t("finance.alerts.activeTitle")} className="grid content-start gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl">{t("finance.alerts.activeTitle")}</h2>
          <span className="text-sm text-muted-foreground">{t("finance.alerts.count", { count: a.count })}</span>
        </div>
        {!a.count ? (
          <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center">
            <CheckCircle2 aria-hidden className="size-8 text-success" />
            <p className="font-medium">{t("finance.alerts.allClearTitle")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("finance.alerts.allClearText")}</p>
          </div>
        ) : null}
        <div className="stagger grid gap-3">
          {a.runway.level ? (
            <AlertCard level={a.runway.level === "critical" ? "critical" : "warning"} icon={<TrendingDown />} title={t(`finance.alerts.kinds.${a.runway.level === "critical" ? "runway_critical" : "runway_low"}`)} action={{ href: f("/cashflow"), label: t("finance.alerts.planCash") }}>
              <p>{t("finance.alerts.runwayBody", { months: a.runway.months ?? 0, cash: money(a.runway.cash), burn: money(a.runway.netBurn) })}</p>
              <p>{t("finance.alerts.runwayTodo")}</p>
            </AlertCard>
          ) : null}
          {a.negative ? (
            <AlertCard level="critical" icon={<AlertTriangle />} title={t("finance.alerts.kinds.cash_negative_forecast")} action={{ href: f("/cashflow"), label: t("finance.alerts.seeForecast") }}>
              <p>{t("finance.alerts.negativeBody", { month: monthLabel(a.negative.month), amount: money(a.negative.balance) })}</p>
              <p className="text-xs">{t("finance.alerts.projectedLabel")}</p>
            </AlertCard>
          ) : null}
          {a.invoices.length ? (
            <AlertCard level={a.invoices.some((i) => i.daysLate > 30) ? "critical" : "warning"} icon={<FileWarning />} title={t("finance.alerts.overdueInvoices", { count: a.invoices.length, amount: money(a.invoicesTotal) })} action={{ href: f("/receivables"), label: t("finance.alerts.chase") }}>
              <ul className="grid divide-y rounded-md border">
                {a.invoices.slice(0, 6).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <Link href={f(`/invoices/${i.id}`)} className="font-medium text-foreground hover:underline">
                      {i.number}
                    </Link>
                    <span className="min-w-0 flex-1 truncate">{i.account.name}</span>
                    <span className="text-xs">{t("finance.alerts.daysLate", { count: i.daysLate })}</span>
                    <span className="font-medium text-foreground tabular-nums">{money(i.balanceMinor, i.currency)}</span>
                  </li>
                ))}
              </ul>
            </AlertCard>
          ) : null}
          {a.bills.length ? (
            <AlertCard level="warning" icon={<CalendarClock />} title={t("finance.alerts.overdueBills", { count: a.bills.length, amount: money(a.billsTotal) })} action={{ href: f("/payables"), label: t("finance.alerts.payBills") }}>
              <ul className="grid divide-y rounded-md border">
                {a.bills.slice(0, 6).map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <Link href={f(`/bills/${b.id}`)} className="font-medium text-foreground hover:underline">
                      {b.vendor.name}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {b.number} · {day(b.dueDate)}
                    </span>
                    <span className="font-medium text-foreground tabular-nums">{money(b.balanceMinor, b.currency)}</span>
                  </li>
                ))}
              </ul>
            </AlertCard>
          ) : null}
          {a.overBudget.map((b) => (
            <AlertCard key={b.id} level={b.usedPct >= 100 ? "critical" : "warning"} icon={<PiggyBank />} title={t(b.usedPct >= 100 ? "finance.alerts.budgetOver" : "finance.alerts.budgetNear", { name: b.name })} action={{ href: b.departmentId ? f(`/budgets/${b.departmentId}`) : f("/budgets"), label: t("finance.alerts.reviewBudget") }}>
              <p>{t("finance.alerts.budgetBody", { actual: money(b.actualMinor), budget: money(b.amountMinor), pct: b.usedPct })}</p>
              <UsageBar pct={b.usedPct} />
            </AlertCard>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("finance.alerts.howSent")}</p>
      </section>
    </div>,
  );
}
