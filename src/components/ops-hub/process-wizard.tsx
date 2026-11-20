"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ClipboardList, Workflow } from "lucide-react";
import { FormError } from "@/components/form-error";
import { FlowSteps, ResumeNote, SavedIndicator } from "@/components/cockpit/flow-bits";
import { useGuidedDraft } from "@/components/cockpit/use-guided-draft";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Person = { id: string; name: string };
const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

function WizardShell({
  flowLabel,
  steps,
  d,
  reached,
  setReached,
  canNext,
  busy,
  onFinish,
  finishLabel,
  error,
  children,
}: {
  flowLabel: string;
  steps: string[];
  d: { step: number; setStep: (n: number) => void; saved: "idle" | "saving" | "saved" | "error"; resumed: boolean; clear: () => Promise<void> };
  reached: number;
  setReached: (fn: (n: number) => number) => void;
  canNext: boolean;
  busy: boolean;
  onFinish: () => void;
  finishLabel: string;
  error: unknown;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const go = (i: number) => {
    d.setStep(i);
    setReached((r) => Math.max(r, i));
  };
  const last = steps.length - 1;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FlowSteps steps={steps} current={d.step} reached={reached} onGo={go} label={flowLabel} />
        <SavedIndicator state={d.saved} />
      </div>
      {d.resumed && d.step > 0 ? <ResumeNote onReset={() => void d.clear().then(() => setReached(() => 0))} /> : null}
      <div className="animate-fade-up">{children}</div>
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-2">
        {d.step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => go(d.step - 1)}>
            <ArrowLeft aria-hidden className="rtl:-scale-x-100" /> {t("cockpit.back")}
          </Button>
        ) : null}
        {d.step < last ? (
          <Button type="button" onClick={() => go(d.step + 1)} disabled={!canNext}>
            {t("common.next")} <ArrowRight aria-hidden className="rtl:-scale-x-100" />
          </Button>
        ) : (
          <Button type="button" variant="gradient" onClick={onFinish} disabled={busy || !canNext} aria-busy={busy}>
            <Check aria-hidden /> {busy ? t("common.creating") : finishLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function TemplatePicker({ ids, value, onPick, prefix, icon }: { ids: string[]; value: string; onPick: (id: string) => void; prefix: string; icon: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onPick(id)}
          className={cn("hover-lift flex items-start gap-2 rounded-lg border bg-surface p-3 text-start text-sm", value === id && "border-primary ring-2 ring-primary/30")}
        >
          <span aria-hidden className="mt-0.5 text-primary [&_svg]:size-4">
            {icon}
          </span>
          <span className="grid gap-0.5">
            <span className="font-medium">{t(`${prefix}.${id}.title`)}</span>
            <span className="text-xs text-muted-foreground">{t(`${prefix}.${id}.hint`)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const PROCESS_TEMPLATES = ["customer_onboarding", "month_close", "refund", "new_hire", "publish_content", "custom"];

/** "Set up your first process": pick a routine → write the steps → choose an owner → a real, versioned process. */
export function ProcessWizard({ base, locale, people, draft }: { base: string; locale: string; people: Person[]; draft: { step: number; data: Record<string, unknown> } | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const defaults = useMemo(() => ({ template: "customer_onboarding", title: t("opsHub.processTemplates.customer_onboarding.title"), category: t("opsHub.processTemplates.customer_onboarding.category"), steps: t("opsHub.processTemplates.customer_onboarding.steps"), ownerId: "", description: "" }), [t]);
  const d = useGuidedDraft(base.replace(/\/work$/, ""), "ops.process", defaults, draft);
  const [reached, setReached] = useState(d.step);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const v = d.data;
  const stepList = lines(String(v.steps));
  const canNext = d.step === 0 ? !!String(v.title).trim() : d.step === 1 ? stepList.length > 0 : true;
  const pick = (id: string) =>
    d.patch(id === "custom" ? { template: id, title: "", category: "", steps: "" } : { template: id, title: t(`opsHub.processTemplates.${id}.title`), category: t(`opsHub.processTemplates.${id}.category`), steps: t(`opsHub.processTemplates.${id}.steps`) });

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const p = await api<{ id: string }>(`${base}/operations/processes`, {
        body: { title: String(v.title).trim(), category: String(v.category).trim() || null, description: String(v.description).trim() || null, ownerId: String(v.ownerId) || null, steps: stepList.slice(0, 200).map((title) => ({ title: title.slice(0, 300) })) },
      });
      await d.clear();
      router.push(`/${locale}/operations/processes/${p.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <WizardShell
      flowLabel={t("opsHub.process.title")}
      steps={[t("opsHub.process.steps.what"), t("opsHub.process.steps.how"), t("opsHub.process.steps.who")]}
      d={d}
      reached={reached}
      setReached={setReached}
      canNext={canNext}
      busy={busy}
      onFinish={finish}
      finishLabel={t("opsHub.process.create")}
      error={error}
    >
      {d.step === 0 ? (
        <div className="grid gap-3">
          <div>
            <h3 className="font-semibold">{t("opsHub.process.whatQ")}</h3>
            <p className="text-sm text-muted-foreground">{t("opsHub.process.whatHint")}</p>
          </div>
          <TemplatePicker ids={PROCESS_TEMPLATES} value={String(v.template)} onPick={pick} prefix="opsHub.processTemplates" icon={<Workflow />} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("work.ops.processTitle")} htmlFor="pw-title">
              <Input id="pw-title" value={String(v.title)} maxLength={200} onChange={(e) => d.set("title", e.target.value)} placeholder={t("opsHub.process.titlePlaceholder")} />
            </Field>
            <Field label={t("work.ops.category")} htmlFor="pw-cat" hint={t("opsHub.process.categoryHint")}>
              <Input id="pw-cat" value={String(v.category)} maxLength={80} onChange={(e) => d.set("category", e.target.value)} />
            </Field>
          </div>
        </div>
      ) : null}
      {d.step === 1 ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-2">
            <h3 className="font-semibold">{t("opsHub.process.howQ")}</h3>
            <p className="text-sm text-muted-foreground">{t("opsHub.process.howHint")}</p>
            <Textarea rows={10} value={String(v.steps)} onChange={(e) => d.set("steps", e.target.value)} aria-label={t("work.ops.steps")} placeholder={t("opsHub.process.stepsPlaceholder")} />
          </div>
          <ol className="grid content-start gap-1.5 rounded-lg border bg-surface-2/50 p-3 text-sm" aria-label={t("opsHub.process.preview")}>
            <li className="text-xs font-semibold text-muted-foreground">{t("opsHub.process.preview")}</li>
            {stepList.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {d.step === 2 ? (
        <div className="grid gap-3">
          <h3 className="font-semibold">{t("opsHub.process.whoQ")}</h3>
          <Field label={t("work.ops.owner")} htmlFor="pw-owner" hint={t("opsHub.process.ownerHint")}>
            <Select id="pw-owner" value={String(v.ownerId)} onChange={(e) => d.set("ownerId", e.target.value)}>
              <option value="">{t("work.none")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("opsHub.advanced")}</summary>
            <Field label={t("work.product.description")} htmlFor="pw-desc" className="mt-2">
              <Textarea id="pw-desc" rows={3} maxLength={5000} value={String(v.description)} onChange={(e) => d.set("description", e.target.value)} />
            </Field>
          </details>
          <p className="rounded-md bg-surface-2/60 p-3 text-sm">{t("opsHub.process.summary", { title: String(v.title), count: stepList.length })}</p>
        </div>
      ) : null}
    </WizardShell>
  );
}

const CHECKLIST_TEMPLATES = ["opening", "weekly_office", "month_end", "security", "website", "custom"];
const SCHEDULES = ["DAILY", "WEEKLY", "MONTHLY", "NONE"] as const;

/** "Set up your first checklist": what to check → the items → how often and who → a real recurring checklist. */
export function ChecklistWizard({ base, locale, people, draft }: { base: string; locale: string; people: Person[]; draft: { step: number; data: Record<string, unknown> } | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const defaults = useMemo(() => ({ template: "weekly_office", title: t("opsHub.checklistTemplates.weekly_office.title"), items: t("opsHub.checklistTemplates.weekly_office.items"), schedule: "WEEKLY", assigneeId: "", nextRunOn: "", description: "" }), [t]);
  const d = useGuidedDraft(base.replace(/\/work$/, ""), "ops.checklist", defaults, draft);
  const [reached, setReached] = useState(d.step);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const v = d.data;
  const items = lines(String(v.items));
  const canNext = d.step === 0 ? !!String(v.title).trim() : d.step === 1 ? items.length > 0 : true;
  const pick = (id: string) => d.patch(id === "custom" ? { template: id, title: "", items: "" } : { template: id, title: t(`opsHub.checklistTemplates.${id}.title`), items: t(`opsHub.checklistTemplates.${id}.items`) });

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const c = await api<{ id: string }>(`${base}/operations/checklists`, {
        body: { title: String(v.title).trim(), description: String(v.description).trim() || null, items: items.slice(0, 100).map((i) => i.slice(0, 300)), schedule: String(v.schedule), nextRunOn: String(v.nextRunOn) || null, assigneeId: String(v.assigneeId) || null },
      });
      await d.clear();
      router.push(`/${locale}/operations/checklists/${c.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <WizardShell
      flowLabel={t("opsHub.checklist.title")}
      steps={[t("opsHub.checklist.steps.what"), t("opsHub.checklist.steps.items"), t("opsHub.checklist.steps.when")]}
      d={d}
      reached={reached}
      setReached={setReached}
      canNext={canNext}
      busy={busy}
      onFinish={finish}
      finishLabel={t("opsHub.checklist.create")}
      error={error}
    >
      {d.step === 0 ? (
        <div className="grid gap-3">
          <div>
            <h3 className="font-semibold">{t("opsHub.checklist.whatQ")}</h3>
            <p className="text-sm text-muted-foreground">{t("opsHub.checklist.whatHint")}</p>
          </div>
          <TemplatePicker ids={CHECKLIST_TEMPLATES} value={String(v.template)} onPick={pick} prefix="opsHub.checklistTemplates" icon={<ClipboardList />} />
          <Field label={t("work.ops.checklistTitle")} htmlFor="cw-title">
            <Input id="cw-title" value={String(v.title)} maxLength={200} onChange={(e) => d.set("title", e.target.value)} />
          </Field>
        </div>
      ) : null}
      {d.step === 1 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <h3 className="font-semibold">{t("opsHub.checklist.itemsQ")}</h3>
            <p className="text-sm text-muted-foreground">{t("opsHub.checklist.itemsHint")}</p>
            <Textarea rows={10} value={String(v.items)} onChange={(e) => d.set("items", e.target.value)} aria-label={t("opsHub.checklist.steps.items")} />
          </div>
          <ul className="grid content-start gap-1.5 rounded-lg border bg-surface-2/50 p-3 text-sm" aria-label={t("opsHub.process.preview")}>
            <li className="text-xs font-semibold text-muted-foreground">{t("opsHub.process.preview")}</li>
            {items.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span aria-hidden className="mt-0.5 size-4 shrink-0 rounded border" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.step === 2 ? (
        <div className="grid gap-3">
          <h3 className="font-semibold">{t("opsHub.checklist.whenQ")}</h3>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("work.ops.schedule")}>
            {SCHEDULES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={v.schedule === s}
                onClick={() => d.set("schedule", s)}
                className={cn("rounded-full border px-3 py-1.5 text-sm", v.schedule === s ? "border-primary bg-accent font-medium" : "hover:bg-muted")}
              >
                {t(`work.ops.schedules.${s}`)}
                {s === "WEEKLY" ? <span className="ms-1 text-[10px] text-primary">· {t("opsHub.recommended")}</span> : null}
              </button>
            ))}
          </div>
          <Field label={t("work.task.assignee")} htmlFor="cw-who" hint={t("opsHub.checklist.whoHint")}>
            <Select id="cw-who" value={String(v.assigneeId)} onChange={(e) => d.set("assigneeId", e.target.value)}>
              <option value="">{t("work.none")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("opsHub.advanced")}</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {v.schedule !== "NONE" ? (
                <Field label={t("work.ops.nextRun")} htmlFor="cw-first" hint={t("opsHub.checklist.firstHint")}>
                  <Input id="cw-first" type="date" value={String(v.nextRunOn)} onChange={(e) => d.set("nextRunOn", e.target.value)} />
                </Field>
              ) : null}
              <Field label={t("work.product.description")} htmlFor="cw-desc">
                <Textarea id="cw-desc" rows={2} maxLength={2000} value={String(v.description)} onChange={(e) => d.set("description", e.target.value)} />
              </Field>
            </div>
          </details>
          <p className="rounded-md bg-surface-2/60 p-3 text-sm">{t("opsHub.checklist.summary", { title: String(v.title), count: items.length, schedule: t(`work.ops.schedules.${String(v.schedule)}`) })}</p>
        </div>
      ) : null}
    </WizardShell>
  );
}
