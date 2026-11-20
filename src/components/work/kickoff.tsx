"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, Flag, RefreshCw, Sparkles } from "lucide-react";
import { FormError } from "@/components/form-error";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { TypingText } from "@/components/motion/typing-text";
import { isActive, useAgentTask, type LiveTask } from "@/components/guide-kit/use-agent-task";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { parsePlan, type ProjectPlan } from "@/server/modules/work/kickoff-plan";

const EXAMPLES = ["website", "event", "launch", "office", "campaign"] as const;

/** Step 1: "What are you working on?" */
export function KickoffDescribe({ base, aiReady }: { base: string; aiReady: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ id: string }>(`${base}/work/kickoffs`, { method: "POST", body: { description: text, startDate: String(f.get("startDate") ?? ""), dueDate: String(f.get("dueDate") ?? "") } });
      router.push(`?k=${res.id}`);
      router.refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={t("work.start.describe.label")} htmlFor="ko-desc" hint={t("work.start.describe.hint")}>
        <Textarea id="ko-desc" rows={5} required minLength={10} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("work.start.describe.placeholder")} />
      </Field>
      <div className="-mt-2 flex flex-wrap gap-1.5" aria-label={t("work.start.describe.examples")}>
        {EXAMPLES.map((k) => (
          <button key={k} type="button" onClick={() => setText(t(`work.start.example.${k}`))} className="rounded-full border px-2.5 py-1 text-xs hover:border-primary hover:text-primary">
            {t(`work.start.exampleLabel.${k}`)}
          </button>
        ))}
      </div>
      <div className="grid max-w-lg gap-4 sm:grid-cols-2">
        <Field label={t("work.start.describe.start")} htmlFor="ko-start" hint={t("work.start.describe.startHint")}>
          <Input id="ko-start" name="startDate" type="date" />
        </Field>
        <Field label={t("work.start.describe.due")} htmlFor="ko-due" hint={t("work.start.describe.dueHint")}>
          <Input id="ko-due" name="dueDate" type="date" />
        </Field>
      </div>
      {!aiReady ? <Notice tone="warning">{t("work.start.aiNotReady")}</Notice> : null}
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy || !aiReady} aria-busy={busy}>
          <Sparkles aria-hidden /> {t("work.start.describe.submit")}
        </Button>
      </div>
    </form>
  );
}

interface EditTask {
  key: number;
  on: boolean;
  title: string;
  priority: ProjectPlan["tasks"][number]["priority"];
  offsetDays: number;
  durationDays: number;
  points?: number;
  description?: string;
  milestone?: string;
}

