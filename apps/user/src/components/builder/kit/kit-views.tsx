"use client";

import Link from "next/link";
import { ExternalLink, Globe, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Read views of the Founder Kit's structured deliverables: persona cards, the Business Model Canvas, pricing tiers, the
 * positioning hero, name ideas, the sitemap, campaigns, the sales playbook, the launch timeline, the 12-month projection
 * chart and the AI workforce. Every number shown comes from the saved deliverable; nothing is computed beyond sums.
 */

type D = Record<string, unknown>;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function Chips({ items, tone = "neutral" }: { items: string[]; tone?: "neutral" | "accent" | "info" }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((x, i) => (
        <Badge key={i} tone={tone} shape="pill">
          {x}
        </Badge>
      ))}
    </div>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
      <ul className="grid list-disc gap-0.5 ps-4 text-sm">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Personas({ d }: { d: D }) {
  const { t } = useI18n();
  const ps = arr<D>(d.personas);
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        {ps.map((p, i) => (
          <article key={i} className="grid content-start gap-3 rounded-xl border bg-surface-2/40 p-4">
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-gradient font-display text-primary-foreground">
                {str(p.name).slice(0, 1)}
              </span>
              <div className="min-w-0">
                <div className="font-medium">{str(p.name)}</div>
                <div className="truncate text-xs text-muted-foreground">{str(p.role)}</div>
              </div>
            </div>
            <p className="text-sm">{str(p.summary)}</p>
            <Bullets title={t("builder.kit.fields.goals")} items={arr<string>(p.goals)} />
            <Bullets title={t("builder.kit.fields.pains")} items={arr<string>(p.pains)} />
            <Bullets title={t("builder.kit.fields.objections")} items={arr<string>(p.objections)} />
            <Chips items={arr<string>(p.channels)} tone="info" />
          </article>
        ))}
      </div>
      {str(d.icp) ? (
        <div className="rounded-xl border border-primary/30 bg-accent/30 p-4">
          <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("builder.kit.fields.icp")}</div>
          <p className="text-sm whitespace-pre-line">{str(d.icp)}</p>
        </div>
      ) : null}
    </div>
  );
}

const CANVAS: { key: string; area: string }[] = [
  { key: "keyPartners", area: "md:col-start-1 md:row-start-1 md:row-span-2" },
  { key: "keyActivities", area: "md:col-start-2 md:row-start-1" },
  { key: "keyResources", area: "md:col-start-2 md:row-start-2" },
  { key: "valuePropositions", area: "md:col-start-3 md:row-start-1 md:row-span-2" },
  { key: "customerRelationships", area: "md:col-start-4 md:row-start-1" },
  { key: "channels", area: "md:col-start-4 md:row-start-2" },
  { key: "customerSegments", area: "md:col-start-5 md:row-start-1 md:row-span-2" },
  { key: "costStructure", area: "md:col-start-1 md:col-span-2 lg:col-span-3 md:row-start-3" },
  { key: "revenueStreams", area: "md:col-start-3 lg:col-start-4 md:col-span-3 lg:col-span-2 md:row-start-3" },
];

