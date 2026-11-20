"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FolderKanban, Flag, ListChecks, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { MetricOption, Option } from "./objective-forms";
import type { DraftTask, DraftProject, DraftMilestone, DraftKeyResult, DraftObjective } from "@realy/shared-types/objectives/plan-review";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

function Include({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" className="mt-2 size-4 shrink-0 accent-primary" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}

function PersonSelect({ id, label, value, onChange, people, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; people: Option[]; hint?: string }) {
  const t = useT();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("objectives.plan.unassigned")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const krInvalid = (kr: DraftKeyResult) => {
  const b = Number(kr.baseline || 0);
  const tg = Number(kr.target);
  if (kr.target === "" || !Number.isFinite(tg) || !Number.isFinite(b)) return true;
  return kr.direction === "INCREASE" ? tg <= b : tg >= b;
};

export function PlanReview({
  base,
  goalId,
  initial,
  objectiveOwners,
  workPeople,
  departments,
  metrics,
  canCreateProjects,
  resumable,
}: {
  base: string;
  goalId: string;
  initial: DraftObjective[];
  objectiveOwners: Option[];
  workPeople: Option[];
  departments: Option[];
  metrics: MetricOption[];
  canCreateProjects: boolean;
  resumable: number;
}) {
  const t = useT();
  const router = useRouter();
  const [plan, setPlan] = useState<DraftObjective[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const setObjective = (i: number, p: Partial<DraftObjective>) => setPlan((all) => all.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const setKr = (i: number, k: number, p: Partial<DraftKeyResult>) => setObjective(i, { keyResults: plan[i]!.keyResults.map((kr, j) => (j === k ? { ...kr, ...p } : kr)) });
  const setMilestone = (i: number, m: number, p: Partial<DraftMilestone>) => setObjective(i, { milestones: plan[i]!.milestones.map((ms, j) => (j === m ? { ...ms, ...p } : ms)) });
  const setProject = (i: number, m: number, p: Partial<DraftProject>) => {
    const ms = plan[i]!.milestones[m]!;
    if (ms.project) setMilestone(i, m, { project: { ...ms.project, ...p } });
  };
  const setTask = (i: number, m: number, k: number, p: Partial<DraftTask>) => {
    const project = plan[i]!.milestones[m]!.project;
    if (project) setProject(i, m, { tasks: project.tasks.map((tk, j) => (j === k ? { ...tk, ...p } : tk)) });
  };

  const counts = useMemo(() => {
    const os = plan.filter((o) => o.include);
    const ms = os.flatMap((o) => o.milestones.filter((m) => m.include));
    const ps = canCreateProjects ? ms.flatMap((m) => (m.project?.include ? [m.project] : [])) : [];
    return {
      objectives: os.length,
      keyResults: os.reduce((s, o) => s + o.keyResults.filter((k) => k.include).length, 0),
      milestones: ms.length,
      projects: ps.length,
      tasks: ps.reduce((s, p) => s + p.tasks.filter((tk) => tk.include).length, 0),
      invalid: os.some((o) => !o.title.trim() || o.keyResults.some((k) => k.include && (krInvalid(k) || !k.title.trim() || (k.source === "METRIC" && !k.metricKey)))),
    };
  }, [plan, canCreateProjects]);

  async function apply() {
    setBusy(true);
    setError(null);
    const opt = (v: string) => v || null;
    const payload = {
      objectives: plan
        .filter((o) => o.include)
        .map((o) => ({
          key: o.key,
          title: o.title,
          description: o.description || undefined,
          ownerId: opt(o.ownerId),
          departmentId: opt(o.departmentId),
          startDate: opt(o.startDate),
          targetDate: opt(o.targetDate),
          keyResults: o.keyResults
            .filter((k) => k.include)
            .map((k) => ({ key: k.key, title: k.title, source: k.source, metricKey: k.source === "METRIC" ? k.metricKey : null, unit: k.unit || null, baseline: Number(k.baseline || 0), target: Number(k.target), direction: k.direction })),
          milestones: o.milestones
            .filter((m) => m.include)
            .map((m) => ({
              key: m.key,
              title: m.title,
              dueDate: opt(m.dueDate),
              project:
                canCreateProjects && m.project?.include
                  ? {
                      key: m.project.key,
                      name: m.project.name,
                      description: m.project.description || undefined,
                      ownerId: opt(m.project.ownerId),
                      dueDate: opt(m.project.dueDate),
                      tasks: m.project.tasks
                        .filter((tk) => tk.include)
                        .map((tk) => ({ key: tk.key, title: tk.title, description: tk.description || undefined, assigneeId: opt(tk.assigneeId), dueDate: opt(tk.dueDate), priority: tk.priority })),
                    }
                  : null,
            })),
        })),
    };
    try {
      await api(`${base}/goals/${goalId}/plan/apply`, { body: payload });
      router.refresh();
    } catch (err) {
      setError(err);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const partial = error instanceof ApiError ? (error.details?.partial as Record<string, number> | undefined) : undefined;

  return (
    <div className="grid gap-4">
      {resumable ? <Notice tone="warning">{t("objectives.plan.resumable", { count: resumable })}</Notice> : null}
      {!canCreateProjects ? <Notice tone="info">{t("objectives.plan.noProjectsPermission")}</Notice> : null}
      {plan.map((o, i) => (
        <Card key={o.key} className={cn(!o.include && "opacity-60")}>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Target className="size-4 text-primary" aria-hidden />
                {t("objectives.plan.objectiveN", { n: i + 1 })}
              </span>
            }
            description={o.suggestion ? t("objectives.plan.suggested", { value: o.suggestion }) : undefined}
            actions={
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="size-4 accent-primary" checked={o.include} onChange={(e) => setObjective(i, { include: e.target.checked })} />
                {t("objectives.plan.include")}
              </label>
            }
          />
          {o.include ? (
            <CardBody className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("objectives.title")} htmlFor={`${o.key}-title`} className="sm:col-span-2">
                  <Input id={`${o.key}-title`} value={o.title} maxLength={200} onChange={(e) => setObjective(i, { title: e.target.value })} />
                </Field>
                <Field label={t("objectives.description")} htmlFor={`${o.key}-desc`} className="sm:col-span-2">
                  <Textarea id={`${o.key}-desc`} rows={2} maxLength={2000} value={o.description} onChange={(e) => setObjective(i, { description: e.target.value })} />
                </Field>
                <PersonSelect id={`${o.key}-owner`} label={t("objectives.owner")} value={o.ownerId} onChange={(ownerId) => setObjective(i, { ownerId })} people={objectiveOwners} />
                <Field label={t("objectives.department")} htmlFor={`${o.key}-dept`}>
                  <Select id={`${o.key}-dept`} value={o.departmentId} onChange={(e) => setObjective(i, { departmentId: e.target.value })}>
                    <option value="">{t("objectives.noDepartment")}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("objectives.startDate")} htmlFor={`${o.key}-start`}>
                  <Input id={`${o.key}-start`} type="date" value={o.startDate} onChange={(e) => setObjective(i, { startDate: e.target.value })} />
                </Field>
                <Field label={t("objectives.targetDate")} htmlFor={`${o.key}-target`}>
                  <Input id={`${o.key}-target`} type="date" value={o.targetDate} onChange={(e) => setObjective(i, { targetDate: e.target.value })} />
                </Field>
              </div>

              <section className="grid gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 className="size-4" aria-hidden />
                  {t("objectives.kr.heading")}
                </h3>
                {o.keyResults.length === 0 ? <p className="text-sm text-muted-foreground">{t("objectives.kr.empty")}</p> : null}
                {o.keyResults.map((kr, k) => {
                  const bad = kr.include && krInvalid(kr);
                  return (
                    <div key={kr.key} className={cn("flex gap-2 rounded-md border p-2", !kr.include && "opacity-60")}>
                      <Include checked={kr.include} onChange={(include) => setKr(i, k, { include })} label={t("objectives.plan.include")} />
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_7rem_7rem_8rem]">
                        <Input aria-label={t("objectives.kr.title")} value={kr.title} maxLength={200} onChange={(e) => setKr(i, k, { title: e.target.value })} />
                        <Select
                          aria-label={t("objectives.kr.metric")}
                          value={kr.source === "METRIC" ? kr.metricKey : ""}
                          onChange={(e) => setKr(i, k, e.target.value ? { source: "METRIC", metricKey: e.target.value } : { source: "MANUAL", metricKey: "" })}
                        >
                          <option value="">{t("objectives.kr.sources.MANUAL")}</option>
                          {metrics.map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.label}
                            </option>
                          ))}
                        </Select>
                        <Input aria-label={t("objectives.kr.baseline")} type="number" step="any" value={kr.baseline} onChange={(e) => setKr(i, k, { baseline: e.target.value })} />
                        <Input aria-label={t("objectives.kr.target")} type="number" step="any" value={kr.target} onChange={(e) => setKr(i, k, { target: e.target.value })} aria-invalid={bad || undefined} />
                        <Select aria-label={t("objectives.kr.direction")} value={kr.direction} onChange={(e) => setKr(i, k, { direction: e.target.value as DraftKeyResult["direction"] })}>
                          <option value="INCREASE">{t("objectives.kr.directions.INCREASE")}</option>
                          <option value="DECREASE">{t("objectives.kr.directions.DECREASE")}</option>
                        </Select>
                        {kr.source === "MANUAL" ? (
                          <Input aria-label={t("objectives.kr.unit")} placeholder={t("objectives.kr.unit")} value={kr.unit} maxLength={30} onChange={(e) => setKr(i, k, { unit: e.target.value })} className="sm:col-span-2" />
                        ) : (
                          <p className="text-xs text-muted-foreground sm:col-span-2">{t(`objectives.kr.unitHint.${metrics.find((m) => m.key === kr.metricKey)?.unit ?? "count"}`)}</p>
                        )}
                        {kr.convertedFrom ? <p className="text-xs text-warning sm:col-span-3">{t("objectives.plan.metricConverted", { key: kr.convertedFrom })}</p> : null}
                        {bad ? <p className="text-xs text-danger sm:col-span-5">{t("objectives.plan.krDirectionInvalid")}</p> : null}
                      </div>
                    </div>
                  );
                })}
              </section>

              <section className="grid gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Flag className="size-4" aria-hidden />
                  {t("objectives.milestones")}
                </h3>
                {o.milestones.length === 0 ? <p className="text-sm text-muted-foreground">{t("objectives.noMilestones")}</p> : null}
                {o.milestones.map((m, mi) => (
                  <div key={m.key} className={cn("grid gap-3 rounded-md border p-3", !m.include && "opacity-60")}>
                    <div className="flex gap-2">
                      <Include checked={m.include} onChange={(include) => setMilestone(i, mi, { include })} label={t("objectives.plan.include")} />
                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                        <Input aria-label={t("objectives.milestone")} value={m.title} maxLength={200} onChange={(e) => setMilestone(i, mi, { title: e.target.value })} />
                        <Input aria-label={t("objectives.dueDate")} type="date" value={m.dueDate} onChange={(e) => setMilestone(i, mi, { dueDate: e.target.value })} />
                      </div>
                    </div>
                    {m.include && m.project && canCreateProjects ? (
                      <div className={cn("ms-6 grid gap-3 rounded-md border bg-surface-2 p-3", !m.project.include && "opacity-60")}>
                        <div className="flex gap-2">
                          <Include checked={m.project.include} onChange={(include) => setProject(i, mi, { include })} label={t("objectives.plan.include")} />
                          <div className="grid min-w-0 flex-1 gap-2">
                            <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                              <FolderKanban className="size-4" aria-hidden />
                              {t("objectives.project")}
                            </span>
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem_10rem]">
                              <Input aria-label={t("objectives.plan.projectName")} value={m.project.name} maxLength={120} onChange={(e) => setProject(i, mi, { name: e.target.value })} />
                              <Select aria-label={t("objectives.plan.projectOwner")} value={m.project.ownerId} onChange={(e) => setProject(i, mi, { ownerId: e.target.value })}>
                                <option value="">{t("objectives.plan.ownerMe")}</option>
                                {workPeople.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </Select>
                              <Input aria-label={t("objectives.dueDate")} type="date" value={m.project.dueDate} onChange={(e) => setProject(i, mi, { dueDate: e.target.value })} />
                            </div>
                            {m.project.suggestion ? <p className="text-xs text-muted-foreground">{t("objectives.plan.suggested", { value: m.project.suggestion })}</p> : null}
                          </div>
                        </div>
                        {m.project.include ? (
                          <ul className="grid gap-2">
                            {m.project.tasks.map((tk, ti) => (
                              <li key={tk.key} className={cn("flex gap-2", !tk.include && "opacity-60")}>
                                <Include checked={tk.include} onChange={(include) => setTask(i, mi, ti, { include })} label={t("objectives.plan.include")} />
                                <div className="grid min-w-0 flex-1 gap-1">
                                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem_9rem_7rem]">
                                    <span className="flex min-w-0 items-center gap-2">
                                      <ListChecks className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                      <Input aria-label={t("objectives.plan.taskTitle")} value={tk.title} maxLength={300} onChange={(e) => setTask(i, mi, ti, { title: e.target.value })} />
                                    </span>
                                    <Select aria-label={t("objectives.plan.assignee")} value={tk.assigneeId} onChange={(e) => setTask(i, mi, ti, { assigneeId: e.target.value })}>
                                      <option value="">{t("objectives.plan.unassigned")}</option>
                                      {workPeople.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}
                                        </option>
                                      ))}
                                    </Select>
                                    <Input aria-label={t("objectives.dueDate")} type="date" value={tk.dueDate} onChange={(e) => setTask(i, mi, ti, { dueDate: e.target.value })} />
                                    <Select aria-label={t("objectives.plan.priority")} value={tk.priority} onChange={(e) => setTask(i, mi, ti, { priority: e.target.value as DraftTask["priority"] })}>
                                      {PRIORITIES.map((p) => (
                                        <option key={p} value={p}>
                                          {t(`objectives.plan.priorities.${p}`)}
                                        </option>
                                      ))}
                                    </Select>
                                  </div>
                                  {tk.suggestion || tk.description ? <p className="text-xs text-muted-foreground">{[tk.description, tk.suggestion ? t("objectives.plan.suggested", { value: tk.suggestion }) : null].filter(Boolean).join(" · ")}</p> : null}
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </section>
            </CardBody>
          ) : (
            <CardBody className="text-sm text-muted-foreground">{o.title}</CardBody>
          )}
        </Card>
      ))}

      <Card className="sticky bottom-2 z-10">
        <CardBody className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm">{t("objectives.plan.summary", { objectives: counts.objectives, keyResults: counts.keyResults, milestones: counts.milestones, projects: counts.projects, tasks: counts.tasks })}</p>
          <Button onClick={apply} disabled={busy || counts.objectives === 0 || counts.invalid}>
            <CheckCircle2 aria-hidden />
            {busy ? t("objectives.plan.applying") : t("objectives.plan.apply")}
          </Button>
          {error ? (
            <div className="grid w-full gap-1">
              <FormError error={error} />
              {partial ? <p className="text-xs text-muted-foreground">{t("objectives.plan.partial", partial)}</p> : null}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
export type { DraftTask, DraftProject, DraftMilestone, DraftKeyResult, DraftObjective };
