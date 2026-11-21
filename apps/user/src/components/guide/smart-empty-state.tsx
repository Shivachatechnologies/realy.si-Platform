"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, Sparkles } from "lucide-react";
import { AiCore, AnimatedProgress, LiveDot } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { companyApi, useGuideScope } from "./guide-scope";
import { Markdown } from "./markdown";
import { moduleStyle } from "./module-style";

export type SmartEmptyPrimaryAction =
  | { label: string; href: string }
  /** `path` is either a full API path ("/api/v1/...") or relative to the active company's API ("/leads"). */
  | { label: string; onClickApi: { path: string; method?: "POST" | "PUT" | "PATCH"; body?: unknown } };

export interface SmartEmptyAiAction {
  label: string;
  /** AI employee profile key (e.g. "sdr", "cmo"). */
  profile: string;
  instructions: string;
  /** Task title (defaults to `label`). */
  title?: string;
  /** Record the task is about (shows on that record's page via listSubjectTasks). */
  subject?: { type: string; id: string };
}

interface TaskState {
  id: string;
  status: string;
  output: string | null;
  errorMessage?: string | null;
}

/**
 * Smart empty state: never a blank screen. Explains the area, offers the first real action (link or API call) and
 * "Let AI do it" (a real AI task for the given profile; its live status and result appear inline), plus examples.
 *
 *   <SmartEmptyState module="sales" icon={<Users />} title={t("crm.empty.title")} description={t("crm.empty.body")}
 *     primaryAction={{ label: t("crm.newLead"), href: `/${locale}/crm?new=1` }}
 *     aiAction={{ label: t("crm.empty.ai"), profile: "sdr", instructions: "Propose 5 leads that fit our ideal customer…" }}
 *     examples={[t("crm.empty.ex1"), t("crm.empty.ex2")]} />
 */
export function SmartEmptyState({
  module,
  icon,
  title,
  description,
  primaryAction,
  aiAction,
  examples,
  orgId,
  companyId,
  className,
}: {
  module?: string;
  icon?: ReactNode;
  title: string;
  description: string;
  primaryAction?: SmartEmptyPrimaryAction;
  aiAction?: SmartEmptyAiAction;
  examples?: string[];
  /** Override the active organization/company (defaults to the app's current one). */
  orgId?: string;
  companyId?: string;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const scope = useGuideScope();
  const base = companyApi({ orgId: orgId ?? scope.orgId, companyId: companyId ?? scope.companyId });
  const style = moduleStyle(module);
  const Icon = style.icon;
  const [busy, setBusy] = useState<"primary" | "ai" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [task, setTask] = useState<TaskState | null>(null);

  const active = task && (task.status === "QUEUED" || task.status === "RUNNING");
  useEffect(() => {
    if (!active || !base || !task) return;
    const id = window.setTimeout(async () => {
      try {
        setTask(await api<TaskState>(`${base}/tasks/${task.id}`));
      } catch (err) {
        setError(err);
      }
    }, 2500);
    return () => window.clearTimeout(id);
  }, [active, base, task]);

  const runPrimary = async () => {
    if (!primaryAction || !("onClickApi" in primaryAction)) return;
    const { path, method, body } = primaryAction.onClickApi;
    const url = path.startsWith("/api/") ? path : base ? `${base}${path}` : null;
    if (!url) return;
    setBusy("primary");
    setError(null);
    try {
      await api(url, { method: method ?? "POST", body: body ?? {} });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const runAi = async () => {
    if (!aiAction || !base) return;
    setBusy("ai");
    setError(null);
    try {
      setTask(
        await api<TaskState>(`${base}/tasks`, {
          body: { profile: aiAction.profile, title: (aiAction.title ?? aiAction.label).slice(0, 200), instructions: aiAction.instructions, ...(aiAction.subject ? { subject: aiAction.subject } : {}) },
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={cn("relative overflow-hidden rounded-xl border-gradient p-6 shadow-glow sm:p-8", className)} aria-label={title}>
      <div aria-hidden className={cn("pointer-events-none absolute -end-16 -top-16 size-64 rounded-full bg-gradient-to-br opacity-40 blur-3xl", style.ring)} />
      <div className="relative grid items-center gap-6 md:grid-cols-[auto_1fr]">
        <div aria-hidden className="relative mx-auto grid size-36 place-items-center">
          <AiCore className="absolute size-36" />
          <span className={cn("relative grid size-12 place-items-center rounded-2xl border bg-surface shadow-elev-2 [&_svg]:size-6", style.tone)}>{icon ?? <Icon />}</span>
        </div>
        <div className="grid gap-3 stagger">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="max-w-xl text-sm text-muted-foreground">{description}</p>
          <div className="flex flex-wrap gap-2">
            {primaryAction ? (
              "href" in primaryAction ? (
                <Button asChild>
                  <Link href={primaryAction.href}>
                    <Plus aria-hidden />
                    {primaryAction.label}
                  </Link>
                </Button>
              ) : (
                <Button type="button" onClick={() => void runPrimary()} loading={busy === "primary"}>
                  <Plus aria-hidden />
                  {primaryAction.label}
                </Button>
              )
            ) : null}
            {aiAction && base ? (
              <Button type="button" variant="gradient" onClick={() => void runAi()} loading={busy === "ai"} disabled={!!active}>
                <Sparkles aria-hidden />
                {aiAction.label}
              </Button>
            ) : null}
          </div>
          {examples?.length ? (
            <div className="grid gap-1.5">
              <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{t("guide.empty.examples")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {examples.map((ex) => (
                  <li key={ex} className="rounded-full border bg-surface/70 px-2.5 py-1 text-xs">
                    {ex}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <FormError error={error} />
          {task ? (
            <div className="grid gap-2 rounded-lg border bg-surface/80 p-3" aria-live="polite">
              <div className="flex items-center gap-2 text-sm">
                {active ? <LiveDot tone="info" /> : null}
                <span className="font-medium">{t(`guide.task.status.${task.status}`)}</span>
                <Link href={`/${locale}/tasks/${task.id}`} className="ms-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  {t("guide.task.open")} <ExternalLink className="size-3" aria-hidden />
                </Link>
              </div>
              {active ? <AnimatedProgress label={t(`guide.task.status.${task.status}`)} size="sm" active /> : null}
              {task.status === "FAILED" ? <p className="text-sm text-danger">{task.errorMessage ?? t("guide.task.failed")}</p> : null}
              {task.output ? <Markdown text={task.output} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