function Canvas({ d }: { d: D }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 md:grid-cols-5">
      {CANVAS.map((c) => (
        <section key={c.key} className={cn("grid content-start gap-1.5 rounded-lg border bg-surface-2/40 p-3", c.area, c.key === "valuePropositions" && "border-primary/40 bg-accent/30")}>
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t(`builder.kit.fields.${c.key}`)}</h4>
          <ul className="grid gap-1 text-sm">
            {arr<string>(d[c.key]).map((x, i) => (
              <li key={i} className="rounded-md bg-surface px-2 py-1 shadow-elev-1">
                {x}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Revenue({ d }: { d: D }) {
  return (
    <ul className="grid gap-2">
      {arr<D>(d.streams).map((s, i) => {
        const share = typeof s.sharePercent === "number" ? s.sharePercent : null;
        return (
          <li key={i} className="grid gap-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{str(s.name)}</span>
              <span className="flex items-center gap-2">
                <Badge tone="info">{str(s.type).replace(/_/g, " ")}</Badge>
                {share !== null ? <span className="text-sm tabular-nums text-muted-foreground">{share}%</span> : null}
              </span>
            </div>
            {share !== null ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${Math.min(100, share)}%` }} />
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground">{str(s.description)}</p>
          </li>
        );
      })}
    </ul>
  );
}

function Pricing({ d }: { d: D }) {
  const { t, locale } = useI18n();
  const cur = str(d.currency) || "USD";
  const fmt = (v: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: cur, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v);
    } catch {
      return `${v} ${cur}`;
    }
  };
  const tiers = arr<D>(d.tiers);
  return (
    <div className="grid gap-3">
      <div className={cn("grid gap-3", tiers.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {tiers.map((x, i) => (
          <article key={i} className={cn("grid content-start gap-3 rounded-xl border p-4", i === Math.min(1, tiers.length - 1) && tiers.length > 1 && "border-primary/50 shadow-glow")}>
            <div className="font-display text-lg">{str(x.name)}</div>
            <div className="flex items-baseline gap-1">
              <span className="font-display text-3xl tabular-nums">{fmt(Number(x.price) || 0)}</span>
              <span className="text-sm text-muted-foreground">{t(`builder.kit.intervals.${str(x.interval) || "month"}`)}</span>
            </div>
            <p className="text-sm text-muted-foreground">{str(x.audience)}</p>
            <ul className="grid gap-1 text-sm">
              {arr<string>(x.features).map((f, j) => (
                <li key={j} className="flex gap-2">
                  <span aria-hidden className="text-primary">
                    ✓
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      {str(d.rationale) ? <p className="text-sm text-muted-foreground">{str(d.rationale)}</p> : null}
    </div>
  );
}

const HEX = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i;

function Positioning({ d }: { d: D }) {
  const { t } = useI18n();
  const visual = (d.visual ?? {}) as D;
  return (
    <div className="grid gap-4">
      <blockquote className="rounded-xl border-s-4 border-primary bg-accent/30 p-4 font-display text-lg leading-snug">{str(d.statement)}</blockquote>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["category", "targetCustomer", "keyBenefit"] as const).map((k) => (
          <div key={k} className="rounded-lg border p-3">
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(`builder.kit.fields.${k}`)}</div>
            <div className="mt-1 text-sm">{str(d[k])}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Bullets title={t("builder.kit.fields.differentiators")} items={arr<string>(d.differentiators)} />
        <div className="grid content-start gap-2">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("builder.kit.fields.taglines")}</div>
          {arr<string>(d.taglines).map((x, i) => (
            <div key={i} className="rounded-md bg-surface-2 px-3 py-1.5 text-sm italic">
              “{x}”
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3 text-sm">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("builder.kit.fields.mission")}</div>
          <p className="mt-1">{str(d.mission)}</p>
          <div className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("builder.kit.fields.vision")}</div>
          <p className="mt-1">{str(d.vision)}</p>
        </div>
        <div className="grid content-start gap-2 rounded-lg border p-3">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("builder.kit.fields.values")}</div>
          <Chips items={arr<string>(d.values)} tone="accent" />
          {arr<string>(visual.colors).length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {arr<string>(visual.colors).map((c, i) => {
                const hex = HEX.exec(c)?.[0];
                return (
                  <span key={i} className="flex items-center gap-1.5 text-xs">
                    <span aria-hidden className="size-5 rounded-full border shadow-elev-1" style={hex ? { background: hex } : undefined} />
                    {c}
                  </span>
                );
              })}
            </div>
          ) : null}
          {str(visual.style) ? <p className="text-xs text-muted-foreground">{str(visual.style)}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function NameIdeas({ d, current, onUse, busy }: { d: D; current: string; onUse?: (name: string) => void; busy?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">{t("builder.kit.names.disclaimer")}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {arr<D>(d.names).map((n, i) => {
          const domain = str(n.domain);
          const chosen = str(n.name) === current;
          return (
            <li key={i} className={cn("grid content-start gap-2 rounded-xl border p-3", chosen && "border-success/50 bg-success/5")}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg">{str(n.name)}</span>
                {chosen ? <Badge tone="success">{t("builder.kit.names.current")}</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">{str(n.rationale)}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {domain ? (
                  <>
                    <span className="flex items-center gap-1 font-mono">
                      <Globe className="size-3.5" aria-hidden />
                      {domain}
                    </span>
                    <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`} target="_blank" rel="noreferrer noopener">
                      {t("builder.kit.names.checkManually")}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </>
                ) : null}
                {onUse && !chosen ? (
                  <button type="button" disabled={busy} className="ms-auto rounded-md border px-2 py-1 font-medium hover:bg-muted disabled:opacity-50" onClick={() => window.confirm(t("builder.kit.names.confirm", { name: str(n.name) })) && onUse(str(n.name))}>
                    {t("builder.kit.names.use")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Website({ d }: { d: D }) {
  const pages = arr<D>(d.pages);
  return (
    <div className="grid gap-4">
      <nav aria-label="Sitemap" className="flex flex-wrap gap-2">
        {pages.map((p, i) => (
          <a key={i} href={`#page-${i}`} className="rounded-md border bg-surface-2 px-2 py-1 font-mono text-xs hover:border-primary">
            {str(p.slug)}
          </a>
        ))}
      </nav>
      <div className="grid gap-3">
        {pages.map((p, i) => (
          <article key={i} id={`page-${i}`} className="grid gap-2 rounded-xl border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="font-display text-base">{str(p.title)}</h4>
              <span className="font-mono text-xs text-muted-foreground">{str(p.slug)}</span>
            </div>
            <p className="text-sm text-muted-foreground">{str(p.purpose)}</p>
            <ol className="grid gap-2 border-s ps-3">
              {arr<D>(p.sections).map((s, j) => (
                <li key={j} className="grid gap-0.5">
                  <span className="text-sm font-medium">{str(s.heading)}</span>
                  <span className="text-sm text-muted-foreground">{str(s.content)}</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </div>
  );
}

function Campaigns({ d }: { d: D }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {arr<D>(d.campaigns).map((c, i) => (
        <article key={i} className="grid content-start gap-2 rounded-xl border p-4">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-medium">{str(c.name)}</h4>
            <Badge tone="neutral">{t("builder.kit.days", { count: Number(c.durationDays) || 0 })}</Badge>
          </div>
          <p className="text-sm">{str(c.objective)}</p>
          {str(c.description) ? <p className="text-sm text-muted-foreground">{str(c.description)}</p> : null}
          <Chips items={arr<string>(c.channels).map((x) => x.replace(/_/g, " "))} tone="info" />
          {typeof c.budget === "number" ? <div className="text-xs text-muted-foreground tabular-nums">{t("builder.kit.fields.budget")}: {c.budget}</div> : null}
        </article>
      ))}
    </div>
  );
}

function Sales({ d }: { d: D }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-primary/30 bg-accent/30 p-4">
        <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("builder.kit.fields.icp")}</div>
        <p className="text-sm whitespace-pre-line">{str(d.icp)}</p>
      </div>
      {arr<string>(d.stages).length ? (
        <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label={t("builder.kit.fields.stages")}>
          {arr<string>(d.stages).map((s, i, a) => (
            <li key={i} className="flex items-center gap-1">
              <span className="rounded-full border bg-surface-2 px-2.5 py-1 font-medium">{s}</span>
              {i < a.length - 1 ? <span aria-hidden className="text-muted-foreground rtl:rotate-180">→</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <ol className="grid gap-2">
        {arr<D>(d.playbook).map((p, i) => (
          <li key={i} className="flex gap-3 rounded-lg border p-3">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums">
              {i + 1}
            </span>
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">{str(p.title)}</span>
              <span className="text-sm text-muted-foreground">{str(p.description)}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", URGENT: "danger" };

function Roadmap({ d }: { d: D }) {
  const { t } = useI18n();
  const ms = [...arr<D>(d.milestones)].sort((a, b) => Number(a.dueInDays) - Number(b.dueInDays));
  return (
    <div className="grid gap-4">
      <ol className="relative grid gap-4 border-s-2 border-primary/30 ps-5">
        {ms.map((m, i) => (
          <li key={i} className="relative grid gap-2">
            <span aria-hidden className="absolute -start-[1.72rem] top-1 size-3 rounded-full bg-brand-gradient ring-4 ring-background" />
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{str(m.title)}</span>
              <Badge tone="neutral">{t("builder.kit.dayN", { day: Number(m.dueInDays) || 0 })}</Badge>
            </div>
            {str(m.description) ? <p className="text-sm text-muted-foreground">{str(m.description)}</p> : null}
            <ul className="grid gap-1">
              {arr<D>(m.tasks).map((x, j) => (
                <li key={j} className="flex items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 flex-1">{str(x.title)}</span>
                  <Badge tone={PRIORITY_TONE[str(x.priority)] ?? "neutral"}>{str(x.priority).toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {arr<D>(d.objectives).length ? (
        <div className="grid gap-2">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("builder.kit.fields.objectives")}</div>
          {arr<D>(d.objectives).map((o, i) => (
            <div key={i} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-3 text-sm">
              <span className="font-medium">{str(o.title)}</span>
              <span className="text-xs text-muted-foreground">{t("builder.kit.dayN", { day: Number(o.targetInDays) || 0 })}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function forecastRows(d: D) {
  const months = [...arr<D>(d.months)].sort((a, b) => Number(a.month) - Number(b.month));
  let cash = Number(d.startingCash) || 0;
  return months.map((m) => {
    const revenue = Number(m.revenue) || 0;
    const costs = Number(m.costs) || 0;
    cash += revenue - costs;
    return { month: Number(m.month), revenue, costs, net: revenue - costs, cash, note: str(m.note) };
  });
}

function Forecast({ d }: { d: D }) {
  const { t, locale } = useI18n();
  const cur = str(d.currency) || "USD";
  const fmt = (v: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v);
    } catch {
      return `${Math.round(v)} ${cur}`;
    }
  };
  const rows = forecastRows(d);
  const max = Math.max(1, ...rows.flatMap((r) => [r.revenue, r.costs]));
  const cashMin = Math.min(0, ...rows.map((r) => r.cash));
  const cashMax = Math.max(1, ...rows.map((r) => r.cash));
  const W = 600;
  const H = 200;
  const bw = W / Math.max(1, rows.length);
  const cy = (v: number) => H - ((v - cashMin) / (cashMax - cashMin || 1)) * (H - 10) - 5;
  const breakEven = rows.find((r) => r.net >= 0 && r.revenue > 0);
  const totals = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, costs: a.costs + r.costs }), { revenue: 0, costs: 0 });
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          [t("builder.kit.forecast.revenue12"), fmt(totals.revenue)],
          [t("builder.kit.forecast.costs12"), fmt(totals.costs)],
          [t("builder.kit.forecast.endCash"), fmt(rows.at(-1)?.cash ?? 0)],
          [t("builder.kit.forecast.breakEven"), breakEven ? t("builder.kit.forecast.monthN", { month: breakEven.month }) : t("builder.kit.forecast.notInYear")],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="mt-0.5 font-display text-lg tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <figure className="grid gap-2 rounded-xl border p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" role="img" aria-label={t("builder.kit.forecast.chart")} preserveAspectRatio="none">
          {rows.map((r, i) => (
            <g key={r.month}>
              <rect x={i * bw + bw * 0.12} y={H - (r.revenue / max) * (H - 10)} width={bw * 0.36} height={(r.revenue / max) * (H - 10)} rx={3} className="fill-[var(--success)] opacity-80" />
              <rect x={i * bw + bw * 0.52} y={H - (r.costs / max) * (H - 10)} width={bw * 0.36} height={(r.costs / max) * (H - 10)} rx={3} className="fill-[var(--danger)] opacity-60" />
            </g>
          ))}
          <polyline fill="none" strokeWidth={2.5} vectorEffect="non-scaling-stroke" className="stroke-[var(--primary)]" points={rows.map((r, i) => `${i * bw + bw / 2},${cy(r.cash)}`).join(" ")} />
          {cashMin < 0 ? <line x1={0} x2={W} y1={cy(0)} y2={cy(0)} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" className="stroke-[var(--muted-foreground)]" /> : null}
        </svg>
        <figcaption className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-2.5 rounded-sm bg-[var(--success)]" />
            {t("builder.kit.fields.revenue")}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-2.5 rounded-sm bg-[var(--danger)] opacity-60" />
            {t("builder.kit.fields.costs")}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-0.5 w-4 bg-[var(--primary)]" />
            {t("builder.kit.forecast.cash")}
          </span>
        </figcaption>
      </figure>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-surface-2 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("builder.kit.fields.month")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("builder.kit.fields.revenue")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("builder.kit.fields.costs")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("builder.kit.forecast.net")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("builder.kit.forecast.cash")}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.month} className="border-t" title={r.note || undefined}>
                <td className="px-3 py-1.5">{t("builder.kit.forecast.monthN", { month: r.month })}</td>
                <td className="px-3 py-1.5 text-end">{fmt(r.revenue)}</td>
                <td className="px-3 py-1.5 text-end">{fmt(r.costs)}</td>
                <td className={cn("px-3 py-1.5 text-end", r.net < 0 ? "text-danger" : "text-success")}>{fmt(r.net)}</td>
                <td className={cn("px-3 py-1.5 text-end", r.cash < 0 && "text-danger")}>{fmt(r.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {arr<D>(d.assumptions).map((a, i) => (
          <div key={i} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">{str(a.label)}</span>
            <span className="font-medium">{str(a.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const LEVEL_TONE: Record<string, "brand" | "info" | "neutral"> = { EXECUTIVE: "brand", MANAGER: "info", SPECIALIST: "neutral" };

function Workforce({ d }: { d: D }) {
  const { t } = useI18n();
  const team = arr<D>(d.team);
  const children = (k: string | null) => team.filter((m) => (str(m.reportsTo) || null) === k);
  const Node = ({ m, depth }: { m: D; depth: number }) => (
    <li className="grid gap-2">
      <div className="flex items-start gap-3 rounded-lg border bg-surface p-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
          <Sparkles className="size-4" />
        </span>
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{str(m.name)}</span>
            <Badge tone={LEVEL_TONE[str(m.level)] ?? "neutral"}>{str(m.title) || t(`profiles.${str(m.profile)}.name`)}</Badge>
          </div>
          <ul className="grid list-disc gap-0.5 ps-4 text-xs text-muted-foreground">
            {arr<string>(m.responsibilities)
              .slice(0, 4)
              .map((r, i) => (
                <li key={i}>{r}</li>
              ))}
          </ul>
        </div>
      </div>
      {children(str(m.key)).length && depth < 4 ? (
        <ul className="grid gap-2 border-s ps-4">
          {children(str(m.key)).map((c) => (
            <Node key={str(c.key)} m={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
  const roots = team.filter((m) => !str(m.reportsTo) || !team.some((x) => str(x.key) === str(m.reportsTo)));
  return (
    <ul className="grid gap-2">
      {roots.map((m) => (
        <Node key={str(m.key)} m={m} depth={0} />
      ))}
    </ul>
  );
}

export function Sources({ d }: { d: D }) {
  const { t } = useI18n();
  const sources = arr<{ title: string; url: string; snippet?: string }>(d.sources);
  if (!sources.length) return null;
  return (
    <details className="rounded-lg border p-3" open>
      <summary className="cursor-pointer text-sm font-medium">{t("builder.kit.sources", { count: sources.length })}</summary>
      <ol className="mt-2 grid list-decimal gap-1.5 ps-5 text-sm">
        {sources.map((s, i) => (
          <li key={i}>
            <a className="text-primary hover:underline" href={s.url} target="_blank" rel="noreferrer noopener">
              {s.title}
            </a>
            <span className="ms-1 text-xs text-muted-foreground">{(() => { try { return new URL(s.url).hostname; } catch { return ""; } })()}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** The structured view for a deliverable, or null when it has none (the Markdown is shown instead). */
export function StructuredView({ itemKey, data }: { itemKey: string; data: D }) {
  switch (itemKey) {
    case "customer_personas":
      return <Personas d={data} />;
    case "business_model_canvas":
      return <Canvas d={data} />;
    case "revenue_model":
      return <Revenue d={data} />;
    case "pricing":
      return <Pricing d={data} />;
    case "brand_positioning":
      return <Positioning d={data} />;
    case "website_structure":
      return <Website d={data} />;
    case "marketing_strategy":
      return <Campaigns d={data} />;
    case "sales_strategy":
      return <Sales d={data} />;
    case "launch_roadmap":
      return <Roadmap d={data} />;
    case "financial_forecast":
      return <Forecast d={data} />;
    case "ai_workforce":
      return <Workforce d={data} />;
    default:
      return null;
  }
}

export function RecordLinks({ records }: { records: { kind: string; id: string; label: string; href: string | null }[] }) {
  const { t, locale } = useI18n();
  if (!records.length) return null;
  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("builder.kit.created")}</div>
      <ul className="flex flex-wrap gap-1.5">
        {records.map((r, i) => (
          <li key={`${r.id}-${i}`}>
            {r.href ? (
              <Link href={`/${locale}${r.href}`} className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/5 px-2.5 py-1 text-xs hover:bg-success/10">
                <span className="text-muted-foreground">{t(`builder.kit.recordKinds.${r.kind}`)}</span>
                <span className="font-medium">{r.label}</span>
              </Link>
            ) : (
              <span className="rounded-full border px-2.5 py-1 text-xs">{r.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
