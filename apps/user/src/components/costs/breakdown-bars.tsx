/**
 * Horizontal share bars for one cost breakdown (server component). Single series: one hue, text in text tokens,
 * the formatted amount always printed next to the bar so the value never depends on colour.
 */
export function BreakdownBars({ title, rows, empty }: { title: string; rows: { key: string; label: string; amount: string; micros: string; meta?: string }[]; empty: string }) {
  const max = rows.reduce((m, r) => (BigInt(r.micros) > m ? BigInt(r.micros) : m), 0n);
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length ? (
        <ul className="grid gap-2">
          {rows.map((r) => {
            const pct = max > 0n ? Number((BigInt(r.micros) * 1000n) / max) / 10 : 0;
            return (
              <li key={r.key} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-foreground" title={r.label}>
                    {r.label}
                  </span>
                  <span className="shrink-0 tabular text-muted-foreground">
                    {r.amount}
                    {r.meta ? ` · ${r.meta}` : ""}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-primary/80" style={{ width: `${Math.max(pct, 1.5)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}
