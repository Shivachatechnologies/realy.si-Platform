"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Building2, FolderKanban, Goal, Package, Plus, Target, Trash2, Workflow, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { AiCore, SuccessBurst, useReducedMotion } from "@/components/motion";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { RetryStep } from "@/components/builder/run-controls";
import type { Blueprint } from "@/server/modules/builder/steps";

type Key = "departments" | "products" | "goals" | "objectives" | "projects" | "workflows";
const SECTIONS: { key: Key; icon: typeof Building2 }[] = [
  { key: "departments", icon: Building2 },
  { key: "products", icon: Package },
  { key: "goals", icon: Goal },
  { key: "objectives", icon: Target },
  { key: "projects", icon: FolderKanban },
  { key: "workflows", icon: Workflow },
];
const EMPTY: Blueprint = { departments: [], products: [], goals: [], objectives: [], projects: [], workflows: [] };
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "workflow";

const RESULT_KEYS = ["departments", "teams", "products", "goals", "objectives", "milestones", "projects", "tasks", "workflows"] as const;
type Summary = Record<string, { created?: number; skipped?: number; forbidden?: string } | undefined>;

/** Blueprint map: the company core with one sector per part; each dot is one real item of the blueprint being edited. */
function BlueprintMap({ value, center, onPick, label }: { value: Blueprint; center: string; onPick: (k: Key) => void; label: string }) {
  const reduced = useReducedMotion();
  const { t } = useI18n();
  return (
    <figure className="relative mx-auto aspect-square w-full max-w-[24rem]" aria-label={label}>
      <svg viewBox="0 0 240 240" className="size-full" aria-hidden>
        <defs>
          <radialGradient id="bp-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="120" cy="120" r="115" fill="url(#bp-core)" />
        {[48, 78, 104].map((r) => (
          <circle key={r} cx="120" cy="120" r={r} fill="none" stroke="var(--border-strong)" strokeOpacity="0.45" strokeDasharray="1.5 3.5" />
        ))}
        {SECTIONS.map((s, si) => {
          const items = value[s.key] as unknown[];
          const a0 = (si / SECTIONS.length) * Math.PI * 2 - Math.PI / 2;
          const span = (Math.PI * 2) / SECTIONS.length;
          return (
            <g key={s.key}>
              {items.slice(0, 12).map((_, i) => {
                const a = a0 + span * 0.15 + (span * 0.7 * (i + 0.5)) / Math.min(12, Math.max(items.length, 1));
                const r = i % 2 ? 78 : 104;
                const x = 120 + Math.cos(a) * r;
                const y = 120 + Math.sin(a) * r;
                return (
                  <motion.g key={i} initial={reduced ? false : { opacity: 0, scale: 0.2 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, delay: reduced ? 0 : 0.04 * i }} style={{ transformOrigin: `${x}px ${y}px` }}>
                    <line x1="120" y1="120" x2={x} y2={y} stroke="var(--primary)" strokeOpacity="0.25" />
                    <circle cx={x} cy={y} r="5" fill="var(--primary)" stroke="var(--surface)" strokeWidth="1.5" />
                  </motion.g>
                );
              })}
            </g>
          );
        })}
        <circle cx="120" cy="120" r="30" fill="var(--surface)" stroke="var(--primary)" strokeOpacity="0.5" />
      </svg>
      <div className="absolute start-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 justify-items-center rtl:translate-x-1/2">
        <AiCore className="size-12" />
      </div>
      <figcaption className="absolute inset-x-0 bottom-0 truncate text-center text-xs font-semibold">{center}</figcaption>
      {SECTIONS.map((s, si) => {
        const a = (si / SECTIONS.length) * Math.PI * 2 - Math.PI / 2 + Math.PI / SECTIONS.length;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onPick(s.key)}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border bg-surface/90 px-2 py-1 text-[11px] font-medium shadow-elev-1 backdrop-blur hover:border-primary"
            style={{ left: `${50 + Math.cos(a) * 30}%`, top: `${50 + Math.sin(a) * 30}%` }}
          >
            <s.icon className="size-3 text-primary" aria-hidden />
            <span className="tabular-nums">{(value[s.key] as unknown[]).length}</span>
            <span className="sr-only">{t(`onboarding.journey.blueprint.sections.${s.key}`)}</span>
          </button>
        );
      })}
    </figure>
  );
}

