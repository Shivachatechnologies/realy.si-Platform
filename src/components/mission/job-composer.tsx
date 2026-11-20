"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Briefcase, Send, Sparkles, UserRound } from "lucide-react";
import { FormError } from "@/components/form-error";
import { ResumeNote, SavedIndicator, FlowSteps } from "@/components/cockpit/flow-bits";
import { useGuidedDraft } from "@/components/cockpit/use-guided-draft";
import { AiAvatar } from "@/components/workforce/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** Ready-made jobs per department (missionControl.templates.<id>.title / .body). */
const TEMPLATES: Record<string, string[]> = {
  executive: ["weekly_brief", "priorities"],
  sales: ["prospects", "pipeline_review"],
  marketing: ["campaign_idea", "content_plan"],
  finance: ["cash_check", "overdue_invoices"],
  hr: ["job_post", "team_health"],
  support: ["queue_triage", "faq_gaps"],
  operations: ["process_draft", "project_status"],
  research: ["competitors", "kpi_review"],
  general: ["research_topic", "summarize_docs"],
};
const templatesFor = (dept: string) => [...(TEMPLATES[dept] ?? []), ...TEMPLATES.general!];

export interface ComposerEmployee {
  id: string;
  name: string;
  initials: string;
  department: string;
  profileKey: string;
  jobTitle: string | null;
}

const DEFAULTS = { who: "", title: "", instructions: "", milestoneId: "" };

/**
 * "Give an AI employee a job": a three-step guided composer (who → what → check & send) that creates a real AI task.
 * Answers are saved on the server as you go, so you can leave and continue later.
 */
