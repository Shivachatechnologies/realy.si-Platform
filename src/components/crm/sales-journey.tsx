"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, Mail, PartyPopper, Search, Sparkles, UserPlus, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AiTaskCard, ChoiceCard, isActive, Stepper, type TaskView } from "./guided-kit";

/** Guided "Start selling" journey (8 steps). Server state comes in as props; every action calls the journey API. */

export interface JourneyView {
  step: number;
  completed: boolean;
  data: {
    style?: string;
    pipelineId?: string;
    icpInput?: string;
    icp?: string;
    leadId?: string;
    message?: { subject: string; body: string };
    sent?: { status: string; at: string; subject: string };
    followUpAt?: string;
    dealId?: string;
  };
  tasks: Partial<Record<"icp" | "find" | "research" | "next" | "draft" | "track", TaskView | null>>;
  candidates: { name: string; email?: string; company?: string; website?: string; reason?: string }[];
  draft: { subject: string; body: string } | null;
  lead: { id: string; name: string; email: string | null; account: string | null; stage: string; score: number; scoreLabel: string } | null;
  deal: { id: string; name: string; status: string; amount: string; stageId: string; stageName: string; stages: { id: string; name: string; type: string }[] } | null;
  addedLeads: { id: string; name: string; account: string | null }[];
  existingLeads: { id: string; name: string; account: string | null }[];
}

const STEPS = ["sell", "icp", "lead", "research", "next", "message", "send", "track"] as const;
const STYLES = { quick: 3, meetings: 4, long: 5 } as const;
type Style = keyof typeof STYLES;

