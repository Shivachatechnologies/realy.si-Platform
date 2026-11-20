"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BadgeDollarSign,
  Bell,
  Bot,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  FolderPlus,
  Handshake,
  LifeBuoy,
  Mail,
  Power,
  Save,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Condition, Definition, Step, Trigger } from "@/server/modules/automation/definition";

type Entity = "lead" | "deal" | "ticket" | null;
interface CondSpec {
  key: string;
  field: string;
  op: Condition["op"];
  /** "money" values are typed in major units and stored in minor units; "fixed" needs no input. */
  input: "number" | "money" | "text" | "fixed";
  value?: string;
}
interface TriggerSpec {
  key: string;
  icon: ReactNode;
  trigger: Trigger;
  entity: Entity;
  name: string;
  email?: string;
  conds: CondSpec[];
}

const TRIGGERS: TriggerSpec[] = [
  { key: "lead_created", icon: <UserPlus />, trigger: { type: "event", event: "lead.created", filters: [] }, entity: "lead", name: "{{event.data.name}}", email: "{{event.data.email}}", conds: [{ key: "scoreAbove", field: "event.data.score", op: "gt", input: "number" }, { key: "sourceIs", field: "event.data.source", op: "contains", input: "text" }] },
  { key: "deal_won", icon: <Handshake />, trigger: { type: "event", event: "deal.won", filters: [] }, entity: "deal", name: "{{event.data.name}}", conds: [{ key: "amountAbove", field: "event.data.amountMinor", op: "gt", input: "money" }] },
  { key: "invoice_overdue", icon: <FileWarning />, trigger: { type: "event", event: "invoice.overdue", filters: [] }, entity: null, name: "{{event.data.number}} · {{event.data.customerName}}", conds: [{ key: "balanceAbove", field: "event.data.balanceMinor", op: "gt", input: "money" }] },
  { key: "payment_received", icon: <Wallet />, trigger: { type: "event", event: "payment.received", filters: [] }, entity: null, name: "{{event.data.invoiceNumber}}", conds: [{ key: "amountAbove", field: "event.data.amountMinor", op: "gt", input: "money" }] },
  { key: "ticket_created", icon: <LifeBuoy />, trigger: { type: "event", event: "ticket.created", filters: [] }, entity: "ticket", name: "#{{event.data.number}} {{event.data.subject}}", conds: [{ key: "urgent", field: "event.data.priority", op: "eq", input: "fixed", value: "URGENT" }, { key: "unhappy", field: "event.data.sentiment", op: "eq", input: "fixed", value: "negative" }] },
  { key: "customer_created", icon: <BadgeDollarSign />, trigger: { type: "event", event: "customer.created", filters: [] }, entity: null, name: "{{event.data.name}}", conds: [] },
  { key: "candidate_applied", icon: <Users />, trigger: { type: "event", event: "candidate.applied", filters: [] }, entity: null, name: "{{event.data.name}} · {{event.data.jobTitle}}", email: "{{event.data.email}}", conds: [{ key: "jobIs", field: "event.data.jobTitle", op: "contains", input: "text" }] },
  { key: "employee_joined", icon: <UserCheck />, trigger: { type: "event", event: "employee.joined", filters: [] }, entity: null, name: "{{event.data.name}}", conds: [] },
  { key: "task_completed", icon: <CheckCircle2 />, trigger: { type: "event", event: "task.completed", filters: [] }, entity: null, name: "{{event.data.title}}", conds: [] },
  { key: "form_submitted", icon: <ClipboardCheck />, trigger: { type: "event", event: "form.submitted", filters: [] }, entity: null, name: "{{event.data.name}}", email: "{{event.data.email}}", conds: [] },
  { key: "monday", icon: <CalendarClock />, trigger: { type: "schedule", schedule: { kind: "weekly", day: 1, time: "09:00" }, filters: [] }, entity: null, name: "", conds: [] },
  { key: "daily", icon: <CalendarClock />, trigger: { type: "schedule", schedule: { kind: "daily", time: "08:00" }, filters: [] }, entity: null, name: "", conds: [] },
];

type ActionKey = "assign" | "task" | "notify" | "ai" | "email" | "project";
const ACTIONS: { key: ActionKey; icon: ReactNode }[] = [
  { key: "assign", icon: <UserCheck /> },
  { key: "task", icon: <ClipboardCheck /> },
  { key: "notify", icon: <Bell /> },
  { key: "ai", icon: <Bot /> },
  { key: "email", icon: <Mail /> },
  { key: "project", icon: <FolderPlus /> },
];

