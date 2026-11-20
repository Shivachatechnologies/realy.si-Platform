import Link from "next/link";
import type { KnowledgeEntity } from "@/server/modules/brain/knowledge";

const KIND_HUE: Record<string, string> = {
  PERSON: "var(--primary)",
  TEAM: "var(--primary-2, var(--primary))",
  PRODUCT: "var(--success)",
  CUSTOMER: "var(--warning)",
  VENDOR: "var(--info, var(--primary))",
  PARTNER: "var(--danger)",
};

/**
 * Relationship view of one company-graph entity (server SVG): the entity in the centre, each stored relation as a
 * labelled spoke to the related entity. Nodes link to their entity pages; a text list mirrors the drawing for
 * screen readers.
 */
export function EntityOrbit({ entity, locale, relationLabel, kindLabel, ariaLabel }: { entity: KnowledgeEntity; locale: string; relationLabel: (r: string) => string; kindLabel: (k: string) => string; ariaLabel: string }) {
  const rels = entity.relations.slice(0, 10);
  const W = 340;
  const H = rels.length ? 240 : 120;
  const cx = W / 2;
  const cy = H / 2;
  const nodes = rels.map((r, i) => {
    const a = (Math.PI * 2 * i) / Math.max(1, rels.length) - Math.PI / 2;
    return { ...r, x: cx + Math.cos(a) * 120, y: cy + Math.sin(a) * 88 };
  });
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        {nodes.map((n, i) => (
          <g key={`e${i}`}>
            <line x1={cx} y1={cy} x2={n.x} y2={n.y} stroke={KIND_HUE[n.kind] ?? "var(--primary)"} strokeOpacity="0.45" strokeDasharray={n.direction === "in" ? "3 3" : undefined} />
            <text x={(cx + n.x) / 2} y={(cy + n.y) / 2 - 3} textAnchor="middle" fontSize="8" fill="var(--muted-foreground)">
              {relationLabel(n.relation)}
            </text>
          </g>
        ))}
        <circle cx={cx} cy={cy} r="26" fill="var(--surface)" stroke={KIND_HUE[entity.kind] ?? "var(--primary)"} strokeWidth="2" />
        <circle cx={cx} cy={cy} r="32" fill="none" stroke={KIND_HUE[entity.kind] ?? "var(--primary)"} strokeOpacity="0.25" className="core-breathe" />
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize="9" fontWeight={700} fill="var(--foreground)">
          {entity.name.slice(0, 14)}
        </text>
        {nodes.map((n, i) => (
          <a key={`n${i}`} href={`/${locale}/graph/${n.id}`}>
            <circle cx={n.x} cy={n.y} r="15" fill="var(--surface)" stroke={KIND_HUE[n.kind] ?? "var(--primary)"} strokeWidth="1.5" />
            <text x={n.x} y={n.y + 26} textAnchor="middle" fontSize="8.5" fill="var(--foreground)">
              {n.name.slice(0, 18)}
            </text>
            <text x={n.x} y={n.y + 3} textAnchor="middle" fontSize="8" fontWeight={700} fill="var(--foreground)">
              {Array.from(n.name)[0]?.toUpperCase()}
            </text>
          </a>
        ))}
      </svg>
      <ul className="sr-only">
        {rels.map((r, i) => (
          <li key={i}>
            <Link href={`/${locale}/graph/${r.id}`}>
              {r.direction === "out" ? `${entity.name} — ${relationLabel(r.relation)} — ${r.name}` : `${r.name} — ${relationLabel(r.relation)} — ${entity.name}`} ({kindLabel(r.kind)})
            </Link>
          </li>
        ))}
      </ul>
    </figure>
  );
}