function Section({ id, icon, title, hint, count, onAdd, addLabel, disabled, children }: { id: string; icon: ReactNode; title: string; hint: string; count: number; onAdd: () => void; addLabel: string; disabled: boolean; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border bg-surface/90 shadow-elev-1">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-4">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {title} <span className="text-muted-foreground tabular-nums">· {count}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={onAdd} disabled={disabled}>
          <Plus aria-hidden />
          <span className="max-sm:sr-only">{addLabel}</span>
        </Button>
      </header>
      <div className="grid gap-2 p-3">{children}</div>
    </section>
  );
}

function Row({ children, onRemove, removeLabel, disabled }: { children: ReactNode; onRemove: () => void; removeLabel: string; disabled: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-xl border bg-surface-2/50 p-2.5">
      <div className="grid min-w-0 gap-2">{children}</div>
      <button type="button" disabled={disabled} onClick={onRemove} aria-label={removeLabel} className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-50">
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Chip list editor (teams, milestones, tasks): comma-free, one entry per chip, Enter adds. */
function Chips({ items, onChange, placeholder, label, disabled }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; label: string; disabled: boolean }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v].slice(0, 30));
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((x) => (
        <span key={x} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-xs">
          <span className="truncate">{x}</span>
          {!disabled ? (
            <button type="button" className="text-muted-foreground hover:text-danger" aria-label={`${label}: ${x} ×`} onClick={() => onChange(items.filter((i) => i !== x))}>
              ×
            </button>
          ) : null}
        </span>
      ))}
      {!disabled ? (
        <input
          aria-label={label}
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={placeholder}
          className="h-8 min-w-32 flex-1 rounded-full border border-dashed bg-transparent px-2.5 text-xs outline-none focus:border-primary"
        />
      ) : null}
    </div>
  );
}

interface Props {
  base: string;
  runId: string;
  companyName: string;
  canManage: boolean;
  aiOk: boolean;
  /** "approved" (records created), "proposal" (AI), "draft" (the founder's saved edits), "manual" (empty, built by hand), "waiting" (AI still working). */
  mode: "approved" | "proposal" | "draft" | "manual" | "waiting";
  initial: Blueprint | null;
  summary: Summary | null;
  decisionId: string | null;
  stepStatus: string | null;
  stepError: string | null;
  stepId: string | null;
  templates: { key: string; trigger: string; name: string }[];
}

/**
 * Stage 4 — Company Blueprint: the AI's proposed company (or an empty one when AI is not available) shown as a living
 * map and edited in place — departments and teams, products and services, goals, objectives with milestones, projects
 * with starter tasks and workflows. Edits are saved server-side as they happen. Approving creates the records through
 * each module's own service; sections the founder may not manage are reported, never forced.
 */
