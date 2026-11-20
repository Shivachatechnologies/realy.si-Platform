import Link from "next/link";
import type { Translate } from "@/i18n/translate";
import { formatDate, formatMoney } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

/** Server-safe strategy graphics drawn from real plan records (no client code, no invented values). */

const shade = (i: number) => `color-mix(in oklch, var(--primary) ${100 - ((i * 17) % 75)}%, var(--surface))`;

/** Budget split per channel as a donut with a legend; the unallocated rest is drawn as a muted arc. */
export function BudgetDonut({ channels, totalMinor, currency, locale, t }: { channels: { channel: string; budgetMinor: string; role: string }[]; totalMinor: bigint; currency: string; locale: string; t: Translate }) {
  const values = channels.map((c) => Number(c.budgetMinor));
  const allocated = values.reduce((s, v) => s + v, 0);
  const total = Math.max(Number(totalMinor), allocated);
  const r = 52;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const money = (m: number | bigint) => formatMoney({ amountMinor: BigInt(Math.round(Number(m))), currency }, locale);
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <svg viewBox="0 0 140 140" className="mx-auto size-40" role="img" aria-label={t("marketing.strategy.allocation", { allocated: money(allocated), total: money(totalMinor) })}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--muted)" strokeWidth="16" />
        {total > 0
          ? values.map((v, i) => {
              const len = (v / total) * C;
              const el = <circle key={i} cx="70" cy="70" r={r} fill="none" stroke={shade(i)} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" className="draw-in" />;
              offset += len;
              return el;
            })
          : null}
        <text x="70" y="66" textAnchor="middle" className="fill-foreground text-[11px]">
          {total > 0 ? `${Math.round((allocated / total) * 100)}%` : "—"}
        </text>
        <text x="70" y="82" textAnchor="middle" className="fill-muted-foreground text-[8px]">
          {t("marketing.strategy.allocatedShort")}
        </text>
      </svg>
      <ul className="grid gap-1.5 text-sm">
        {channels.map((c, i) => (
          <li key={c.channel} className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: shade(i) }} />
            <span className="min-w-0 flex-1 truncate">
              {t(`marketing.channels.${c.channel}`)} <span className="text-xs text-muted-foreground">· {t(`marketing.strategy.role.${c.role}`)}</span>
            </span>
            <span className="tabular-nums">{money(Number(c.budgetMinor))}</span>
          </li>
        ))}
        <li className="mt-1 flex items-center justify-between border-t pt-1.5 text-xs text-muted-foreground">
          <span>{t("marketing.strategy.totalBudget")}</span>
          <span className="tabular-nums">{money(totalMinor)}</span>
        </li>
      </ul>
    </div>
  );
}

/** Plans on a shared time axis: one bar per plan from start to end, with a "today" marker. */
export function PlanTimeline({ plans, locale, tz, t, now }: { plans: { id: string; name: string; status: string; periodStart: Date; periodEnd: Date }[]; locale: string; tz: string; t: Translate; now: number }) {
  if (!plans.length) return null;
  const min = Math.min(...plans.map((p) => p.periodStart.getTime()));
  const max = Math.max(...plans.map((p) => p.periodEnd.getTime() + 86_400_000));
  const span = Math.max(1, max - min);
  const todayPct = now >= min && now <= max ? ((now - min) / span) * 100 : null;
  return (
    <div className="relative grid gap-2">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{formatDate(new Date(min), locale, tz, { month: "short", year: "numeric" })}</span>
        <span>{formatDate(new Date(max - 86_400_000), locale, tz, { month: "short", year: "numeric" })}</span>
      </div>
      <div className="relative grid gap-2">
        {todayPct != null ? (
          <span aria-hidden className="absolute inset-y-0 z-10 w-px bg-primary" style={{ insetInlineStart: `${todayPct}%` }}>
            <span className="absolute -top-4 -translate-x-1/2 text-[10px] text-primary rtl:translate-x-1/2">{t("marketing.strategy.today")}</span>
          </span>
        ) : null}
        {plans.map((p) => {
          const start = ((p.periodStart.getTime() - min) / span) * 100;
          const width = Math.max(2, ((p.periodEnd.getTime() + 86_400_000 - p.periodStart.getTime()) / span) * 100);
          return (
            <Link key={p.id} href={`/${locale}/marketing/strategy/${p.id}`} className="group relative block h-10 rounded-md bg-muted/50">
              <span
                className={cn("absolute inset-y-1 flex items-center gap-2 overflow-hidden rounded-md border px-2 text-xs shadow-elev-1 transition group-hover:shadow-elev-2", p.status === "ACTIVE" || p.status === "APPROVED" ? "border-primary/50 bg-accent" : "bg-surface")}
                style={{ insetInlineStart: `${start}%`, width: `${width}%` }}
              >
                <span className="truncate font-medium">{p.name}</span>
                <span className="hidden shrink-0 sm:inline">
                  <StatusBadge status={p.status} label={t(`marketing.strategy.status.${p.status}`)} />
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
