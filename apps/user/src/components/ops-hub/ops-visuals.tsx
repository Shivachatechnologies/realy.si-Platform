import Link from "next/link";
import type { ReactNode } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Circle, Gauge, Info, Siren } from "lucide-react";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import { PageHeader } from "@/components/ui/page-header";
import { OpsTabs } from "@/components/work/area-tabs";
import { formatRelativeTime } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { cn } from "@/lib/utils";

/** The header strip of every operations page (what / why / what you can do / the one next step). */
export function OpsIntro({ t, page, next }: { t: Translate; page: "overview" | "processes" | "checklists" | "assets" | "incidents" | "vendors"; next?: { label: string; href: string } | ReactNode }) {
  return <PageIntro labels={introLabels(t)} what={t(`opsHub.intro.${page}.what`)} why={t(`opsHub.intro.${page}.why`)} can={t(`opsHub.intro.${page}.can`)} next={next} />;
}

const SEV: Record<string, { icon: ReactNode; stripe: string; chip: string }> = {
  SEV1: { icon: <Siren />, stripe: "bg-danger", chip: "bg-danger text-danger-foreground" },
  SEV2: { icon: <AlertOctagon />, stripe: "bg-danger/70", chip: "bg-danger/15 text-danger" },
  SEV3: { icon: <AlertTriangle />, stripe: "bg-warning", chip: "bg-warning/15 text-warning" },
  SEV4: { icon: <Info />, stripe: "bg-muted-foreground/50", chip: "bg-muted text-muted-foreground" },
};
const COLUMNS = ["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED"] as const;

export interface BoardIncident {
  id: string;
  title: string;
  severity: string;
  status: string;
  occurredAt: Date;
  ownerName: string | null;
}

