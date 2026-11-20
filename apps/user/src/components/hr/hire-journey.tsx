"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Copy, PenLine, Sparkles, UserPlus } from "lucide-react";
import { FormError } from "@/components/form-error";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { isActive, useAgentTask, type LiveTask } from "@/components/guide-kit/use-agent-task";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const ROLE_EXAMPLES = ["sales", "developer", "bookkeeper", "support", "designer", "marketing"] as const;
const TYPES = ["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN"] as const;

/** Moves the journey pointer (PATCH hiring/:jobId) and re-renders the page on the new step. */
export function useStep(base: string, jobId: string) {
  const router = useRouter();
  return async (step: "describe" | "publish" | "candidates" | "interviews" | "hire" | "done") => {
    await api(`${base}/hr/hiring/${jobId}`, { method: "PATCH", body: { step } });
    router.replace(`?job=${jobId}`);
    router.refresh();
  };
}

export function NextStepButton({ base, jobId, step, label, variant = "default" }: { base: string; jobId: string; step: "describe" | "publish" | "candidates" | "interviews" | "hire" | "done"; label: string; variant?: "default" | "secondary" }) {
  const go = useStep(base, jobId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await go(step);
          } catch (e) {
            setError(e);
            setBusy(false);
          }
        }}
      >
        {label} <ArrowRight className="rtl:-scale-x-100" aria-hidden />
      </Button>
      <FormError error={error} />
    </span>
  );
}

/** Step 2: "What role do you need?" — plain questions with examples; creates the draft job and the journey. */
export function RoleStep({ base, departments }: { base: string; departments: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("FULL_TIME");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ jobId: string }>(`${base}/hr/hiring`, {
        method: "POST",
        body: {
          title,
          brief,
          employmentType: type,
          location: String(f.get("location") ?? ""),
          remote: f.get("remote") === "on",
          openings: Number(f.get("openings") || 1),
          departmentId: String(f.get("departmentId") ?? ""),
        },
      });
      router.push(`?job=${res.jobId}`);
      router.refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-5">
      <Field label={t("hr.hire.role.titleLabel")} htmlFor="hire-title" hint={t("hr.hire.role.titleHint")}>
        <Input id="hire-title" required minLength={2} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("hr.hire.role.titlePlaceholder")} />
      </Field>
      <div className="-mt-3 flex flex-wrap gap-1.5" aria-label={t("hr.hire.role.examples")}>
        {ROLE_EXAMPLES.map((k) => (
          <button
            key={k}
            type="button"
            className="rounded-full border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
            onClick={() => {
              setTitle(t(`hr.hire.role.example.${k}.title`));
              if (!brief) setBrief(t(`hr.hire.role.example.${k}.brief`));
            }}
          >
            {t(`hr.hire.role.example.${k}.title`)}
          </button>
        ))}
      </div>
      <Field label={t("hr.hire.role.briefLabel")} htmlFor="hire-brief" hint={t("hr.hire.role.briefHint")}>
        <Textarea id="hire-brief" required minLength={5} maxLength={3000} rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("hr.hire.role.briefPlaceholder")} />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">{t("hr.hire.role.typeLabel")}</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {TYPES.map((k) => (
            <label key={k} className={cn("hover-lift grid cursor-pointer gap-0.5 rounded-lg border p-3 text-sm", type === k ? "border-primary bg-primary/5 shadow-glow" : "")}>
              <span className="flex items-center gap-2">
                <input type="radio" name="employmentType" value={k} checked={type === k} onChange={() => setType(k)} className="accent-(--primary)" />
                <span className="font-medium">{t(`hr.hire.role.type.${k}.label`)}</span>
                {k === "FULL_TIME" ? <Badge tone="brand" shape="pill">{t("hr.hire.recommended")}</Badge> : null}
              </span>
              <span className="text-xs text-muted-foreground">{t(`hr.hire.role.type.${k}.hint`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_8rem] sm:items-end">
        <Field label={t("hr.hire.role.whereLabel")} htmlFor="hire-location" hint={t("hr.hire.role.whereHint")}>
          <Input id="hire-location" name="location" maxLength={160} placeholder={t("hr.hire.role.wherePlaceholder")} />
        </Field>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="remote" className="accent-(--primary)" /> {t("hr.hire.role.remote")}
        </label>
        <Field label={t("hr.hire.role.howMany")} htmlFor="hire-openings">
          <Input id="hire-openings" name="openings" type="number" min={1} max={50} defaultValue={1} />
        </Field>
      </div>
      {departments.length ? (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("hr.hire.advanced")}</summary>
          <div className="mt-3 max-w-sm">
            <Field label={t("hr.hire.role.department")} htmlFor="hire-dept">
              <Select id="hire-dept" name="departmentId" defaultValue="">
                <option value="">{t("hr.hire.role.noDepartment")}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </details>
      ) : null}
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {t("hr.hire.role.submit")} <ArrowRight className="rtl:-scale-x-100" aria-hidden />
        </Button>
        <span className="text-xs text-muted-foreground">{t("hr.hire.role.submitHint")}</span>
      </div>
    </form>
  );
}

