/**
 * Single-series daily bar chart (one measure per chart — never dual axis). Columns are full-height hover targets with a
 * native tooltip; a table view is available for screen readers and exact values. Bars use the primary color.
 */
export function DailyBars({
  title,
  points,
  format,
  tableLabel,
  dayLabel,
}: {
  title: string;
  points: { day: string; label: string; value: number }[];
  format: (n: number) => string;
  tableLabel: string;
  dayLabel: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((n, p) => n + p.value, 0);
  return (
    <figure className="grid gap-2">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-lg font-semibold tabular">{format(total)}</span>
      </figcaption>
      <div className="relative h-28 border-b border-border" aria-hidden>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/60" />
        <div className="flex h-full items-end gap-[2px]">
          {points.map((p) => (
            <div key={p.day} className="group flex h-full min-w-0 flex-1 items-end" title={`${p.label}: ${format(p.value)}`}>
              <div
                className="w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary"
                style={{
                  height: p.value ? `${Math.max(2, (p.value / max) * 100)}%` : 0,
                }}
              />
            </div>
          ))}
        </div>
        <span className="absolute -top-1 end-0 -translate-y-full text-[10px] text-muted-foreground">{format(max)}</span>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground" aria-hidden>
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">{tableLabel}</summary>
        <table className="mt-1 w-full text-start">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-start font-medium">{dayLabel}</th>
              <th className="text-end font-medium">{title}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <td>{p.label}</td>
                <td className="text-end tabular">{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