/** Incident severity board: one column per stage (open → investigating → mitigated → resolved), worst first. */
export function IncidentBoard({ incidents, t, locale }: { incidents: BoardIncident[]; t: Translate; locale: string }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2 text-[11px]" aria-label={t("opsHub.incidents.legend")}>
        {Object.entries(SEV).map(([k, s]) => (
          <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 [&_svg]:size-3", s.chip)}>
            {s.icon}
            {t(`work.ops.severities.${k}`)} — {t(`opsHub.severityExplain.${k}`)}
          </span>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = incidents.filter((i) => i.status === col);
          return (
            <section key={col} aria-label={t(`work.ops.incidentStatus.${col}`)} className="grid content-start gap-2 rounded-lg border bg-surface-2/50 p-2">
              <header className="flex items-center gap-2 px-1 pt-1 text-sm font-semibold">
                {col === "RESOLVED" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className={cn("size-4", col === "OPEN" ? "text-danger" : col === "INVESTIGATING" ? "text-warning" : "text-info")} aria-hidden />}
                {t(`work.ops.incidentStatus.${col}`)}
                <span className="ms-auto rounded-full bg-surface px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{items.length}</span>
              </header>
              {items.length ? (
                items.map((i) => {
                  const s = SEV[i.severity] ?? SEV.SEV4!;
                  return (
                    <Link key={i.id} href={`/${locale}/operations/incidents/${i.id}`} className="hover-lift relative grid gap-1 overflow-hidden rounded-md border bg-surface p-2.5 ps-3.5 text-sm shadow-elev-1">
                      <span aria-hidden className={cn("absolute inset-y-0 start-0 w-1", s.stripe, i.severity === "SEV1" && col !== "RESOLVED" && "animate-pulse")} />
                      <span className="flex items-center gap-1.5">
                        <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold [&_svg]:size-3", s.chip)}>
                          {s.icon}
                          {i.severity}
                        </span>
                        <span className="ms-auto text-[11px] text-muted-foreground">{formatRelativeTime(i.occurredAt, locale)}</span>
                      </span>
                      <span className="line-clamp-2 font-medium">{i.title}</span>
                      <span className="text-xs text-muted-foreground">{i.ownerName ?? t("opsHub.incidents.noOwner")}</span>
                    </Link>
                  );
                })
              ) : (
                <p className="rounded-md border border-dashed px-2 py-4 text-center text-xs text-muted-foreground">{t("opsHub.incidents.columnEmpty")}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = { AVAILABLE: "bg-success", IN_USE: "bg-primary", MAINTENANCE: "bg-warning", RETIRED: "bg-muted-foreground/50" };

/** Asset register at a glance: a stacked status bar, top categories and how many have an owner. */
export function AssetVisuals({ summary, value, t, locale }: { summary: { byStatus: Record<string, number>; byCategory: { category: string | null; count: number }[]; assigned: number; total: number }; value: string | null; t: Translate; locale: string }) {
  const total = Math.max(1, summary.total);
  const maxCat = Math.max(1, ...summary.byCategory.map((c) => c.count));
  const nf = new Intl.NumberFormat(locale);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="grid content-start gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t("opsHub.assets.byStatus")}</p>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={Object.entries(summary.byStatus).map(([k, n]) => `${t(`work.ops.assetStatus.${k}`)}: ${n}`).join(", ")}>
          {Object.keys(STATUS_COLOR).map((k) => (summary.byStatus[k] ? <span key={k} className={STATUS_COLOR[k]} style={{ width: `${((summary.byStatus[k] ?? 0) / total) * 100}%` }} /> : null))}
        </div>
        <ul className="grid grid-cols-2 gap-1 text-xs">
          {Object.keys(STATUS_COLOR).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-full", STATUS_COLOR[k])} />
              {t(`work.ops.assetStatus.${k}`)}
              <span className="ms-auto tabular-nums text-muted-foreground">{nf.format(summary.byStatus[k] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid content-start gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t("opsHub.assets.byCategory")}</p>
        {summary.byCategory.length ? (
          summary.byCategory.map((c) => (
            <div key={c.category ?? "none"} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2 text-xs">
              <span className="truncate">{c.category ?? t("opsHub.assets.uncategorised")}</span>
              <span className="h-2 rounded-full bg-muted">
                <span className="block h-2 rounded-full bg-primary" style={{ width: `${(c.count / maxCat) * 100}%` }} />
              </span>
              <span className="text-end tabular-nums">{nf.format(c.count)}</span>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
      </div>
      <div className="grid content-start gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("opsHub.assets.assigned")}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {nf.format(summary.assigned)} <span className="text-sm font-normal text-muted-foreground">/ {nf.format(summary.total)}</span>
          </p>
          <p className="text-xs text-muted-foreground">{t("opsHub.assets.assignedHint")}</p>
        </div>
        {value ? (
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t("work.ops.inventoryValue")}</p>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** "Start here" for operations: the four foundations, ticked off from real records. */
export function OpsJourney({ steps, t }: { steps: { key: string; done: boolean; href: string }[]; t: Translate }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={t("opsHub.journey.title")}>
          <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-700" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{t("opsHub.journey.progress", { done, total: steps.length })}</span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {steps.map((s, i) => {
          const next = !s.done && steps.slice(0, i).every((x) => x.done);
          return (
            <li key={s.key}>
              <Link href={s.href} className={cn("hover-lift flex items-start gap-3 rounded-lg border p-3 text-sm", s.done ? "bg-success/5" : next ? "border-primary/50 bg-primary/5" : "bg-surface")}>
                <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold", s.done ? "bg-success/15 text-success" : next ? "bg-brand-gradient text-primary-foreground" : "border text-muted-foreground")}>
                  {s.done ? <CheckCircle2 className="size-3.5" /> : i + 1}
                </span>
                <span className="grid gap-0.5">
                  <span className="font-medium">{t(`opsHub.journey.steps.${s.key}.title`)}</span>
                  <span className="text-xs text-muted-foreground">{s.done ? t("opsHub.journey.done") : t(`opsHub.journey.steps.${s.key}.hint`)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Operations page header with the area's tabs. */
export function OpsHeader({ t, locale, active }: { t: Translate; locale: string; active: string }) {
  return (
    <PageHeader icon={<Gauge />} eyebrow={t("opsHub.eyebrow")} title={t("work.ops.title")} description={t("work.ops.subtitle")}>
      <OpsTabs t={t} locale={locale} active={active} />
    </PageHeader>
  );
}