/** Step 3: the AI writes the job description (real recruiter task); the person edits and saves it on the job. */
export function DescribeStep({ base, jobId, brief, description, initial, aiReady }: { base: string; jobId: string; brief: string; description: string; initial: LiveTask | null; aiReady: boolean }) {
  const { t, locale } = useI18n();
  const go = useStep(base, jobId);
  const { task, track } = useAgentTask(base, initial);
  const [text, setText] = useState(description);
  const [touched, setTouched] = useState(!!description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = isActive(task?.status);
  // Fill the editor with the AI draft once it is ready, unless the person already wrote something.
  const aiText = task?.status === "COMPLETED" ? (task.output ?? "") : "";
  const shown = !touched && aiText ? aiText : text;

  async function write() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<LiveTask>(`${base}/hr/hiring/${jobId}/describe`, { method: "POST" });
      track({ id: created.id, title: created.title, status: created.status, output: null });
      setTouched(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/hr/jobs/${jobId}`, { method: "PATCH", body: { description: shown } });
      await go("publish");
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4">
      <div className="rounded-md border bg-surface-2/60 p-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">{t("hr.hire.describe.youSaid")}</p>
        <p className="mt-1 whitespace-pre-wrap">{brief}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {aiReady ? (
          <Button type="button" onClick={write} disabled={busy || running} aria-busy={running}>
            <Sparkles aria-hidden /> {task ? t("hr.hire.describe.rewrite") : t("hr.hire.describe.write")}
          </Button>
        ) : (
          <Notice tone="warning">{t("hr.hire.aiNotReady")}</Notice>
        )}
        {task ? (
          <Link href={`/${locale}/tasks/${task.id}`} className="text-xs text-primary hover:underline">
            {t("hr.hire.openTask")}
          </Link>
        ) : null}
      </div>
      {running ? (
        <div className="grid gap-1" aria-live="polite">
          <AnimatedProgress label={t("hr.hire.describe.writing")} active />
          <p className="text-xs text-muted-foreground">{t("hr.hire.describe.writing")}</p>
        </div>
      ) : null}
      {task?.status === "FAILED" ? <Notice tone="danger">{task.errorMessage || t("hr.hire.describe.failed")}</Notice> : null}
      <Field label={t("hr.hire.describe.editorLabel")} htmlFor="hire-desc" hint={t("hr.hire.describe.editorHint")}>
        <Textarea
          id="hire-desc"
          rows={14}
          maxLength={20000}
          value={shown}
          onChange={(e) => {
            setTouched(true);
            setText(e.target.value);
          }}
          placeholder={t("hr.hire.describe.placeholder")}
        />
      </Field>
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={busy || !shown.trim()} aria-busy={busy}>
          <Check aria-hidden /> {t("hr.hire.describe.save")}
        </Button>
        {!shown.trim() ? <span className="text-xs text-muted-foreground">{t("hr.hire.describe.needText")}</span> : null}
      </div>
    </div>
  );
}

/** Step 4: publish (job status OPEN) and share the careers page link. */
export function PublishStep({ base, jobId, open, careersUrl }: { base: string; jobId: string; open: boolean; careersUrl: string }) {
  const { t } = useI18n();
  const go = useStep(base, jobId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-4">
      {open ? (
        <Notice tone="success" title={t("hr.hire.publish.liveTitle")}>
          {t("hr.hire.publish.liveBody")}
        </Notice>
      ) : (
        <p className="text-sm text-muted-foreground">{t("hr.hire.publish.explain")}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-surface-2/60 p-2 text-sm">
        <code className="min-w-0 flex-1 truncate px-1">{careersUrl}</code>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(careersUrl);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          <Copy aria-hidden /> {copied ? t("hr.hire.publish.copied") : t("hr.hire.publish.copy")}
        </Button>
        {open ? (
          <a href={careersUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
            {t("hr.hire.publish.view")}
          </a>
        ) : null}
      </div>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        {open ? (
          <NextStepButton base={base} jobId={jobId} step="candidates" label={t("hr.hire.publish.next")} />
        ) : (
          <Button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(`${base}/hr/jobs/${jobId}`, { method: "PATCH", body: { status: "OPEN" } });
                await go("candidates");
              } catch (e) {
                setError(e);
                setBusy(false);
              }
            }}
          >
            {t("hr.hire.publish.publish")} <ArrowRight className="rtl:-scale-x-100" aria-hidden />
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => go("describe")}>
          <PenLine aria-hidden /> {t("hr.hire.publish.edit")}
        </Button>
      </div>
    </div>
  );
}

/** Step 5: start AI screening of unscored applicants (real recruiter tasks; scores are saved after approval). */
export function ScreenButton({ base, jobId, unscored, active }: { base: string; jobId: string; unscored: number; active: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ started: number; alreadyRunning: number; remaining: number } | null>(null);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={unscored ? "default" : "secondary"}
          disabled={busy || !unscored}
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setResult(await api(`${base}/hr/hiring/${jobId}/screen`, { method: "POST" }));
              router.refresh();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Sparkles aria-hidden /> {t("hr.hire.candidates.screen", { count: unscored })}
        </Button>
        {active ? <Badge tone="info" pulse>{t("hr.hire.candidates.screening", { count: active })}</Badge> : null}
      </div>
      {result ? <p className="text-xs text-muted-foreground">{t("hr.hire.candidates.screenResult", { started: result.started, running: result.alreadyRunning, remaining: result.remaining })}</p> : null}
      <FormError error={error} />
    </div>
  );
}

/** Per-candidate quick actions in the journey: invite to an interview, or mark as not a fit. */
export function CandidateQuickActions({ base, candidateId, jobId, canInterview }: { base: string; candidateId: string; jobId: string; canInterview: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {canInterview ? (
        <Link href={`?job=${jobId}&step=interviews&candidate=${candidateId}`} className="rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10">
          {t("hr.hire.candidates.invite")}
        </Link>
      ) : null}
      <button
        type="button"
        disabled={busy}
        className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-danger"
        onClick={async () => {
          if (!window.confirm(t("hr.hire.candidates.rejectConfirm"))) return;
          setBusy(true);
          setError(null);
          try {
            await api(`${base}/hr/candidates/${candidateId}`, { method: "PATCH", body: { stage: "REJECTED" } });
            router.refresh();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("hr.hire.candidates.reject")}
      </button>
      {error ? <FormError error={error} /> : null}
    </span>
  );
}

/** Add an applicant by hand (someone who emailed a CV, a referral...). */
export function AddCandidateForm({ base, jobId }: { base: string; jobId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/hr/candidates`, {
        method: "POST",
        body: { jobId, firstName: String(f.get("firstName")), lastName: String(f.get("lastName") ?? ""), email: String(f.get("email")), source: String(f.get("source") || "manual"), coverLetter: String(f.get("coverLetter") ?? "") },
      });
      form.reset();
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label={t("hr.hire.candidates.firstName")} htmlFor="cand-first">
        <Input id="cand-first" name="firstName" required maxLength={100} />
      </Field>
      <Field label={t("hr.hire.candidates.lastName")} htmlFor="cand-last">
        <Input id="cand-last" name="lastName" maxLength={100} />
      </Field>
      <Field label={t("hr.hire.candidates.email")} htmlFor="cand-email">
        <Input id="cand-email" name="email" type="email" required maxLength={254} />
      </Field>
      <Field label={t("hr.hire.candidates.source")} htmlFor="cand-source">
        <Select id="cand-source" name="source" defaultValue="manual">
          {["manual", "referral", "linkedin", "agency", "other"].map((s) => (
            <option key={s} value={s}>
              {t(`hr.hire.candidates.sources.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("hr.hire.candidates.notes")} htmlFor="cand-notes" className="sm:col-span-2" hint={t("hr.hire.candidates.notesHint")}>
        <Textarea id="cand-notes" name="coverLetter" rows={3} maxLength={10000} />
      </Field>
      <div className="sm:col-span-2">
        <FormError error={error} />
        <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy}>
          <UserPlus aria-hidden /> {t("hr.hire.candidates.add")}
        </Button>
      </div>
    </form>
  );
}

const IV_TYPES = ["VIDEO", "PHONE", "ONSITE"] as const;

/** Step 6: simple interview scheduling — who, when, how, with whom. */
export function InterviewScheduler({ base, candidates, interviewers, preselect }: { base: string; candidates: { id: string; name: string }[]; interviewers: { id: string; name: string }[]; preselect?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [type, setType] = useState<(typeof IV_TYPES)[number]>("VIDEO");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const when = String(f.get("when") ?? "");
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const interviewer = String(f.get("interviewer") ?? "");
      await api(`${base}/hr/candidates/${String(f.get("candidate"))}/interviews`, {
        method: "POST",
        body: { scheduledAt: new Date(when).toISOString(), durationMin: Number(f.get("duration") || 45), type, location: String(f.get("location") ?? ""), interviewerIds: interviewer ? [interviewer] : [] },
      });
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  if (!candidates.length) return <p className="text-sm text-muted-foreground">{t("hr.hire.interviews.noCandidates")}</p>;
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("hr.hire.interviews.who")} htmlFor="iv-cand">
          <Select id="iv-cand" name="candidate" defaultValue={preselect && candidates.some((c) => c.id === preselect) ? preselect : candidates[0]!.id}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("hr.hire.interviews.when")} htmlFor="iv-when">
          <Input id="iv-when" name="when" type="datetime-local" required />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">{t("hr.hire.interviews.how")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {IV_TYPES.map((k) => (
            <label key={k} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm", type === k && "border-primary bg-primary/5")}>
              <input type="radio" name="ivtype" checked={type === k} onChange={() => setType(k)} className="accent-(--primary)" />
              {t(`hr.hire.interviews.types.${k}`)}
              {k === "VIDEO" ? <Badge tone="brand" shape="pill">{t("hr.hire.recommended")}</Badge> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("hr.hire.interviews.length")} htmlFor="iv-dur">
          <Select id="iv-dur" name="duration" defaultValue="45">
            {[30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {t("hr.hire.interviews.minutes", { count: m })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t(type === "ONSITE" ? "hr.hire.interviews.address" : "hr.hire.interviews.link")} htmlFor="iv-loc">
          <Input id="iv-loc" name="location" maxLength={300} placeholder={t(type === "ONSITE" ? "hr.hire.interviews.addressPlaceholder" : "hr.hire.interviews.linkPlaceholder")} />
        </Field>
        <Field label={t("hr.hire.interviews.interviewer")} htmlFor="iv-int">
          <Select id="iv-int" name="interviewer" defaultValue="">
            <option value="">{t("hr.hire.interviews.justMe")}</option>
            {interviewers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormError error={error} />
      {done ? <Notice tone="success">{t("hr.hire.interviews.scheduled")}</Notice> : null}
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {t("hr.hire.interviews.schedule")}
        </Button>
      </div>
    </form>
  );
}

export function InterviewStatusButtons({ base, interviewId }: { base: string; interviewId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const set = async (status: "COMPLETED" | "CANCELLED") => {
    setBusy(true);
    try {
      await api(`${base}/hr/interviews/${interviewId}`, { method: "PATCH", body: { status } });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex gap-1">
      <button type="button" disabled={busy} onClick={() => set("COMPLETED")} className="rounded-md px-2 py-1 text-xs text-success hover:bg-success/10">
        {t("hr.hire.interviews.markDone")}
      </button>
      <button type="button" disabled={busy} onClick={() => set("CANCELLED")} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
        {t("hr.hire.interviews.cancel")}
      </button>
    </span>
  );
}

/** Step 7: hire the chosen person (existing hire service: creates the employee and starts onboarding). */
export function HireForm({ base, jobId, candidates, managers }: { base: string; jobId: string; candidates: { id: string; name: string }[]; managers: { id: string; name: string }[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hired, setHired] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ employeeId: string }>(`${base}/hr/candidates/${String(f.get("candidate"))}/hire`, {
        method: "POST",
        body: { startDate: String(f.get("startDate") ?? ""), managerId: String(f.get("manager") ?? ""), note: String(f.get("note") ?? "") },
      });
      setHired(res.employeeId);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  if (hired) {
    return (
      <div className="grid gap-3">
        <Notice tone="success" title={t("hr.hire.hire.doneTitle")}>
          {t("hr.hire.hire.doneBody")}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Link href={`/${locale}/hr/employees/${hired}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
            {t("hr.hire.hire.openProfile")}
          </Link>
          <Link href={`/${locale}/hr/onboarding`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
            {t("hr.hire.hire.openOnboarding")}
          </Link>
          <NextStepButton base={base} jobId={jobId} step="done" label={t("hr.hire.hire.finish")} variant="secondary" />
        </div>
      </div>
    );
  }
  if (!candidates.length) return <p className="text-sm text-muted-foreground">{t("hr.hire.hire.noCandidates")}</p>;
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("hr.hire.hire.who")} htmlFor="hire-cand">
          <Select id="hire-cand" name="candidate" defaultValue={candidates[0]!.id}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("hr.hire.hire.start")} htmlFor="hire-start" hint={t("hr.hire.hire.startHint")}>
          <Input id="hire-start" name="startDate" type="date" />
        </Field>
        <Field label={t("hr.hire.hire.manager")} htmlFor="hire-mgr" hint={t("hr.hire.hire.managerHint")}>
          <Select id="hire-mgr" name="manager" defaultValue="">
            <option value="">{t("hr.hire.hire.noManager")}</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("hr.hire.hire.note")} htmlFor="hire-note">
        <Input id="hire-note" name="note" maxLength={2000} />
      </Field>
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy} aria-busy={busy}>
          <Check aria-hidden /> {t("hr.hire.hire.submit")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("hr.hire.hire.submitHint")}</span>
      </div>
    </form>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {label}
    </Link>
  );
}