export function SalesJourney({ base, locale, journey, canManage, aiReady }: { base: string; locale: string; journey: JourneyView; canManage: boolean; aiReady: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<ReactNode>(null);
  const step = Math.min(journey.step, STEPS.length - 1);
  const d = journey.data;

  const call = async <R,>(key: string, fn: () => Promise<R>, after?: (r: R) => void) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const r = await fn();
      after?.(r);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  const act = <R,>(key: string, body: Record<string, unknown>, after?: (r: R) => void) => call(key, () => api<R>(`${base}/crm/journey/actions?locale=${locale}`, { body }), after);
  const goto = (i: number) => call("goto", () => api(`${base}/crm/journey`, { method: "PATCH", body: { step: i } }));

  const done = (i: number) => {
    switch (STEPS[i]) {
      case "sell":
        return !!d.pipelineId || step > 0;
      case "icp":
        return !!d.icp;
      case "lead":
        return !!d.leadId;
      case "research":
        return journey.tasks.research?.status === "COMPLETED";
      case "next":
        return journey.tasks.next?.status === "COMPLETED";
      case "message":
        return !!d.message?.body;
      case "send":
        return d.sent?.status === "SENT" || !!d.followUpAt;
      case "track":
        return !!journey.deal;
    }
  };
  const doneCount = STEPS.filter((_, i) => done(i)).length;
  const s = (k: string, v?: Record<string, string | number>) => t(`sales.journey.${k}`, v);
  const needsAi = aiReady ? null : <Notice tone="warning">{s("aiNotReady")}</Notice>;
  const nav = ({ next, nextLabel, disabled }: { next?: () => void; nextLabel?: string; disabled?: boolean }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      {step > 0 ? (
        <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => void goto(step - 1)}>
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
          {s("back")}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {step < STEPS.length - 1 ? (
          <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => void goto(step + 1)}>
            {s("skip")}
          </Button>
        ) : null}
        {next ? (
          <Button type="button" size="sm" disabled={!!busy || disabled} onClick={next}>
            {nextLabel ?? s("continue")}
            <ArrowRight aria-hidden className="rtl:-scale-x-100" />
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (!canManage) return <Notice tone="warning">{s("noPermission")}</Notice>;

  return (
    <div className="grid gap-4">
      <Card variant="highlight">
        <CardBody className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{s("progress", { done: doneCount, total: STEPS.length })}</p>
            {journey.completed ? <Badge tone="success">{s("completed")}</Badge> : null}
          </div>
          <AnimatedProgress value={doneCount} max={STEPS.length} label={s("progress", { done: doneCount, total: STEPS.length })} />
          <Stepper steps={STEPS.map((k) => s(`steps.${k}`))} current={step} done={done} onSelect={(i) => void goto(i)} label={s("stepsLabel")} />
        </CardBody>
      </Card>

      <Card variant="elevated" className="animate-fade-up" key={step}>
        <CardBody className="grid gap-4">
          <header className="grid gap-1">
            <p className="text-[11px] font-semibold tracking-wide text-primary uppercase">{s("stepOf", { n: step + 1, total: STEPS.length })}</p>
            <h2 className="text-lg font-semibold tracking-tight">{s(`q.${STEPS[step]}`)}</h2>
            <p className="text-sm text-muted-foreground">{s(`why.${STEPS[step]}`)}</p>
          </header>

          {STEPS[step] === "sell" ? <SellStep busy={busy} current={d.style} hasPipeline={!!d.pipelineId} onApply={(body) => void act("pipeline", body)} /> : null}

          {STEPS[step] === "icp" ? (
            <IcpStep
              busy={busy}
              aiReady={aiReady}
              locale={locale}
              initialDescription={d.icpInput ?? ""}
              savedIcp={d.icp ?? ""}
              task={journey.tasks.icp ?? null}
              onAi={(description) => void act("icp_ai", { action: "icp_ai", description })}
              onSave={(icp, description) => void act("icp_save", { action: "icp_save", icp, description: description || undefined })}
            />
          ) : null}

          {STEPS[step] === "lead" ? (
            <LeadStep
              busy={busy}
              aiReady={aiReady}
              locale={locale}
              journey={journey}
              onAdd={(lead) => void act("add_lead", { action: "add_lead", lead })}
              onFind={(where) => void act("find_leads", { action: "find_leads", count: 10, where: where || undefined })}
              onAddMany={(leads) =>
                void act<{ created: number; skipped: string[] }>("add_leads", { action: "add_leads", leads }, (r) =>
                  setNote(
                    <Notice tone={r.created ? "success" : "warning"}>
                      {s("addedLeads", { count: r.created })}
                      {r.skipped.length ? ` ${s("skippedLeads", { names: r.skipped.join(", ") })}` : ""}
                    </Notice>,
                  ),
                )
              }
              onSelect={(leadId) => void act("select_lead", { action: "select_lead", leadId })}
            />
          ) : null}

          {["research", "next", "message", "send", "track"].includes(STEPS[step]) && !journey.lead ? (
            <Notice tone="warning" action={<Button size="sm" variant="secondary" onClick={() => void goto(2)}>{s("addCustomerFirst")}</Button>}>{s("needLead")}</Notice>
          ) : null}

          {journey.lead && ["research", "next", "message", "send", "track"].includes(STEPS[step]) ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-surface-2/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{s("workingOn")}</span>
              <Link href={`/${locale}/crm/${journey.lead.id}`} className="font-medium hover:underline">
                {journey.lead.name}
              </Link>
              {journey.lead.account ? <span className="text-muted-foreground">· {journey.lead.account}</span> : null}
              <Badge tone={journey.lead.scoreLabel === "HOT" ? "danger" : journey.lead.scoreLabel === "WARM" ? "warning" : "info"}>
                {t(`crm.scoreLabels.${journey.lead.scoreLabel}`)} · {journey.lead.score}
              </Badge>
            </div>
          ) : null}

          {STEPS[step] === "research" && journey.lead ? (
            <AiStep
              aiReady={aiReady}
              locale={locale}
              task={journey.tasks.research ?? null}
              busy={busy === "research"}
              icon={<Search aria-hidden />}
              label={s("researchStart")}
              againLabel={s("again")}
              onStart={() => void act("research", { action: "research" })}
            />
          ) : null}

          {STEPS[step] === "next" && journey.lead ? (
            <AiStep
              aiReady={aiReady}
              locale={locale}
              task={journey.tasks.next ?? null}
              busy={busy === "next_action"}
              icon={<Sparkles aria-hidden />}
              label={s("nextStart")}
              againLabel={s("again")}
              onStart={() => void act("next_action", { action: "next_action" })}
              footer={<p className="text-xs text-muted-foreground">{s("nextHint")}</p>}
            />
          ) : null}

          {STEPS[step] === "message" && journey.lead ? (
            <MessageStep
              key={`${journey.tasks.draft?.status}-${journey.tasks.draft?.id}`}
              busy={busy}
              aiReady={aiReady}
              locale={locale}
              task={journey.tasks.draft ?? null}
              initial={d.message ?? (journey.tasks.draft?.status === "COMPLETED" ? journey.draft : null) ?? { subject: "", body: "" }}
              onDraft={(tone) => void act("draft", { action: "draft", tone: tone || undefined })}
              onSave={(m) => void act("save_message", { action: "save_message", ...m }, () => void goto(step + 1))}
            />
          ) : null}

          {STEPS[step] === "send" && journey.lead ? (
            <SendStep
              busy={busy}
              locale={locale}
              email={journey.lead.email}
              leadId={journey.lead.id}
              message={d.message ?? journey.draft ?? { subject: "", body: "" }}
              sent={d.sent ?? null}
              followUpAt={d.followUpAt ?? null}
              onSend={(m) => void act("send", { action: "send", ...m })}
              onFollowUp={(f) => void act("follow_up", { action: "follow_up", ...f })}
            />
          ) : null}

          {STEPS[step] === "track" && journey.lead ? (
            <TrackStep
              busy={busy}
              aiReady={aiReady}
              locale={locale}
              deal={journey.deal}
              task={journey.tasks.track ?? null}
              completed={journey.completed}
              onTrack={(amount) => void act("track", { action: "track", amount: amount || undefined })}
              onWatch={() => void act("watch_deal", { action: "watch_deal" })}
              onComplete={() => void act("complete", { action: "complete" }, () => router.push(`/${locale}/sales`))}
            />
          ) : null}

          {note}
          <FormError error={error} />
          {STEPS[step] === "sell" || STEPS[step] === "icp" || STEPS[step] === "lead" ? null : needsAi}
          {nav({ next: step < STEPS.length - 1 ? () => void goto(step + 1) : undefined })}
        </CardBody>
      </Card>
    </div>
  );
}

function SellStep({ busy, current, hasPipeline, onApply }: { busy: string | null; current?: string; hasPipeline: boolean; onApply: (body: Record<string, unknown>) => void }) {
  const t = useT();
  const s = (k: string) => t(`sales.journey.${k}`);
  const [style, setStyle] = useState<Style>((current as Style) in STYLES ? (current as Style) : "meetings");
  const stages = Array.from({ length: STYLES[style] }, (_, i) => s(`styles.${style}.stage${i + 1}`));
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label={s("q.sell")}>
        {(Object.keys(STYLES) as Style[]).map((k) => (
          <ChoiceCard key={k} name="style" value={k} checked={style === k} onChange={(v) => setStyle(v as Style)} title={s(`styles.${k}.title`)} description={s(`styles.${k}.description`)} recommended={k === "meetings"} recommendedLabel={s("recommended")} />
        ))}
      </div>
      <div className="grid gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">{s("stagesPreview")}</p>
        <ol className="flex flex-wrap items-center gap-1.5 text-xs">
          {[...stages, s("won")].map((name, i, all) => (
            <li key={name} className="flex items-center gap-1.5">
              <span className={cn("rounded-full border px-2 py-0.5", i === all.length - 1 ? "border-success/40 bg-success/10 text-success" : "bg-surface")}>{name}</span>
              {i < all.length - 1 ? <ArrowRight aria-hidden className="size-3 text-muted-foreground rtl:-scale-x-100" /> : null}
            </li>
          ))}
        </ol>
      </div>
      {hasPipeline ? <Notice tone="success">{s("pipelineReady")}</Notice> : null}
      <div>
        <Button type="button" loading={busy === "pipeline"} disabled={!!busy} onClick={() => onApply({ action: "pipeline", style, name: s(`styles.${style}.pipeline`), stages, wonName: s("won"), lostName: s("lost") })}>
          <Wand2 aria-hidden />
          {hasPipeline ? s("continue") : s("setupPipeline")}
        </Button>
      </div>
    </div>
  );
}

function IcpStep({ busy, aiReady, locale, initialDescription, savedIcp, task, onAi, onSave }: {
  busy: string | null;
  aiReady: boolean;
  locale: string;
  initialDescription: string;
  savedIcp: string;
  task: TaskView | null;
  onAi: (description: string) => void;
  onSave: (icp: string, description: string) => void;
}) {
  const t = useT();
  const s = (k: string) => t(`sales.journey.${k}`);
  const [description, setDescription] = useState(initialDescription);
  const aiText = task?.status === "COMPLETED" ? (task.output ?? "") : "";
  const [icp, setIcp] = useState(savedIcp || aiText);
  const [seen, setSeen] = useState(aiText);
  if (aiText && aiText !== seen) {
    setSeen(aiText);
    if (!savedIcp) setIcp(aiText);
  }
  return (
    <div className="grid gap-3">
      <Field label={s("icpDescribe")} htmlFor="icp-desc" hint={s("icpExample")}>
        <Textarea id="icp-desc" rows={3} value={description} maxLength={3000} placeholder={s("icpPlaceholder")} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="gradient" disabled={!aiReady || description.trim().length < 10 || !!busy || isActive(task?.status)} loading={busy === "icp_ai"} onClick={() => onAi(description.trim())}>
          <Sparkles aria-hidden />
          {s("icpAi")}
        </Button>
        <Button type="button" variant="secondary" disabled={description.trim().length < 3 || !!busy} onClick={() => onSave(description.trim(), description.trim())}>
          {s("icpUseMine")}
        </Button>
      </div>
      <AiTaskCard task={task} locale={locale} maxChars={400} />
      {icp || savedIcp ? (
        <Field label={s("icpResult")} htmlFor="icp-result" hint={s("icpResultHint")}>
          <Textarea id="icp-result" rows={8} value={icp} maxLength={8000} onChange={(e) => setIcp(e.target.value)} />
        </Field>
      ) : null}
      {icp.trim() ? (
        <div>
          <Button type="button" loading={busy === "icp_save"} disabled={!!busy || icp.trim().length < 3} onClick={() => onSave(icp.trim(), description.trim())}>
            <CheckCircle2 aria-hidden />
            {s("icpSave")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function LeadStep({ busy, aiReady, locale, journey, onAdd, onFind, onAddMany, onSelect }: {
  busy: string | null;
  aiReady: boolean;
  locale: string;
  journey: JourneyView;
  onAdd: (lead: Record<string, string>) => void;
  onFind: (where: string) => void;
  onAddMany: (leads: Record<string, string | undefined>[]) => void;
  onSelect: (leadId: string) => void;
}) {
  const t = useT();
  const s = (k: string, v?: Record<string, string | number>) => t(`sales.journey.${k}`, v);
  const [mode, setMode] = useState<"self" | "ai">(journey.tasks.find ? "ai" : "self");
  const [form, setForm] = useState({ name: "", email: "", account: "", value: "", notes: "" });
  const [where, setWhere] = useState("");
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const choices = [...journey.addedLeads, ...journey.existingLeads.filter((l) => !journey.addedLeads.some((a) => a.id === l.id))];
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 md:grid-cols-2" role="radiogroup" aria-label={s("q.lead")}>
        <ChoiceCard name="leadmode" value="self" checked={mode === "self"} onChange={() => setMode("self")} title={s("leadSelf")} description={s("leadSelfHint")} recommended recommendedLabel={s("recommended")} />
        <ChoiceCard name="leadmode" value="ai" checked={mode === "ai"} onChange={() => setMode("ai")} title={s("leadAi")} description={s("leadAiHint")} />
      </div>
      {mode === "self" ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onAdd(Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())) as Record<string, string>);
          }}
        >
          <Field label={s("leadName")} htmlFor="j-name" hint={s("leadNameHint")}>
            <Input id="j-name" required maxLength={200} value={form.name} onChange={set("name")} />
          </Field>
          <Field label={t("crm.email")} htmlFor="j-email" hint={s("leadEmailHint")}>
            <Input id="j-email" type="email" maxLength={254} value={form.email} onChange={set("email")} />
          </Field>
          <Field label={s("leadCompany")} htmlFor="j-account">
            <Input id="j-account" maxLength={200} value={form.account} onChange={set("account")} />
          </Field>
          <Field label={s("leadValue")} htmlFor="j-value" hint={s("leadValueHint")}>
            <Input id="j-value" inputMode="decimal" pattern="^\d{1,12}(\.\d{1,2})?$" value={form.value} onChange={set("value")} />
          </Field>
          <Field label={s("leadNotes")} htmlFor="j-notes" className="sm:col-span-2">
            <Textarea id="j-notes" rows={2} maxLength={5000} value={form.notes} onChange={set("notes")} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy === "add_lead"} disabled={!!busy || !form.name.trim()}>
              <UserPlus aria-hidden />
              {s("leadAdd")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-3">
          {!aiReady ? <Notice tone="warning">{s("aiNotReady")}</Notice> : null}
          <Field label={s("findWhere")} htmlFor="j-where" hint={s("findWhereHint")}>
            <Input id="j-where" maxLength={300} value={where} onChange={(e) => setWhere(e.target.value)} />
          </Field>
          <div>
            <Button type="button" variant="gradient" disabled={!aiReady || !!busy || isActive(journey.tasks.find?.status)} loading={busy === "find_leads"} onClick={() => onFind(where.trim())}>
              <Search aria-hidden />
              {s("findStart")}
            </Button>
          </div>
          <AiTaskCard task={journey.tasks.find ?? null} locale={locale} maxChars={500} />
          {journey.tasks.find?.status === "COMPLETED" ? (
            journey.candidates.length ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium">{s("tickLeads")}</p>
                <ul className="grid gap-2">
                  {journey.candidates.map((c, i) => (
                    <li key={`${c.name}-${i}`}>
                      <label className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm", ticked.has(i) && "border-primary bg-primary/5")}>
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-primary"
                          checked={ticked.has(i)}
                          onChange={() =>
                            setTicked((x) => {
                              const n = new Set(x);
                              if (n.has(i)) n.delete(i);
                              else n.add(i);
                              return n;
                            })
                          }
                        />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="font-medium">
                            {c.name}
                            {c.company ? <span className="font-normal text-muted-foreground"> · {c.company}</span> : null}
                          </span>
                          {c.email || c.website ? <span className="truncate text-xs text-muted-foreground">{[c.email, c.website].filter(Boolean).join(" · ")}</span> : null}
                          {c.reason ? <span className="text-xs">{c.reason}</span> : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div>
                  <Button
                    type="button"
                    disabled={!ticked.size || !!busy}
                    loading={busy === "add_leads"}
                    onClick={() => onAddMany([...ticked].map((i) => journey.candidates[i]!).map((c) => ({ name: c.name, email: c.email, account: c.company, website: c.website, reason: c.reason })))}
                  >
                    <UserPlus aria-hidden />
                    {s("addTicked", { count: ticked.size })}
                  </Button>
                </div>
              </div>
            ) : (
              <Notice>{s("noCandidates")}</Notice>
            )
          ) : null}
        </div>
      )}
      {choices.length ? (
        <Field label={s("chooseLead")} htmlFor="j-choose" hint={s("chooseLeadHint")}>
          <Select id="j-choose" value={journey.data.leadId ?? ""} disabled={!!busy} onChange={(e) => e.target.value && onSelect(e.target.value)}>
            <option value="">{s("choose")}</option>
            {choices.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.account ? ` · ${l.account}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </div>
  );
}

function AiStep({ aiReady, locale, task, busy, icon, label, againLabel, onStart, footer }: { aiReady: boolean; locale: string; task: TaskView | null; busy: boolean; icon: ReactNode; label: string; againLabel: string; onStart: () => void; footer?: ReactNode }) {
  return (
    <div className="grid gap-3">
      <div>
        <Button type="button" variant={task ? "secondary" : "gradient"} disabled={!aiReady || busy || isActive(task?.status)} loading={busy} onClick={onStart}>
          {icon}
          {task ? againLabel : label}
        </Button>
      </div>
      <AiTaskCard task={task} locale={locale} />
      {footer}
    </div>
  );
}

function MessageStep({ busy, aiReady, locale, task, initial, onDraft, onSave }: {
  busy: string | null;
  aiReady: boolean;
  locale: string;
  task: TaskView | null;
  initial: { subject: string; body: string };
  onDraft: (tone: string) => void;
  onSave: (m: { subject: string; body: string }) => void;
}) {
  const t = useT();
  const s = (k: string) => t(`sales.journey.${k}`);
  const [tone, setTone] = useState("");
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label={s("tone")} htmlFor="j-tone" hint={s("toneHint")}>
          <Input id="j-tone" maxLength={200} value={tone} onChange={(e) => setTone(e.target.value)} />
        </Field>
        <Button type="button" variant="gradient" disabled={!aiReady || !!busy || isActive(task?.status)} loading={busy === "draft"} onClick={() => onDraft(tone.trim())}>
          <Sparkles aria-hidden />
          {task ? s("again") : s("draftStart")}
        </Button>
      </div>
      {isActive(task?.status) || task?.status === "FAILED" ? <AiTaskCard task={task} locale={locale} maxChars={300} /> : null}
      <Field label={s("subject")} htmlFor="j-subject">
        <Input id="j-subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label={s("body")} htmlFor="j-body" hint={s("bodyHint")}>
        <Textarea id="j-body" rows={10} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div>
        <Button type="button" disabled={!!busy || !subject.trim() || !body.trim()} loading={busy === "save_message"} onClick={() => onSave({ subject: subject.trim(), body: body.trim() })}>
          <CheckCircle2 aria-hidden />
          {s("saveMessage")}
        </Button>
      </div>
    </div>
  );
}

function SendStep({ busy, locale, email, leadId, message, sent, followUpAt, onSend, onFollowUp }: {
  busy: string | null;
  locale: string;
  email: string | null;
  leadId: string;
  message: { subject: string; body: string };
  sent: { status: string; at: string; subject: string } | null;
  followUpAt: string | null;
  onSend: (m: { subject: string; body: string }) => void;
  onFollowUp: (f: { dueAt: string; note: string }) => void;
}) {
  const t = useT();
  const s = (k: string, v?: Record<string, string>) => t(`sales.journey.${k}`, v);
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [due, setDue] = useState(() => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10));
  const [fnote, setFnote] = useState(s("followUpDefault"));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="grid content-start gap-3 rounded-lg border p-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Mail aria-hidden className="size-4 text-primary" />
          {s("sendTitle")}
        </h3>
        {email ? <p className="text-xs text-muted-foreground">{s("sendTo", { email })}</p> : <Notice tone="warning" action={<Link className="text-xs underline" href={`/${locale}/crm/${leadId}`}>{s("addEmail")}</Link>}>{s("noEmail")}</Notice>}
        <Field label={s("subject")} htmlFor="j-s-subject">
          <Input id="j-s-subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label={s("body")} htmlFor="j-s-body">
          <Textarea id="j-s-body" rows={7} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div>
          <Button type="button" disabled={!email || !!busy || !subject.trim() || !body.trim()} loading={busy === "send"} onClick={() => onSend({ subject: subject.trim(), body: body.trim() })}>
            <Mail aria-hidden />
            {s("sendNow")}
          </Button>
        </div>
        {sent ? (
          sent.status === "SENT" ? (
            <Notice tone="success">{s("sentOk", { subject: sent.subject })}</Notice>
          ) : sent.status === "NOT_CONFIGURED" ? (
            <Notice tone="warning" action={<Link href={`/${locale}/integrations`} className="text-xs underline">{s("connectEmail")}</Link>}>{s("sentNotConfigured")}</Notice>
          ) : (
            <Notice tone="danger">{s("sentFailed")}</Notice>
          )
        ) : null}
      </section>
      <section className="grid content-start gap-3 rounded-lg border p-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock aria-hidden className="size-4 text-primary" />
          {s("followTitle")}
        </h3>
        <p className="text-xs text-muted-foreground">{s("followHint")}</p>
        <Field label={s("followDate")} htmlFor="j-due">
          <Input id="j-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label={s("followNote")} htmlFor="j-fnote">
          <Input id="j-fnote" maxLength={1000} value={fnote} onChange={(e) => setFnote(e.target.value)} />
        </Field>
        <div>
          <Button type="button" variant="secondary" disabled={!!busy || !due || !fnote.trim()} loading={busy === "follow_up"} onClick={() => onFollowUp({ dueAt: due, note: fnote.trim() })}>
            <CalendarClock aria-hidden />
            {s("followSave")}
          </Button>
        </div>
        {followUpAt ? <Notice tone="success">{s("followDone", { date: followUpAt })}</Notice> : null}
      </section>
    </div>
  );
}

function TrackStep({ busy, aiReady, locale, deal, task, completed, onTrack, onWatch, onComplete }: {
  busy: string | null;
  aiReady: boolean;
  locale: string;
  deal: JourneyView["deal"];
  task: TaskView | null;
  completed: boolean;
  onTrack: (amount: string) => void;
  onWatch: () => void;
  onComplete: () => void;
}) {
  const t = useT();
  const s = (k: string) => t(`sales.journey.${k}`);
  const [amount, setAmount] = useState("");
  if (!deal) {
    return (
      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end">
        <Field label={s("dealAmount")} htmlFor="j-amount" hint={s("dealAmountHint")}>
          <Input id="j-amount" inputMode="decimal" pattern="^\d{1,12}(\.\d{1,3})?$" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Button type="button" loading={busy === "track"} disabled={!!busy} onClick={() => onTrack(amount.trim())}>
          {s("createDeal")}
        </Button>
      </div>
    );
  }
  const idx = deal.stages.findIndex((x) => x.id === deal.stageId);
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/${locale}/crm/deals/${deal.id}`} className="font-medium hover:underline">
            {deal.name}
          </Link>
          <span className="tabular-nums text-muted-foreground">{deal.amount}</span>
          <Badge tone={deal.status === "WON" ? "success" : deal.status === "LOST" ? "danger" : "accent"}>{deal.stageName}</Badge>
        </div>
        <ol className="flex flex-wrap gap-1 text-[11px]" aria-label={s("dealStages")}>
          {deal.stages
            .filter((x) => x.type === "OPEN" || x.id === deal.stageId)
            .map((x) => {
              const i = deal.stages.indexOf(x);
              return (
                <li key={x.id} className={cn("rounded-full border px-2 py-0.5", i < idx ? "border-success/40 bg-success/10 text-success" : i === idx ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>
                  {x.name}
                </li>
              );
            })}
        </ol>
        <p className="text-xs text-muted-foreground">{s("dealTracked")}</p>
      </div>
      <AiStep aiReady={aiReady} locale={locale} task={task} busy={busy === "watch_deal"} icon={<Sparkles aria-hidden />} label={s("watchDeal")} againLabel={s("again")} onStart={onWatch} />
      {completed ? (
        <Notice tone="success">{s("allDone")}</Notice>
      ) : (
        <div>
          <Button type="button" variant="gradient" loading={busy === "complete"} disabled={!!busy} onClick={onComplete}>
            <PartyPopper aria-hidden />
            {s("finish")}
          </Button>
        </div>
      )}
    </div>
  );
}