export function BlueprintStage(p: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState(p.mode);
  const [v, setV] = useState<Blueprint>(p.initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [done, setDone] = useState<Summary | null>(null);
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const locked = mode === "approved" || !p.canManage || busy;

  const first = useRef(true);
  useEffect(() => {
    if (first.current || mode === "approved" || mode === "waiting" || !p.canManage) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => {
      setSaved("saving");
      api("/api/v1/me/onboarding", { method: "PATCH", body: { journeyStage: "blueprint", draft: { blueprint: { runId: p.runId, value: clean(v) } } } }).then(
        () => setSaved("saved"),
        () => setSaved("failed"),
      );
    }, 1200);
    return () => clearTimeout(id);
  }, [v, mode, p.runId, p.canManage]);

  const update = <K extends Key>(key: K, list: Blueprint[K]) => setV((x) => ({ ...x, [key]: list }));
  const patch = <K extends Key>(key: K, i: number, item: Partial<Blueprint[K][number]>) => update(key, (v[key] as Blueprint[K][number][]).map((x, k) => (k === i ? { ...x, ...item } : x)) as Blueprint[K]);
  const remove = (key: Key, i: number) => update(key, (v[key] as unknown[]).filter((_, k) => k !== i) as never);
  const total = useMemo(() => SECTIONS.reduce((n, s) => n + (v[s.key] as unknown[]).length, 0), [v]);
  const jump = (k: Key) => document.getElementById(`bp-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ summary: Summary }>(`${p.base}/blueprint`, { body: clean(v) });
      setDone(r.summary);
      setMode("approved");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function revise() {
    if (!p.decisionId || !feedback.trim()) return;
    setRevising(true);
    setError(null);
    try {
      await api(`${p.base}/decisions/${p.decisionId}`, { body: { action: "revise", feedback: feedback.trim() } });
      await api("/api/v1/me/onboarding", { method: "PATCH", body: { draft: { blueprint: null } } }).catch(() => undefined);
      router.refresh();
      setMode("waiting");
    } catch (err) {
      setError(err);
    } finally {
      setRevising(false);
    }
  }

  if (mode === "waiting") {
    return (
      <div className="grid gap-4">
        <section className="grid justify-items-center gap-4 rounded-[1.75rem] border bg-surface/60 p-6 text-center shadow-elev-2 backdrop-blur sm:p-10">
          <AiCore className="size-28" />
          <h2 className="font-display text-2xl text-balance">{t("onboarding.journey.blueprint.waiting.title")}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {p.stepStatus === "FAILED" ? t("onboarding.journey.blueprint.waiting.failed", { error: p.stepError ?? "" }) : p.stepStatus === "RUNNING" ? t("onboarding.journey.blueprint.waiting.running") : t("onboarding.journey.blueprint.waiting.queued")}
          </p>
          {p.canManage && p.aiOk && p.stepStatus === "FAILED" && p.stepId ? <RetryStep base={p.base} stepId={p.stepId} /> : null}
          {p.canManage ? (
            <Button variant="secondary" onClick={() => setMode("manual")}>
              <Wand2 aria-hidden />
              {t("onboarding.journey.blueprint.buildMyself")}
            </Button>
          ) : null}
        </section>
      </div>
    );
  }

  const label = (k: string) => t(`onboarding.journey.blueprint.${k}`);
  return (
    <div className="grid gap-4">
      {mode === "manual" ? <Notice tone="info">{p.aiOk ? label("manualNotice") : label("manualNoAi")}</Notice> : null}
      {mode === "proposal" ? <Notice tone="info">{label("proposalNotice")}</Notice> : null}
      {mode === "draft" ? <Notice tone="info">{label("draftNotice")}</Notice> : null}
      {!p.canManage ? <Notice tone="warning">{label("forbidden")}</Notice> : null}

      <section className="grid gap-4 rounded-[1.75rem] border bg-surface/60 p-4 shadow-elev-2 backdrop-blur sm:p-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] lg:items-center">
        <BlueprintMap value={v} center={p.companyName} onPick={jump} label={t("onboarding.journey.blueprint.mapLabel", { count: total })} />
        <div className="grid gap-3">
          {v.summary ? <p className="text-sm text-pretty">{v.summary}</p> : null}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SECTIONS.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => jump(s.key)} className="flex w-full items-center gap-2 rounded-xl border bg-surface px-3 py-2 text-start text-sm hover:border-primary">
                  <s.icon className="size-4 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t(`onboarding.journey.blueprint.sections.${s.key}`)}</span>
                  <span className="font-semibold tabular-nums">{(v[s.key] as unknown[]).length}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {done || (mode === "approved" && p.summary) ? (
        <section className="grid gap-3 rounded-2xl border border-success/40 bg-success/5 p-4">
          <div className="flex items-center gap-3">
            <SuccessBurst active={!!done} size={56} label={label("approved")} />
            <div>
              <h2 className="font-semibold">{label("approved")}</h2>
              <p className="text-xs text-muted-foreground">{label("approvedHint")}</p>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {RESULT_KEYS.map((k) => [k, (done ?? p.summary ?? {})[k]] as const).map(([k, s]) =>
              s ? (
                <li key={k} className="rounded-lg border bg-surface px-3 py-2">
                  <span className="block text-xs text-muted-foreground">{t(`onboarding.journey.blueprint.result.${k}`)}</span>
                  {s.forbidden ? <Badge tone="warning">{t("onboarding.journey.blueprint.result.forbidden")}</Badge> : <span className="font-semibold tabular-nums">{t("onboarding.journey.blueprint.result.counts", { created: s.created ?? 0, skipped: s.skipped ?? 0 })}</span>}
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}

      <Section id="bp-departments" icon={<Building2 />} title={label("sections.departments")} hint={label("hints.departments")} count={v.departments.length} addLabel={label("add.departments")} disabled={locked} onAdd={() => update("departments", [...v.departments, { name: "", teams: [] }])}>
        {v.departments.map((d, i) => (
          <Row key={i} disabled={locked} removeLabel={label("remove")} onRemove={() => remove("departments", i)}>
            <Input aria-label={label("fields.name")} placeholder={label("fields.departmentName")} value={d.name} disabled={locked} maxLength={120} onChange={(e) => patch("departments", i, { name: e.target.value })} />
            <Input aria-label={label("fields.description")} placeholder={label("fields.description")} value={d.description ?? ""} disabled={locked} maxLength={2000} onChange={(e) => patch("departments", i, { description: e.target.value })} />
            <Chips label={label("fields.teams")} placeholder={label("fields.addTeam")} disabled={locked} items={d.teams.map((x) => x.name)} onChange={(names) => patch("departments", i, { teams: names.map((n) => d.teams.find((x) => x.name === n) ?? { name: n }) })} />
          </Row>
        ))}
        {!v.departments.length ? <p className="text-xs text-muted-foreground">{label("empty")}</p> : null}
      </Section>

      <Section id="bp-products" icon={<Package />} title={label("sections.products")} hint={label("hints.products")} count={v.products.length} addLabel={label("add.products")} disabled={locked} onAdd={() => update("products", [...v.products, { name: "" }])}>
        {v.products.map((x, i) => (
          <Row key={i} disabled={locked} removeLabel={label("remove")} onRemove={() => remove("products", i)}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Input aria-label={label("fields.name")} placeholder={label("fields.productName")} value={x.name} disabled={locked} maxLength={120} onChange={(e) => patch("products", i, { name: e.target.value })} />
              <Input aria-label={label("fields.pricing")} placeholder={label("fields.pricing")} value={x.pricing ?? ""} disabled={locked} maxLength={300} onChange={(e) => patch("products", i, { pricing: e.target.value })} />
            </div>
            <Textarea rows={2} aria-label={label("fields.description")} placeholder={label("fields.description")} value={x.description ?? ""} disabled={locked} maxLength={2000} onChange={(e) => patch("products", i, { description: e.target.value })} />
          </Row>
        ))}
        {!v.products.length ? <p className="text-xs text-muted-foreground">{label("empty")}</p> : null}
      </Section>

      <Section id="bp-goals" icon={<Goal />} title={label("sections.goals")} hint={label("hints.goals")} count={v.goals.length} addLabel={label("add.goals")} disabled={locked || v.goals.length >= 5} onAdd={() => update("goals", [...v.goals, { title: "", horizon: "QUARTER" }])}>
        {v.goals.map((g, i) => (
          <Row key={i} disabled={locked} removeLabel={label("remove")} onRemove={() => remove("goals", i)}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Input aria-label={label("fields.title")} placeholder={label("fields.goalTitle")} value={g.title} disabled={locked} maxLength={300} onChange={(e) => patch("goals", i, { title: e.target.value })} />
              <Select aria-label={label("fields.horizon")} value={g.horizon} disabled={locked} onChange={(e) => patch("goals", i, { horizon: e.target.value as "QUARTER" | "YEAR" })}>
                <option value="QUARTER">{label("fields.quarter")}</option>
                <option value="YEAR">{label("fields.year")}</option>
              </Select>
            </div>
          </Row>
        ))}
        {!v.goals.length ? <p className="text-xs text-muted-foreground">{label("empty")}</p> : null}
      </Section>

      <Section id="bp-objectives" icon={<Target />} title={label("sections.objectives")} hint={label("hints.objectives")} count={v.objectives.length} addLabel={label("add.objectives")} disabled={locked || v.objectives.length >= 10} onAdd={() => update("objectives", [...v.objectives, { title: "", targetInDays: 90, milestones: [] }])}>
        {v.objectives.map((o, i) => (
          <Row key={i} disabled={locked} removeLabel={label("remove")} onRemove={() => remove("objectives", i)}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <Input aria-label={label("fields.title")} placeholder={label("fields.objectiveTitle")} value={o.title} disabled={locked} maxLength={200} onChange={(e) => patch("objectives", i, { title: e.target.value })} />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Input type="number" min={0} max={3650} inputMode="numeric" aria-label={label("fields.targetInDays")} value={o.targetInDays ?? ""} disabled={locked} onChange={(e) => patch("objectives", i, { targetInDays: e.target.value === "" ? undefined : Math.max(0, Math.min(3650, Math.round(Number(e.target.value)))) })} />
                {label("fields.days")}
              </label>
            </div>
            <Chips label={label("fields.milestones")} placeholder={label("fields.addMilestone")} disabled={locked} items={o.milestones.map((m) => m.title)} onChange={(titles) => patch("objectives", i, { milestones: titles.map((tt) => o.milestones.find((m) => m.title === tt) ?? { title: tt }) })} />
          </Row>
        ))}
        {!v.objectives.length ? <p className="text-xs text-muted-foreground">{label("empty")}</p> : null}
      </Section>

      <Section id="bp-projects" icon={<FolderKanban />} title={label("sections.projects")} hint={label("hints.projects")} count={v.projects.length} addLabel={label("add.projects")} disabled={locked || v.projects.length >= 10} onAdd={() => update("projects", [...v.projects, { name: "", tasks: [] }])}>
        {v.projects.map((x, i) => (
          <Row key={i} disabled={locked} removeLabel={label("remove")} onRemove={() => remove("projects", i)}>
            <Input aria-label={label("fields.name")} placeholder={label("fields.projectName")} value={x.name} disabled={locked} maxLength={120} onChange={(e) => patch("projects", i, { name: e.target.value })} />
            <Chips label={label("fields.tasks")} placeholder={label("fields.addTask")} disabled={locked} items={x.tasks.map((tk) => tk.title)} onChange={(titles) => patch("projects", i, { tasks: titles.map((tt) => x.tasks.find((tk) => tk.title === tt) ?? { title: tt, priority: "MEDIUM" as const }) })} />
          </Row>
        ))}
        {!v.projects.length ? <p className="text-xs text-muted-foreground">{label("empty")}</p> : null}
      </Section>

      <Section id="bp-workflows" icon={<Workflow />} title={label("sections.workflows")} hint={label("hints.workflows")} count={v.workflows.length} addLabel={label("add.workflows")} disabled={locked || v.workflows.length >= 10} onAdd={() => update("workflows", [...v.workflows, { key: "", name: "", trigger: "", description: "" }])}>
        {v.workflows.map((w, i) => (
          <Row key={i} disabled={locked} removeLabel={label("remove")} onRemove={() => remove("workflows", i)}>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label={label("fields.name")} placeholder={label("fields.workflowName")} value={w.name} disabled={locked} maxLength={120} onChange={(e) => patch("workflows", i, { name: e.target.value, key: w.key || slug(e.target.value) })} />
              <Select
                aria-label={label("fields.template")}
                disabled={locked}
                value={p.templates.some((x) => x.key === w.key) ? w.key : ""}
                onChange={(e) => {
                  const tpl = p.templates.find((x) => x.key === e.target.value);
                  patch("workflows", i, tpl ? { key: tpl.key, trigger: tpl.trigger, name: w.name || tpl.name } : { key: slug(w.name) });
                }}
              >
                <option value="">{label("fields.custom")}</option>
                {p.templates.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </div>
            <Input aria-label={label("fields.description")} placeholder={label("fields.description")} value={w.description} disabled={locked} maxLength={2000} onChange={(e) => patch("workflows", i, { description: e.target.value })} />
            {w.trigger ? <p className="text-[11px] text-muted-foreground">{t("onboarding.journey.blueprint.fields.trigger", { trigger: w.trigger })}</p> : null}
          </Row>
        ))}
        {!v.workflows.length ? <p className="text-xs text-muted-foreground">{label("empty")}</p> : null}
      </Section>

      {mode === "proposal" && p.decisionId && p.canManage && p.aiOk ? (
        <section className="grid gap-2 rounded-2xl border bg-surface/80 p-4">
          <h2 className="text-sm font-semibold">{label("reviseTitle")}</h2>
          <Textarea rows={2} value={feedback} maxLength={2000} onChange={(e) => setFeedback(e.target.value)} placeholder={label("revisePlaceholder")} aria-label={label("reviseTitle")} />
          <div>
            <Button size="sm" variant="secondary" loading={revising} disabled={!feedback.trim()} onClick={revise}>
              <Wand2 aria-hidden />
              {label("revise")}
            </Button>
          </div>
        </section>
      ) : null}

      <FormError error={error} />
      <div className={cn("sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface/90 p-3 shadow-elev-3 backdrop-blur")}>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {mode === "approved" ? label("approvedHint") : saved === "saving" ? t("onboarding.journey.saving") : saved === "saved" ? t("onboarding.journey.saved") : saved === "failed" ? t("onboarding.journey.saveFailed") : t("onboarding.journey.blueprint.approveHint", { count: total })}
        </p>
        {mode === "approved" ? (
          <Button
            size="xl"
            variant="luminous"
            onClick={() => {
              router.push(`/${locale}/onboarding?stage=workforce`);
              router.refresh();
            }}
          >
            {label("toWorkforce")}
          </Button>
        ) : p.canManage ? (
          <Button size="xl" variant="luminous" magnetic loading={busy} disabled={!clean(v).departments.length && total === 0} onClick={approve}>
            {label("approve")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Drop empty rows and blank optional text before saving or approving. */
function clean(v: Blueprint): Blueprint {
  const s = (x?: string) => (x?.trim() ? x.trim() : undefined);
  return {
    summary: s(v.summary),
    departments: v.departments.filter((d) => d.name.trim()).map((d) => ({ name: d.name.trim(), description: s(d.description), teams: d.teams.filter((x) => x.name.trim()) })),
    products: v.products.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), description: s(x.description), pricing: s(x.pricing) })),
    goals: v.goals.filter((g) => g.title.trim()).map((g) => ({ ...g, title: g.title.trim(), description: s(g.description) })),
    objectives: v.objectives.filter((o) => o.title.trim()).map((o) => ({ ...o, title: o.title.trim(), description: s(o.description) })),
    projects: v.projects.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), tasks: x.tasks })),
    workflows: v.workflows.filter((w) => w.name.trim()).map((w) => ({ ...w, name: w.name.trim(), key: w.key || slug(w.name), trigger: w.trigger || "manual" })),
  };
}
