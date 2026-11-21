export interface NetNode {
  id: string;
  title: string;
  status: string;
  who: string;
}

const COLOR: Record<string, string> = {
  QUEUED: "var(--muted-foreground)",
  RUNNING: "var(--info)",
  COMPLETED: "var(--success)",
  FAILED: "var(--danger)",
  CANCELLED: "var(--muted-foreground)",
};

const clip = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join("")}…` : s);

/**
 * Who handed work to whom, drawn from real tasks: the task that delegated this one (above), this task (centre) and
 * the tasks it delegated (below). Nodes are links; colours follow status. Accessible list underneath.
 */
export function DelegationNetwork({ parent, self, kids: children, locale, label, statusLabel }: { parent: NetNode | null; self: NetNode; kids: NetNode[]; locale: string; label: string; statusLabel: (s: string) => string }) {
  const W = 560;
  const rowH = 86;
  const top = parent ? 44 : 0;
  const midY = top + (parent ? rowH : 44);
  const kidsY = midY + rowH;
  const H = (children.length ? kidsY : midY) + 44;
  const cx = W / 2;
  const kids = children.slice(0, 6);
  const kidX = (i: number) => (kids.length === 1 ? cx : 70 + (i * (W - 140)) / (kids.length - 1));
  const node = (n: NetNode, x: number, y: number, main = false) => (
    <a key={n.id} href={`/${locale}/tasks/${n.id}`} aria-label={`${n.title} — ${statusLabel(n.status)}`}>
      <g className="cursor-pointer">
        <circle cx={x} cy={y} r={main ? 15 : 11} fill="var(--surface)" stroke={COLOR[n.status] ?? "var(--border)"} strokeWidth={main ? 3 : 2} />
        {n.status === "RUNNING" ? (
          <circle cx={x} cy={y} r={main ? 15 : 11} fill="none" stroke="var(--info)" strokeOpacity="0.5" className="motion-safe:animate-ping" style={{ transformOrigin: `${x}px ${y}px` }} />
        ) : null}
        <circle cx={x} cy={y} r={main ? 5 : 4} fill={COLOR[n.status] ?? "var(--border)"} />
        <text x={x} y={y + (main ? 30 : 25)} textAnchor="middle" className="fill-foreground" fontSize={main ? 12 : 10.5} fontWeight={main ? 600 : 500}>
          {clip(n.title, main ? 40 : 22)}
        </text>
        <text x={x} y={y + (main ? 44 : 37)} textAnchor="middle" className="fill-muted-foreground" fontSize={9.5}>
          {clip(n.who, 26)}
        </text>
      </g>
    </a>
  );
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {parent ? <line x1={cx} y1={top} x2={cx} y2={midY} stroke="var(--border-strong, var(--border))" strokeWidth={1.5} strokeDasharray="4 3" /> : null}
        {kids.map((k, i) => (
          <path key={k.id} d={`M${cx},${midY} C${cx},${(midY + kidsY) / 2} ${kidX(i)},${(midY + kidsY) / 2} ${kidX(i)},${kidsY}`} fill="none" stroke={COLOR[k.status] ?? "var(--border)"} strokeOpacity={0.55} strokeWidth={1.5} />
        ))}
        {parent ? node(parent, cx, top) : null}
        {node(self, cx, midY, true)}
        {kids.map((k, i) => node(k, kidX(i), kidsY))}
      </svg>
      <figcaption className="sr-only">
        <ul>
          {[parent, self, ...children].filter((n): n is NetNode => !!n).map((n) => (
            <li key={n.id}>{`${n.title} (${n.who}) — ${statusLabel(n.status)}`}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
