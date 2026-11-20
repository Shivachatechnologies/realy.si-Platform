import type { Translate } from "@/i18n/translate";
import { formatNumber } from "@/i18n/format";
import type { NetworkData } from "@/server/modules/workforce/network";

const W = 640;
const C = W / 2;
const polar = (r: number, a: number) => ({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });

/**
 * Interactive company network (inline SVG, real data): the company at the centre, departments on the inner ring,
 * their AI employees around them, key record clusters (customers, deals, projects, tickets…) on the outer ring, and
 * dashed manager lines between AI employees. Every node links to its page; busy employees pulse (reduced-motion safe).
 */
export function CompanyNetwork({ data, t, locale, companyName }: { data: NetworkData; t: Translate; locale: string; companyName: string }) {
  const n = Math.max(1, data.departments.length);
  const pos = new Map<string, { x: number; y: number }>();
  const depts = data.departments.map((d, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const p = polar(130, a);
    const emps = d.employees.map((e, j) => {
      const spread = Math.min(0.9, 0.28 * d.employees.length) / Math.max(1, d.employees.length - 1 || 1);
      const ea = a + (d.employees.length > 1 ? (j - (d.employees.length - 1) / 2) * spread : 0);
      const ep = polar(205, ea);
      pos.set(e.id, ep);
      return { ...e, ...ep };
    });
    const recs = data.records
      .filter((r) => r.department === d.key)
      .map((r, j, all) => {
        const ra = a + (all.length > 1 ? (j - (all.length - 1) / 2) * 0.22 : 0);
        return { ...r, ...polar(282, ra) };
      });
    return { ...d, ...p, emps, recs };
  });
  const label = (k: string) => {
    const v = t(`workforce.departments.${k}`);
    return v === `workforce.departments.${k}` ? k : v;
  };

  return (
    <svg viewBox={`0 0 ${W} ${W}`} role="img" aria-label={t("intelligence.network.aria")} className="h-auto w-full max-w-[640px] select-none">
      <title>{t("intelligence.network.aria")}</title>
      <g className="text-border" stroke="currentColor" strokeWidth="1" fill="none">
        {depts.map((d) => (
          <g key={d.key}>
            <line x1={C} y1={C} x2={d.x} y2={d.y} />
            {d.emps.map((e) => (
              <line key={e.id} x1={d.x} y1={d.y} x2={e.x} y2={e.y} />
            ))}
            {d.recs.map((r) => (
              <line key={r.key} x1={d.x} y1={d.y} x2={r.x} y2={r.y} strokeDasharray="2 3" />
            ))}
          </g>
        ))}
      </g>
      <g className="text-primary" stroke="currentColor" strokeOpacity="0.45" strokeDasharray="4 4" fill="none">
        {data.links.map((l, i) => {
          const a = pos.get(l.from);
          const b = pos.get(l.to);
          return a && b ? <path key={i} d={`M${a.x},${a.y} Q${C},${C} ${b.x},${b.y}`} /> : null;
        })}
      </g>
      <a href={`/${locale}/company`}>
        <circle cx={C} cy={C} r="38" className="fill-primary" />
        <text x={C} y={C + 4} textAnchor="middle" className="fill-primary-foreground text-[12px] font-semibold">
          {companyName.slice(0, 14)}
        </text>
      </a>
      {depts.map((d) => (
        <g key={d.key}>
          <a href={`/${locale}/analytics/departments/${d.key === "engineering" || d.key === "product" ? "projects" : d.key === "executive" || d.key === "research" ? "executive" : d.key}`} className="[&:hover_circle]:opacity-80">
            <title>{label(d.key)}</title>
            <circle cx={d.x} cy={d.y} r="26" className="fill-surface-2 stroke-primary/50" strokeWidth="1.5" />
            <text x={d.x} y={d.y + 3} textAnchor="middle" className="fill-foreground text-[9px] font-medium">
              {label(d.key).slice(0, 12)}
            </text>
          </a>
          {d.emps.map((e) => (
            <a key={e.id} href={`/${locale}/workforce/${e.id}`}>
              <title>{e.name}</title>
              {e.busy ? <circle cx={e.x} cy={e.y} r="20" className="animate-pulse fill-primary/20 motion-reduce:animate-none" /> : null}
              <circle cx={e.x} cy={e.y} r="15" className={e.paused ? "fill-muted stroke-border" : "fill-accent stroke-primary"} strokeWidth="1.5" />
              <text x={e.x} y={e.y + 3.5} textAnchor="middle" className="fill-accent-foreground text-[9px] font-semibold">
                {e.initials}
              </text>
            </a>
          ))}
          {d.recs.map((r) => (
            <a key={r.key} href={`/${locale}${r.href}`}>
              <title>{`${t(`intelligence.network.records.${r.key}`)}: ${r.count}`}</title>
              <rect x={r.x - 30} y={r.y - 13} width="60" height="26" rx="13" className="fill-surface stroke-border" />
              <text x={r.x} y={r.y - 1} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">
                {formatNumber(r.count, locale, { notation: "compact" })}
              </text>
              <text x={r.x} y={r.y + 9} textAnchor="middle" className="fill-muted-foreground text-[7px]">
                {t(`intelligence.network.records.${r.key}`).slice(0, 14)}
              </text>
            </a>
          ))}
        </g>
      ))}
    </svg>
  );
}
