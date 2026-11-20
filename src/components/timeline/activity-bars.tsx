/** Daily activity over the last two weeks as small bars (real counts; today highlighted). Accessible as a table. */
export function ActivityBars({ data, locale, label }: { data: { day: string; count: number }[]; locale: string; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <figure className="grid gap-1">
      <div className="flex h-16 items-end gap-1" aria-hidden>
        {data.map((d, i) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${fmt.format(new Date(`${d.day}T12:00:00Z`))}: ${d.count}`}>
            <div
              className={i === data.length - 1 ? "w-full rounded-t-sm bg-brand-gradient" : "w-full rounded-t-sm bg-primary/30 transition-colors group-hover:bg-primary/60"}
              style={{ height: `${Math.max(4, (d.count / max) * 100)}%`, animation: "fade-up .5s both", animationDelay: `${i * 25}ms` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground" aria-hidden>
        <span>{fmt.format(new Date(`${data[0]?.day}T12:00:00Z`))}</span>
        <span>{fmt.format(new Date(`${data[data.length - 1]?.day}T12:00:00Z`))}</span>
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <th scope="row">{d.day}</th>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