interface ActionState {
  key: ActionKey;
  person: string;
  title: string;
  dueInDays: number;
  profile: string;
  instructions: string;
  to: string;
  subject: string;
  body: string;
}

function Card({ active, onClick, icon, title, hint, badge, disabled }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; hint?: string; badge?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "hover-lift grid content-start gap-1 rounded-lg border p-3 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active ? "border-primary bg-primary/5 shadow-glow" : "bg-surface",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("grid size-7 place-items-center rounded-md [&_svg]:size-4", active ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground")}>{icon}</span>
        <span className="font-medium">{title}</span>
        {badge}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

/**
 * Automation without technical terms: pick what happens (trigger card), optionally "only if…", then what Realy.si should
 * do (action cards). The choices become a regular workflow definition, validated and published by the server.
 */
export function SimpleBuilder({ base, users, profiles, meId, currency }: { base: string; users: { id: string; name: string }[]; profiles: { key: string; name: string }[]; meId: string; currency: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const reduced = useReducedMotion();
  const [trig, setTrig] = useState<TriggerSpec | null>(null);
  const [scheduleDay, setScheduleDay] = useState(1);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [conds, setConds] = useState<Record<string, string | boolean>>({});
  const [actions, setActions] = useState<ActionState[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<false | "on" | "draft">(false);
  const [error, setError] = useState<unknown>(null);

  const freshAction = (key: ActionKey, spec: TriggerSpec | null): ActionState => ({
    key,
    person: meId,
    title: spec?.name ? t("workflows.simple.defaults.taskTitle", { name: spec.name }) : t("workflows.simple.defaults.weeklyTask"),
    dueInDays: 1,
    profile: profiles[0]?.key ?? "",
    instructions: "",
    to: spec?.email ?? "",
    subject: "",
    body: "",
  });

  const toggleAction = (key: ActionKey) => setActions((a) => (a.some((x) => x.key === key) ? a.filter((x) => x.key !== key) : [...a, freshAction(key, trig)]));
  const patch = (key: ActionKey, v: Partial<ActionState>) => setActions((a) => a.map((x) => (x.key === key ? { ...x, ...v } : x)));

  const definition = useMemo<Definition | null>(() => {
    if (!trig || !actions.length) return null;
    const trigger: Trigger =
      trig.trigger.type === "schedule"
        ? { type: "schedule", schedule: trig.key === "monday" ? { kind: "weekly", day: scheduleDay, time: scheduleTime } : { kind: "daily", time: scheduleTime }, filters: [] }
        : trig.trigger;
    const filters: Condition[] = [];
    for (const c of trig.conds) {
      const v = conds[c.key];
      if (c.input === "fixed") {
        if (v === true) filters.push({ field: c.field, op: c.op, value: c.value });
      } else if (typeof v === "string" && v.trim()) {
        filters.push({ field: c.field, op: c.op, value: c.input === "money" ? String(Math.round(Number(v) * 100)) : v.trim() });
      }
    }
    const steps: Step[] = [];
    const ctx = trig.name ? ` (${trig.name})` : "";
    actions.forEach((a, i) => {
      const id = `${a.key}_${i + 1}`;
      if (a.key === "assign" && trig.entity) steps.push({ id, type: "action", action: { kind: "assign_user", entity: trig.entity, recordId: "{{event.entityId}}", userId: a.person } });
      if (a.key === "task") steps.push({ id, type: "action", action: { kind: "create_task", title: a.title || t("workflows.simple.defaults.weeklyTask"), assigneeId: a.person || undefined, priority: "MEDIUM", dueInDays: a.dueInDays } });
      if (a.key === "notify") steps.push({ id, type: "action", action: { kind: "notify", recipients: "users", userIds: [a.person || meId], title: (a.title || t(`workflows.simple.triggers.${trig.key}.title`)) + ctx } });
      if (a.key === "ai")
        steps.push({
          id,
          type: "action",
          action: {
            kind: "assign_ai_employee",
            profile: a.profile,
            title: `${t(`workflows.simple.triggers.${trig.key}.title`)}${ctx}`.slice(0, 200),
            instructions: `${a.instructions || t("workflows.simple.defaults.aiInstructions")}\n\nContext: event {{event.type}} for record {{event.entityId}}. Details: {{event.data}}`,
            wait: false,
          },
        });
      if (a.key === "email") {
        steps.push({ id: `${id}_ok`, type: "action", action: { kind: "request_approval", title: t("workflows.simple.defaults.approveEmail", { to: a.to }), approverMode: "users", approverIds: [a.person || meId], escalateToIds: [] } });
        steps.push({ id, type: "action", action: { kind: "send_email", to: a.to, subject: a.subject, body: a.body } });
      }
      if (a.key === "project") steps.push({ id, type: "action", action: { kind: "create_project", name: (a.title || trig.name || t("workflows.simple.defaults.projectName")).slice(0, 120), template: "", ownerId: a.person || undefined, memberIds: [], dueInDays: 30 } });
    });
    return { trigger: trigger.type === "event" ? { ...trigger, filters } : trigger, variables: [], steps };
  }, [trig, actions, conds, scheduleDay, scheduleTime, meId, t]);

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? t("workflows.simple.me");
  const sentence = useMemo(() => {
    if (!trig) return "";
    const when = trig.key === "monday" ? t("workflows.simple.sentence.weekly", { day: t(`workflows.simple.days.${scheduleDay}`), time: scheduleTime }) : trig.key === "daily" ? t("workflows.simple.sentence.daily", { time: scheduleTime }) : t(`workflows.simple.triggers.${trig.key}.when`);
    const onlyIf = trig.conds
      .filter((c) => (c.input === "fixed" ? conds[c.key] === true : typeof conds[c.key] === "string" && (conds[c.key] as string).trim()))
      .map((c) => t(`workflows.simple.conds.${c.key}.sentence`, { value: String(conds[c.key]), currency }));
    const then = actions.map((a) =>
      t(`workflows.simple.actions.${a.key}.sentence`, { person: userName(a.person), title: a.title, to: a.to || "?", profile: profiles.find((p) => p.key === a.profile)?.name ?? a.profile }),
    );
    return [when, onlyIf.length ? `${t("workflows.simple.sentence.onlyIf")} ${onlyIf.join(` ${t("workflows.simple.sentence.and")} `)}` : "", then.length ? `${t("workflows.simple.sentence.then")} ${then.join(", ")}.` : ""].filter(Boolean).join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trig, conds, actions, scheduleDay, scheduleTime, currency, t]);

  const emailIncomplete = actions.some((a) => a.key === "email" && (!a.to.trim() || !a.subject.trim() || !a.body.trim()));
  const ready = !!definition && !emailIncomplete;

  async function submit(activate: boolean) {
    if (!definition) return;
    setBusy(activate ? "on" : "draft");
    setError(null);
    try {
      const res = await api<{ id: string }>(`${base}/workflows/simple`, { method: "POST", body: { name: name.trim() || sentence.slice(0, 150) || t("workflows.simple.defaults.name"), description: sentence.slice(0, 2000), definition, activate } });
      router.push(`/${locale}/workflows/${res.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const section = (n: number, title: string, hint: string, body: ReactNode, show = true) =>
    show ? (
      <motion.section initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="grid gap-3">
        <header className="flex items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-primary-foreground shadow-glow">{n}</span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground">{hint}</p>
          </div>
        </header>
        <div className="ps-0 sm:ps-10">{body}</div>
      </motion.section>
    ) : null;

  return (
    <div className="grid gap-8">
      {section(
        1,
        t("workflows.simple.whenTitle"),
        t("workflows.simple.whenHint"),
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {TRIGGERS.map((x) => (
              <Card
                key={x.key}
                active={trig?.key === x.key}
                onClick={() => {
                  setTrig(x);
                  setConds({});
                  setActions((a) => a.filter((y) => y.key !== "assign" || x.entity).map((y) => ({ ...y, to: x.email ?? y.to })));
                  if (x.key === "daily") setScheduleTime("08:00");
                  if (x.key === "monday") setScheduleTime("09:00");
                }}
                icon={x.icon}
                title={t(`workflows.simple.triggers.${x.key}.title`)}
                hint={t(`workflows.simple.triggers.${x.key}.hint`)}
                badge={x.key === "lead_created" ? <Badge tone="brand" shape="pill">{t("workflows.simple.popular")}</Badge> : undefined}
              />
            ))}
          </div>
          {trig?.trigger.type === "schedule" ? (
            <div className="flex flex-wrap gap-3">
              {trig.key === "monday" ? (
                <Field label={t("workflows.simple.day")} htmlFor="sb-day">
                  <Select id="sb-day" value={scheduleDay} onChange={(e) => setScheduleDay(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <option key={d} value={d}>
                        {t(`workflows.simple.days.${d}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field label={t("workflows.simple.time")} htmlFor="sb-time">
                <Input id="sb-time" type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value || "09:00")} />
              </Field>
            </div>
          ) : null}
        </div>,
      )}

      {section(
        2,
        t("workflows.simple.ifTitle"),
        t("workflows.simple.ifHint"),
        trig && trig.conds.length ? (
          <div className="grid gap-2">
            {trig.conds.map((c) => (
              <label key={c.key} className="flex flex-wrap items-center gap-2 text-sm">
                {c.input === "fixed" ? (
                  <>
                    <input type="checkbox" checked={conds[c.key] === true} onChange={(e) => setConds((m) => ({ ...m, [c.key]: e.target.checked }))} className="accent-(--primary)" />
                    {t(`workflows.simple.conds.${c.key}.label`)}
                  </>
                ) : (
                  <>
                    <span className="min-w-48">{t(`workflows.simple.conds.${c.key}.label`, { currency })}</span>
                    <Input
                      className="h-8 w-40"
                      type={c.input === "text" ? "text" : "number"}
                      min={0}
                      maxLength={100}
                      value={typeof conds[c.key] === "string" ? (conds[c.key] as string) : ""}
                      onChange={(e) => setConds((m) => ({ ...m, [c.key]: e.target.value }))}
                      placeholder={t("workflows.simple.optional")}
                    />
                  </>
                )}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{trig ? t("workflows.simple.noConds") : t("workflows.simple.pickTriggerFirst")}</p>
        ),
        !!trig,
      )}

      {section(
        3,
        t("workflows.simple.thenTitle"),
        t("workflows.simple.thenHint"),
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ACTIONS.map((a) => (
              <Card
                key={a.key}
                active={actions.some((x) => x.key === a.key)}
                onClick={() => toggleAction(a.key)}
                icon={a.icon}
                title={t(`workflows.simple.actions.${a.key}.title`)}
                hint={a.key === "assign" && !trig?.entity ? t("workflows.simple.actions.assign.unavailable") : t(`workflows.simple.actions.${a.key}.hint`)}
                disabled={a.key === "assign" && !trig?.entity}
                badge={a.key === "email" ? <Badge tone="warning">{t("workflows.simple.approval")}</Badge> : undefined}
              />
            ))}
          </div>
          <AnimatePresence initial={false}>
            {actions.map((a) => (
              <motion.div key={a.key} initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={reduced ? undefined : { opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="grid gap-3 rounded-lg border bg-surface-2/50 p-3 sm:grid-cols-2">
                  <p className="text-sm font-medium sm:col-span-2">{t(`workflows.simple.actions.${a.key}.title`)}</p>
                  {a.key !== "ai" ? (
                    <Field label={t(a.key === "email" ? "workflows.simple.fields.approver" : a.key === "project" ? "workflows.simple.fields.owner" : "workflows.simple.fields.person")} htmlFor={`sb-${a.key}-p`}>
                      <Select id={`sb-${a.key}-p`} value={a.person} onChange={(e) => patch(a.key, { person: e.target.value })}>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.id === meId ? `${u.name} (${t("workflows.simple.me")})` : u.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : (
                    <Field label={t("workflows.simple.fields.aiWho")} htmlFor="sb-ai-p">
                      <Select id="sb-ai-p" value={a.profile} onChange={(e) => patch("ai", { profile: e.target.value })}>
                        {profiles.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {a.key === "task" || a.key === "notify" || a.key === "project" ? (
                    <Field label={t(a.key === "project" ? "workflows.simple.fields.projectName" : a.key === "notify" ? "workflows.simple.fields.message" : "workflows.simple.fields.taskTitle")} htmlFor={`sb-${a.key}-t`} hint={trig?.name ? t("workflows.simple.fields.placeholderHint") : undefined}>
                      <Input id={`sb-${a.key}-t`} maxLength={200} value={a.title} onChange={(e) => patch(a.key, { title: e.target.value })} />
                    </Field>
                  ) : null}
                  {a.key === "task" ? (
                    <Field label={t("workflows.simple.fields.due")} htmlFor="sb-task-d">
                      <Select id="sb-task-d" value={a.dueInDays} onChange={(e) => patch("task", { dueInDays: Number(e.target.value) })}>
                        {[0, 1, 2, 3, 7, 14].map((d) => (
                          <option key={d} value={d}>
                            {t("workflows.simple.fields.dueIn", { count: d })}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                  {a.key === "ai" ? (
                    <Field label={t("workflows.simple.fields.aiWhat")} htmlFor="sb-ai-i" className="sm:col-span-2">
                      <Textarea id="sb-ai-i" rows={2} maxLength={4000} value={a.instructions} onChange={(e) => patch("ai", { instructions: e.target.value })} placeholder={t("workflows.simple.fields.aiPlaceholder")} />
                    </Field>
                  ) : null}
                  {a.key === "email" ? (
                    <>
                      <Field label={t("workflows.simple.fields.to")} htmlFor="sb-em-to" hint={trig?.email ? t("workflows.simple.fields.toHint") : undefined}>
                        <Input id="sb-em-to" maxLength={500} value={a.to} onChange={(e) => patch("email", { to: e.target.value })} placeholder="name@example.com" />
                      </Field>
                      <Field label={t("workflows.simple.fields.subject")} htmlFor="sb-em-s">
                        <Input id="sb-em-s" maxLength={300} value={a.subject} onChange={(e) => patch("email", { subject: e.target.value })} />
                      </Field>
                      <Field label={t("workflows.simple.fields.body")} htmlFor="sb-em-b" className="sm:col-span-2">
                        <Textarea id="sb-em-b" rows={4} maxLength={10000} value={a.body} onChange={(e) => patch("email", { body: e.target.value })} />
                      </Field>
                      <p className="text-xs text-muted-foreground sm:col-span-2">{t("workflows.simple.fields.emailNote")}</p>
                    </>
                  ) : null}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        !!trig,
      )}

      {section(
        4,
        t("workflows.simple.summaryTitle"),
        t("workflows.simple.summaryHint"),
        <div className="grid gap-4">
          <div className="rounded-lg border-gradient p-4 text-base shadow-glow [--gradient-fill:linear-gradient(135deg,color-mix(in_oklch,var(--primary)_7%,var(--surface)),var(--surface))]" aria-live="polite">
            {sentence || <span className="text-muted-foreground">{t("workflows.simple.summaryEmpty")}</span>}
          </div>
          <Field label={t("workflows.simple.name")} htmlFor="sb-name" hint={t("workflows.simple.nameHint")}>
            <Input id="sb-name" maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {emailIncomplete ? <Notice tone="warning">{t("workflows.simple.emailIncomplete")}</Notice> : null}
          <FormError error={error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="lg" onClick={() => submit(true)} disabled={!ready || !!busy} aria-busy={busy === "on"}>
              <Power aria-hidden /> {t("workflows.simple.turnOn")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => submit(false)} disabled={!ready || !!busy} aria-busy={busy === "draft"}>
              <Save aria-hidden /> {t("workflows.simple.saveDraft")}
            </Button>
          </div>
        </div>,
        !!trig && actions.length > 0,
      )}
    </div>
  );
}

/** "Describe it and AI builds it": creates the workflow and an automation-architect task that writes its draft. */
export function DescribeIt({ base, aiReady }: { base: string; aiReady: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!aiReady) return <Notice tone="warning">{t("workflows.simple.describeNotReady")}</Notice>;
  return (
    <div className="grid gap-3">
      <Textarea rows={3} minLength={10} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("workflows.simple.describePlaceholder")} aria-label={t("workflows.simple.describeTitle")} />
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={busy || text.trim().length < 10}
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await api<{ id: string }>(`${base}/workflows/describe`, { method: "POST", body: { description: text } });
              router.push(`/${locale}/workflows/${res.id}`);
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          <Sparkles aria-hidden /> {t("workflows.simple.describeGo")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("workflows.simple.describeNote")}</span>
      </div>
      <Link href={`/${locale}/workflows/templates`} className="text-xs text-primary hover:underline">
        {t("workflows.simple.orTemplates")}
      </Link>
    </div>
  );
}