export function JobComposer({
  base,
  locale,
  employees,
  roles,
  milestones,
  initialWho,
  draft,
}: {
  base: string;
  locale: string;
  employees: ComposerEmployee[];
  roles: { key: string; department: string }[];
  milestones: { id: string; label: string }[];
  /** "emp:<id>" or "role:<key>" from the URL (e.g. "Give a job" on an employee page). */
  initialWho?: string;
  draft: { step: number; data: Record<string, unknown> } | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const recommended = initialWho ?? (employees[0] ? `emp:${employees[0].id}` : roles[0] ? `role:${roles[0].key}` : "");
  const defaults = useMemo(() => ({ ...DEFAULTS, who: recommended }), [recommended]);
  const d = useGuidedDraft(base, "tasks.composer", defaults, initialWho ? { step: 0, data: { ...(draft?.data ?? {}), who: initialWho } } : draft);
  const [reached, setReached] = useState(Math.max(d.step, 0));
  const [dept, setDept] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = error instanceof ApiError ? error.fieldErrors() : {};
  const steps = [t("missionControl.composer.steps.who"), t("missionControl.composer.steps.what"), t("missionControl.composer.steps.send")];

  const who = String(d.data.who ?? "");
  const emp = who.startsWith("emp:") ? employees.find((e) => e.id === who.slice(4)) : undefined;
  const roleKey = emp ? emp.profileKey : who.startsWith("role:") ? who.slice(5) : "";
  const role = roles.find((r) => r.key === roleKey);
  const department = emp?.department ?? role?.department ?? "general";
  const departments = [...new Set(employees.map((e) => e.department))].sort();
  const shown = dept === "all" ? employees : employees.filter((e) => e.department === dept);
  const deptLabel = (k: string) => (t(`missionControl.departments.${k}`) === `missionControl.departments.${k}` ? k : t(`missionControl.departments.${k}`));

  const go = (i: number) => {
    d.setStep(i);
    setReached((r) => Math.max(r, i));
  };
  const canNext = d.step === 0 ? !!(emp || role) : d.step === 1 ? !!String(d.data.title).trim() && !!String(d.data.instructions).trim() : true;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const task = await api<{ id: string }>(`${base}/tasks`, {
        body: {
          ...(emp ? { aiEmployeeId: emp.id } : { profile: roleKey }),
          title: String(d.data.title).trim(),
          instructions: String(d.data.instructions).trim(),
          milestoneId: d.data.milestoneId ? String(d.data.milestoneId) : undefined,
        },
      });
      await d.clear();
      router.push(`/${locale}/tasks/${task.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FlowSteps steps={steps} current={d.step} reached={reached} onGo={go} label={t("missionControl.composer.title")} />
        <SavedIndicator state={d.saved} />
      </div>
      {d.resumed && d.step > 0 ? <ResumeNote onReset={() => void d.clear().then(() => setReached(0))} /> : null}

      {d.step === 0 ? (
        <div className="grid gap-3 animate-fade-up">
          <div>
            <h3 className="font-semibold">{t("missionControl.composer.whoQ")}</h3>
            <p className="text-sm text-muted-foreground">{t("missionControl.composer.whoHint")}</p>
          </div>
          {employees.length ? (
            <>
              {departments.length > 1 ? (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("missionControl.composer.department")}>
                  {["all", ...departments].map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={dept === k}
                      onClick={() => setDept(k)}
                      className={cn("rounded-full border px-3 py-1 text-xs", dept === k ? "border-primary bg-accent font-medium" : "hover:bg-muted")}
                    >
                      {k === "all" ? t("common.all") : deptLabel(k)}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label={t("missionControl.composer.whoQ")}>
                {shown.map((e) => {
                  const on = who === `emp:${e.id}`;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => d.set("who", `emp:${e.id}`)}
                      className={cn("hover-lift flex items-center gap-3 rounded-lg border bg-surface p-3 text-start", on && "border-primary ring-2 ring-primary/30")}
                    >
                      <AiAvatar id={e.id} initials={e.initials} size="md" />
                      <span className="grid min-w-0">
                        <span className="truncate font-medium">{e.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{e.jobTitle ?? t(`profiles.${e.profileKey}.name`)}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{deptLabel(e.department)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              {t("missionControl.composer.noEmployees")}{" "}
              <a href={`/${locale}/workforce/hire`} className="font-medium text-primary hover:underline">
                {t("workforce.hire.title")}
              </a>
            </p>
          )}
          <details className="rounded-md border p-3" open={!employees.length || who.startsWith("role:")}>
            <summary className="cursor-pointer text-sm font-medium">{t("missionControl.composer.orRole")}</summary>
            <p className="mt-1 text-xs text-muted-foreground">{t("missionControl.composer.orRoleHint")}</p>
            <Select className="mt-2 max-w-sm" aria-label={t("agentTasks.profile")} value={who.startsWith("role:") ? who : ""} onChange={(e) => d.set("who", e.target.value || recommended)}>
              <option value="">{t("missionControl.composer.pickRole")}</option>
              {roles.map((r) => (
                <option key={r.key} value={`role:${r.key}`}>
                  {t(`profiles.${r.key}.name`)} · {deptLabel(r.department)}
                </option>
              ))}
            </Select>
          </details>
        </div>
      ) : null}

      {d.step === 1 ? (
        <div className="grid gap-3 animate-fade-up">
          <div>
            <h3 className="font-semibold">{t("missionControl.composer.whatQ", { name: emp?.name ?? t(`profiles.${roleKey}.name`) })}</h3>
            <p className="text-sm text-muted-foreground">{t("missionControl.composer.whatHint")}</p>
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("missionControl.composer.ideas", { department: deptLabel(department) })}</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {templatesFor(department).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => d.patch({ title: t(`missionControl.templates.${id}.title`), instructions: t(`missionControl.templates.${id}.body`) })}
                  className="hover-lift flex items-start gap-2 rounded-md border bg-surface-2/60 p-2.5 text-start text-sm"
                >
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span className="grid gap-0.5">
                    <span className="font-medium">{t(`missionControl.templates.${id}.title`)}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{t(`missionControl.templates.${id}.body`)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Field label={t("missionControl.composer.jobTitle")} htmlFor="job-title" hint={t("missionControl.composer.jobTitleHint")} error={fields.title}>
            <Input id="job-title" value={String(d.data.title)} maxLength={200} onChange={(e) => d.set("title", e.target.value)} />
          </Field>
          <Field label={t("missionControl.composer.brief")} htmlFor="job-brief" hint={t("missionControl.composer.briefHint")} error={fields.instructions}>
            <Textarea id="job-brief" rows={6} value={String(d.data.instructions)} maxLength={8000} onChange={(e) => d.set("instructions", e.target.value)} />
          </Field>
        </div>
      ) : null}

      {d.step === 2 ? (
        <div className="grid gap-3 animate-fade-up">
          <h3 className="font-semibold">{t("missionControl.composer.sendQ")}</h3>
          <div className="grid gap-3 rounded-lg border bg-surface-2/50 p-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <UserRound className="size-4" aria-hidden /> {t("missionControl.composer.steps.who")}
            </span>
            <span className="font-medium">{emp ? `${emp.name} · ${t(`profiles.${emp.profileKey}.name`)}` : t(`profiles.${roleKey}.name`)}</span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Briefcase className="size-4" aria-hidden /> {t("missionControl.composer.steps.what")}
            </span>
            <span className="grid gap-1">
              <span className="font-medium">{String(d.data.title)}</span>
              <span className="whitespace-pre-wrap text-muted-foreground">{String(d.data.instructions)}</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t("missionControl.composer.safety")}</p>
          {milestones.length ? (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("missionControl.composer.advanced")}</summary>
              <Field label={t("agentTasks.milestone")} htmlFor="job-milestone" hint={t("agentTasks.milestoneHint")} className="mt-2">
                <Select id="job-milestone" value={String(d.data.milestoneId ?? "")} onChange={(e) => d.set("milestoneId", e.target.value)}>
                  <option value="">{t("agentTasks.noMilestone")}</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </details>
          ) : null}
          <FormError error={error} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {d.step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => go(d.step - 1)}>
            <ArrowLeft aria-hidden className="rtl:-scale-x-100" /> {t("cockpit.back")}
          </Button>
        ) : null}
        {d.step < 2 ? (
          <Button type="button" onClick={() => go(d.step + 1)} disabled={!canNext}>
            {t("common.next")} <ArrowRight aria-hidden className="rtl:-scale-x-100" />
          </Button>
        ) : (
          <Button type="button" variant="gradient" onClick={send} disabled={busy} aria-busy={busy}>
            <Send aria-hidden className="rtl:-scale-x-100" /> {busy ? t("agentTasks.submitting") : t("missionControl.composer.send")}
          </Button>
        )}
      </div>
    </div>
  );
}
