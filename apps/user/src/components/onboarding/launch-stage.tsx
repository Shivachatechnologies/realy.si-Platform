"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Bot, Building2, FolderKanban, Goal, Package, Target, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/form-error";
import { AiCore, AnimatedNumber, useReducedMotion } from "@/components/motion";
import { MaterializeScene, type SceneItem } from "@/components/graphics/journey-scenes";
import { STEP_TONE } from "@/components/builder/frame";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { FirstWeek, type FirstWeekTask } from "./first-week";
import { BlueprintUniverse, type UniverseSource } from "./blueprint-universe";

interface Props {
  companyName: string;
  records: { departments: number; products: number; aiEmployees: number; projects: number; objectives: number; goals: number; workflows: number; tasks: number };
  employees: { id: string; name: string; profileKey: string; department: string; status: string }[];
  later: { id: string; key: string; status: keyof typeof STEP_TONE }[];
  base: string;
  /** First-week agent tasks; null when the viewer may not see AI tasks. */
  firstWeek: FirstWeekTask[] | null;
  canRun: boolean;
  universe: UniverseSource | null;
}

const TILES = [
  { key: "departments", icon: Building2 },
  { key: "products", icon: Package },
  { key: "goals", icon: Goal },
  { key: "objectives", icon: Target },
  { key: "projects", icon: FolderKanban },
  { key: "workflows", icon: Workflow },
  { key: "aiEmployees", icon: Bot },
] as const;

/**
 * Stage 6 — Launch: the company that now exists (real record counts, the hired AI team materialising around the core,
 * the builder steps that keep working after launch), then a cinematic hand-off into the Command Center. The journey is
 * marked complete server-side first, so it never repeats. Reduced motion navigates without the transition.
 */
export function LaunchStage({ companyName, records, employees, later, base, firstWeek, canRun, universe }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const reduced = useReducedMotion();
  const [go, setGo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const items: SceneItem[] = [
    ...employees.slice(0, 12).map((e): SceneItem => ({ id: `ai:${e.id}`, label: e.name, ring: 2, active: e.status !== "PAUSED", done: true, avatar: { seed: e.id, department: e.department } })),
    ...later.map((s): SceneItem => ({ id: `s:${s.id}`, label: t(`builder.steps.${s.key}`), ring: 0, active: s.status === "RUNNING" || s.status === "APPLYING", done: s.status === "COMPLETED" })),
  ];

  async function enter() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/me/onboarding", { method: "PATCH", body: { journeyStage: "launch", completed: true } });
      const href = `/${locale}`;
      if (reduced) return router.push(href);
      setGo(true);
      router.prefetch(href);
      window.setTimeout(() => router.push(href), 1300);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <section className="relative isolate grid gap-6 overflow-hidden rounded-[2rem] border bg-surface/50 p-4 shadow-elev-3 backdrop-blur sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,var(--glow),transparent_60%)] opacity-50" />
        <div className="relative grid gap-4">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">{t("onboarding.journey.launch.eyebrow")}</p>
          <h2 className="font-display text-[clamp(1.9rem,5vw,3.2rem)] leading-[1.05] text-balance">{t("onboarding.journey.launch.title", { name: companyName })}</h2>
          <p className="text-sm text-pretty text-muted-foreground">{t("onboarding.journey.launch.lead")}</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {TILES.map((x) => (
              <li key={x.key} className="grid gap-0.5 rounded-xl border bg-surface/80 px-3 py-2">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <x.icon className="size-3.5 text-primary" aria-hidden />
                  {t(`onboarding.journey.launch.records.${x.key}`)}
                </span>
                <AnimatedNumber value={records[x.key]} className="font-display text-2xl tabular-nums" />
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={enter}
            disabled={busy}
            className="press inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-6 text-[15px] font-medium text-primary-foreground shadow-glow transition-[filter] hover:brightness-110 disabled:opacity-70 sm:w-fit"
          >
            {t("onboarding.journey.launch.enter")}
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </button>
          <FormError error={error} />
        </div>
        {items.length ? <MaterializeScene items={items} center={companyName} ariaLabel={t("onboarding.journey.launch.sceneLabel")} /> : <AiCore className="mx-auto size-40" />}
      </section>

      {firstWeek ? <FirstWeek base={base} tasks={firstWeek} employees={employees} canRun={canRun} /> : null}

      {universe ? <BlueprintUniverse source={universe} /> : null}

      {later.length ? (
        <section className="grid gap-2 rounded-2xl border bg-surface/80 p-4">
          <h2 className="text-sm font-semibold">{t("onboarding.journey.launch.keepsWorking")}</h2>
          <p className="text-xs text-muted-foreground">{t("onboarding.journey.launch.keepsWorkingHint")}</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {later.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border bg-surface px-3 py-2 text-sm">
                <span className="truncate">{t(`builder.steps.${s.key}`)}</span>
                <Badge tone={STEP_TONE[s.status]} pulse={s.status === "RUNNING"}>
                  {t(`builder.stepStatus.${s.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <AnimatePresence>
        {go ? (
          <motion.div key="launch" aria-hidden className="fixed inset-0 z-[80] grid place-items-center bg-background" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, ease: [0.65, 0, 0.35, 1] }}>
            <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 7, opacity: [0, 1, 0] }} transition={{ duration: 1.3, ease: [0.65, 0, 0.35, 1] }}>
              <AiCore className="size-40" />
            </motion.div>
            <motion.p className="absolute bottom-[18%] font-display text-2xl" initial={{ opacity: 0, y: 12 }} animate={{ opacity: [0, 1, 0], y: 0 }} transition={{ duration: 1.3 }}>
              {companyName}
            </motion.p>
            <motion.div className="absolute inset-0 bg-[radial-gradient(circle,var(--glow),transparent_60%)]" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.4] }} transition={{ duration: 1.3 }} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