/** Step 2: follow the AI's plan task, then review/tick milestones and tasks and create the project. */
export function KickoffPlan({ base, kickoffId, initial, people, start }: { base: string; kickoffId: string; initial: LiveTask | null; people: { id: string; name: string }[]; start: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const reduced = useReducedMotion();
  const { task, track } = useAgentTask(base, initial);
  const plan = useMemo(() => (task?.status === "COMPLETED" ? parsePlan(task.output) : null), [task]);
  const running = isActive(task?.status);
  const [edits, setEdits] = useState<{ forTask: string; name: string; milestones: { title: string; offsetDays: number; on: boolean }[]; tasks: EditTask[] } | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const state =
    edits && edits.forTask === task?.id
      ? edits
      : plan && task
        ? { forTask: task.id, name: plan.name, milestones: plan.milestones.map((m) => ({ ...m, on: true })), tasks: plan.tasks.map((x, i) => ({ ...x, key: i, on: true })) }
        : null;

  const update = (fn: (s: NonNullable<typeof state>) => NonNullable<typeof state>) => state && setEdits(fn(structuredClone(state)));

  async function replan() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ taskId: string }>(`${base}/work/kickoffs/${kickoffId}/replan`, { method: "POST", body: { feedback: feedback.trim() || undefined } });
      track({ id: res.taskId, title: t("work.start.plan.revising"), status: "QUEUED", output: null });
      setEdits(null);
      setFeedback("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const milestones = state.milestones.filter((m) => m.on).map(({ title, offsetDays }) => ({ title, offsetDays }));
      const tasks = state.tasks.filter((x) => x.on && x.title.trim()).map((x) => ({ title: x.title, description: x.description, priority: x.priority, offsetDays: x.offsetDays, durationDays: x.durationDays, points: x.points, milestone: x.milestone }));
      await api(`${base}/work/kickoffs/${kickoffId}/apply`, { method: "POST", body: { name: state.name, milestones, tasks, memberIds: members } });
      router.refresh();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  if (!task) return <Notice tone="warning">{t("work.start.plan.noTask")}</Notice>;
  if (running) {
    return (
      <div className="grid gap-3" aria-live="polite">
        <TypingText text={t(task.status === "QUEUED" ? "work.start.plan.queued" : "work.start.plan.thinking")} className="text-sm" />
        <AnimatedProgress label={t("work.start.plan.thinking")} active />
        <Link href={`/${locale}/tasks/${task.id}`} className="text-xs text-primary hover:underline">
          {t("work.start.openTask")}
        </Link>
      </div>
    );
  }
  if (task.status !== "COMPLETED" || !state) {
    return (
      <div className="grid gap-3">
        <Notice tone="danger">{task.status === "COMPLETED" ? t("work.start.plan.unreadable") : task.errorMessage || t("work.start.plan.failed")}</Notice>
        <div>
          <Button type="button" onClick={replan} disabled={busy}>
            <RefreshCw aria-hidden /> {t("work.start.plan.tryAgain")}
          </Button>
        </div>
        <FormError error={error} />
      </div>
    );
  }

  const ticked = state.tasks.filter((x) => x.on).length;
  const groups = [...state.milestones.map((m, i) => ({ title: m.title, mi: i })), { title: "", mi: -1 }];
  const startDate = new Date(`${start}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const on = (d: number) => fmt.format(new Date(startDate.getTime() + d * 86_400_000));

  return (
    <div className="grid gap-5">
      {plan?.summary ? <p className="rounded-md border bg-surface-2/60 p-3 text-sm">{plan.summary}</p> : null}
      <Field label={t("work.start.plan.name")} htmlFor="ko-name">
        <Input id="ko-name" maxLength={120} value={state.name} onChange={(e) => update((s) => ({ ...s, name: e.target.value }))} />
      </Field>
      <p className="text-sm text-muted-foreground">{t("work.start.plan.reviewHint", { count: ticked })}</p>
      <div className="grid gap-3">
        {groups.map((g, gi) => {
          const items = state.tasks.filter((x) => (g.mi === -1 ? !x.milestone || !state.milestones.some((m) => m.title === x.milestone) : x.milestone === g.title));
          if (!items.length && g.mi === -1) return null;
          const ms = g.mi >= 0 ? state.milestones[g.mi]! : null;
          return (
            <motion.section
              key={`${g.title}-${gi}`}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.06 }}
              className={cn("rounded-lg border bg-surface p-3", ms && !ms.on && "opacity-60")}
            >
              <header className="mb-2 flex flex-wrap items-center gap-2">
                {ms ? (
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={ms.on} onChange={(e) => update((s) => ({ ...s, milestones: s.milestones.map((m, i) => (i === g.mi ? { ...m, on: e.target.checked } : m)) }))} className="accent-(--primary)" />
                    <Flag className="size-4 text-warning" aria-hidden /> {ms.title}
                  </label>
                ) : (
                  <span className="font-medium text-muted-foreground">{t("work.start.plan.otherTasks")}</span>
                )}
                {ms ? <Badge>{t("work.start.plan.byDate", { date: on(ms.offsetDays) })}</Badge> : null}
              </header>
              <ul className="grid gap-1.5">
                {items.map((x) => (
                  <li key={x.key} className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={x.title}
                      checked={x.on}
                      onChange={(e) => update((s) => ({ ...s, tasks: s.tasks.map((y) => (y.key === x.key ? { ...y, on: e.target.checked } : y)) }))}
                      className="accent-(--primary)"
                    />
                    <input
                      aria-label={t("work.start.plan.taskTitle")}
                      value={x.title}
                      maxLength={300}
                      onChange={(e) => update((s) => ({ ...s, tasks: s.tasks.map((y) => (y.key === x.key ? { ...y, title: e.target.value } : y)) }))}
                      className={cn("min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-ring focus:outline-none", !x.on && "line-through opacity-60")}
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {on(x.offsetDays)} · {t("work.start.plan.days", { count: x.durationDays })}
                    </span>
                    {x.priority === "HIGH" || x.priority === "URGENT" ? <Badge tone={x.priority === "URGENT" ? "danger" : "warning"}>{t(`work.priority.${x.priority}`)}</Badge> : null}
                  </li>
                ))}
              </ul>
            </motion.section>
          );
        })}
      </div>
      {people.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t("work.start.plan.team")}</legend>
          <div className="flex flex-wrap gap-2">
            {people.map((p) => (
              <label key={p.id} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", members.includes(p.id) && "border-primary bg-primary/5")}>
                <input type="checkbox" checked={members.includes(p.id)} onChange={(e) => setMembers((m) => (e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id)))} className="accent-(--primary)" />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={create} disabled={busy || !ticked || !state.name.trim()} aria-busy={busy}>
          <Check aria-hidden /> {t("work.start.plan.create", { count: ticked })}
        </Button>
        <Link href={`/${locale}/tasks/${task.id}`} className="text-xs text-primary hover:underline">
          {t("work.start.openTask")}
        </Link>
      </div>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("work.start.plan.changeTitle")}</summary>
        <div className="mt-3 grid gap-2">
          <Textarea rows={2} maxLength={1500} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t("work.start.plan.changePlaceholder")} aria-label={t("work.start.plan.changeTitle")} />
          <div>
            <Button type="button" variant="secondary" onClick={replan} disabled={busy}>
              <RefreshCw aria-hidden /> {t("work.start.plan.change")}
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

/** Step 3: assign people to the new tasks (with each person's current open work as a hint). */
export function KickoffAssign({ base, kickoffId, tasks, people }: { base: string; kickoffId: string; tasks: { id: string; title: string; assigneeId: string | null }[]; people: { id: string; name: string; open: number; overdue: number }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pick, setPick] = useState<Record<string, string>>(() => Object.fromEntries(tasks.map((x) => [x.id, x.assigneeId ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const extra = (id: string) => Object.values(pick).filter((v) => v === id).length;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/work/kickoffs/${kickoffId}/assign`, { method: "POST", body: { assignments: Object.entries(pick).map(([taskId, assigneeId]) => ({ taskId, assigneeId })), finish: true } });
      router.refresh();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4">
      {people.length ? (
        <div className="flex flex-wrap gap-2" aria-label={t("work.start.assign.loadLabel")}>
          {people.map((p) => {
            const load = p.open + extra(p.id);
            return (
              <span key={p.id} className={cn("rounded-full border px-2.5 py-1 text-xs tabular-nums", load > 12 ? "border-danger/40 text-danger" : load > 6 ? "border-warning/40 text-warning" : "")}>
                {p.name} · {t("work.start.assign.load", { count: load })}
              </span>
            );
          })}
        </div>
      ) : (
        <Notice tone="info">{t("work.start.assign.noPeople")}</Notice>
      )}
      <ul className="grid gap-1.5">
        {tasks.map((x) => (
          <li key={x.id} className="grid items-center gap-2 rounded-md border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_14rem]">
            <span className="truncate">{x.title}</span>
            <Select aria-label={t("work.start.assign.who", { task: x.title })} value={pick[x.id] ?? ""} onChange={(e) => setPick((m) => ({ ...m, [x.id]: e.target.value }))} className="h-8">
              <option value="">{t("work.start.assign.nobody")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={busy} aria-busy={busy}>
          {t("work.start.assign.save")} <ArrowRight className="rtl:-scale-x-100" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
