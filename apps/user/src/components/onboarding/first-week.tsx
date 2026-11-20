"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Briefcase, Calculator, Crown, Megaphone, Palette, PlayCircle, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";

export type FirstWeekTask = { id: string; key: string; status: string; aiEmployeeId: string | null; profile: string };

const KEYS = [
  { key: "ceo_plan", icon: Crown },
  { key: "brand_brief", icon: Palette },
  { key: "marketing_plan", icon: Megaphone },
  { key: "icp_leads", icon: Users },
  { key: "finance_checklist", icon: Calculator },
  { key: "product_prd", icon: Briefcase },
] as const;
const TONE: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = { QUEUED: "neutral", RUNNING: "info", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" };

/**
 * The company's first real work on the Launch stage: the AI CEO's weekly plan and each department's first deliverable,
 * as real agent tasks (status from the database, links to the task). Missing ones (AI was unavailable, a task failed)
 * can be started again; only what is missing is created.
 */
export function FirstWeek({ base, tasks, employees, canRun }: { base: string; tasks: FirstWeekTask[]; employees: { id: string; name: string }[]; canRun: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const byKey = new Map(tasks.map((x) => [x.key, x]));
  const missing = KEYS.some((k) => !byKey.has(k.key) || ["FAILED", "CANCELLED"].includes(byKey.get(k.key)!.status));
  const done = tasks.filter((x) => x.status === "COMPLETED").length;

  async function start() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api<{ created: number; failed: number; reason?: string }>(`${base}/first-week`, { method: "POST" });
      if (!r.created && r.reason) setNote(t("onboarding.journey.firstWeek.notStarted"));
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-2xl border bg-surface/80 p-4 sm:p-5" aria-labelledby="first-week-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 id="first-week-title" className="font-display text-lg">
            {t("onboarding.journey.firstWeek.title")}
          </h2>
          <p className="text-xs text-pretty text-muted-foreground">{tasks.length ? t("onboarding.journey.firstWeek.lead", { done, total: KEYS.length }) : t("onboarding.journey.firstWeek.empty")}</p>
        </div>
        {missing && canRun ? (
          <Button size="sm" onClick={start} disabled={busy}>
            <PlayCircle className="size-4" aria-hidden />
            {tasks.length ? t("onboarding.journey.firstWeek.retry") : t("onboarding.journey.firstWeek.start")}
          </Button>
        ) : null}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {KEYS.map(({ key, icon: Icon }) => {
          const task = byKey.get(key);
          const owner = task?.aiEmployeeId ? employees.find((e) => e.id === task.aiEmployeeId)?.name : task ? t(`profiles.${task.profile}.name`) : null;
          const body = (
            <>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{t(`onboarding.journey.firstWeek.items.${key}`)}</span>
                <span className="truncate text-[11px] text-muted-foreground">{owner ?? t("onboarding.journey.firstWeek.notCreated")}</span>
              </span>
              {task ? (
                <Badge tone={TONE[task.status] ?? "neutral"} pulse={task.status === "RUNNING"}>
                  {t(`agentTasks.status.${task.status}`)}
                </Badge>
              ) : null}
              {task ? <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden /> : null}
            </>
          );
          return (
            <li key={key}>
              {task ? (
                <Link href={`/${locale}/tasks/${task.id}`} className="flex items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 transition-colors hover:border-primary/40">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-dashed bg-surface/60 px-3 py-2.5 opacity-80">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {note ? <p className="text-xs text-warning">{note}</p> : null}
      <FormError error={error} />
    </section>
  );
}
