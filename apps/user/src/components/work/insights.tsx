import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";

/**
 * Workload heatmap: rows = people, columns = "late" + the next six weeks; cell = open tasks due then (real counts).
 * Darker = busier; late work is red. Each row links to that person's open tasks.
 */
export function WorkloadHeatmap({ t, locale, data }: { t: Translate; locale: string; data: { weeks: Date[]; rows: { userId: string; name: string; cells: number[] }[] } }) {
  if (!data.rows.length) return <p className="p-4 text-sm text-muted-foreground">{t("work.heatmap.empty")}</p>;
  const max = Math.max(1, ...data.rows.flatMap((r) => r.cells.slice(1)));
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="overflow-x-auto p-3">
      <table className="w-full min-w-[34rem] border-separate border-spacing-1 text-xs" aria-label={t("work.heatmap.title")}>
        <thead>
          <tr>
            <th className="text-start font-medium text-muted-foreground">{t("work.workload.person")}</th>
            <th className="font-medium text-danger">{t("work.heatmap.late")}</th>
            {data.weeks.map((w) => (
              <th key={w.toISOString()} className="font-medium text-muted-foreground">
                {fmt.format(w)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="stagger">
          {data.rows.map((r) => (
            <tr key={r.userId} className="reveal">
              <td className="max-w-40 truncate pe-2">
                <Link href={`/${locale}/projects/tasks?assignee=${r.userId}&open=1`} className="hover:underline">
                  {r.name}
                </Link>
              </td>
              {r.cells.map((n, i) => {
                const ratio = i === 0 ? 0 : n / max;
                return (
                  <td
                    key={i}
                    title={t("work.heatmap.cell", { count: n })}
                    className={cn("h-8 min-w-10 rounded-md text-center tabular-nums transition-transform hover:scale-105", i === 0 ? (n ? "bg-danger/15 font-semibold text-danger" : "bg-muted/40 text-muted-foreground") : n ? "" : "bg-muted/40 text-muted-foreground")}
                    style={i > 0 && n ? { background: `color-mix(in oklch, var(--primary) ${Math.round(15 + ratio * 70)}%, var(--surface))`, color: ratio > 0.55 ? "white" : undefined } : undefined}
                  >
                    {n || "·"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Delay badge from real overdue data: "3 late · up to 5 days". */
export function DelayBadge({ t, delay }: { t: Translate; delay?: { late: number; maxDays: number } }) {
  if (!delay?.late) return <Badge tone="success">{t("work.delay.onTime")}</Badge>;
  return (
    <Badge tone={delay.maxDays > 7 ? "danger" : "warning"} pulse={delay.maxDays > 7}>
      {t("work.delay.summary", { count: delay.late, days: delay.maxDays })}
    </Badge>
  );
}
