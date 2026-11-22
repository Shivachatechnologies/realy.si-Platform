"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Phone, PhoneCall, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError } from "@/components/form-error";
import { useAction } from "@/components/comms/client";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { GOALS, LANGUAGES } from "./bits";

interface Option {
  id: string;
  name: string;
}

// ───────────── Settings ─────────────

export interface SettingsValue {
  provider: "VAPI" | "RETELL" | null;
  callingStart: string;
  callingEnd: string;
  callingDays: number[];
  maxDurationMin: number;
  recordCalls: boolean;
  maxConcurrent: number;
  voicemailUserId: string | null;
  inboundTickets: boolean;
  inboundLeads: boolean;
  autoFollowUps: boolean;
}

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40">
      <input id={id} type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Calling rules, recording and inbound routing. `completeSetup` marks the guided setup's rules step done. */
export function SettingsForm({ base, value, members, completeSetup = false, canManage }: { base: string; value: SettingsValue; members: Option[]; completeSetup?: boolean; canManage: boolean }) {
  const t = useT();
  const [f, setF] = useState(value);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const set = <K extends keyof SettingsValue>(k: K, v: SettingsValue[K]) => {
    setSaved(false);
    setF((p) => ({ ...p, [k]: v }));
  };
  const days = [1, 2, 3, 4, 5, 6, 7];
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const body = {
          callingStart: f.callingStart,
          callingEnd: f.callingEnd,
          callingDays: f.callingDays,
          maxDurationMin: f.maxDurationMin,
          recordCalls: f.recordCalls,
          maxConcurrent: f.maxConcurrent,
          voicemailUserId: f.voicemailUserId,
          inboundTickets: f.inboundTickets,
          inboundLeads: f.inboundLeads,
          autoFollowUps: f.autoFollowUps,
          ...(completeSetup ? { completeSetup: true } : {}),
        };
        void run(() => api(`${base}/voice/settings`, { method: "PATCH", body }), () => setSaved(true));
      }}
    >
      <fieldset disabled={!canManage || busy} className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("voice.settings.callingStart")} htmlFor="vs-start">
            <Input id="vs-start" type="time" required value={f.callingStart} onChange={(e) => set("callingStart", e.target.value)} />
          </Field>
          <Field label={t("voice.settings.callingEnd")} htmlFor="vs-end" hint={t("voice.settings.callingHint")}>
            <Input id="vs-end" type="time" required value={f.callingEnd} onChange={(e) => set("callingEnd", e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("voice.settings.callingDays")}</span>
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => {
              const on = f.callingDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("callingDays", on ? f.callingDays.filter((x) => x !== d) : [...f.callingDays, d].sort())}
                  className={cn("min-w-12 rounded-md border px-2.5 py-1.5 text-sm", on ? "border-primary bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted")}
                >
                  {t(`voice.days.${d}`)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("voice.settings.maxDuration")} htmlFor="vs-dur">
            <Input id="vs-dur" type="number" min={1} max={60} required value={f.maxDurationMin} onChange={(e) => set("maxDurationMin", Number(e.target.value))} />
          </Field>
          <Field label={t("voice.settings.maxConcurrent")} htmlFor="vs-conc">
            <Input id="vs-conc" type="number" min={1} max={10} required value={f.maxConcurrent} onChange={(e) => set("maxConcurrent", Number(e.target.value))} />
          </Field>
        </div>
        <Toggle id="vs-rec" checked={f.recordCalls} onChange={(v) => set("recordCalls", v)} label={t("voice.settings.recordCalls")} hint={t("voice.settings.recordHint")} />
        <Toggle id="vs-fu" checked={f.autoFollowUps} onChange={(v) => set("autoFollowUps", v)} label={t("voice.settings.autoFollowUps")} hint={t("voice.settings.autoFollowUpsHint")} />
        <Toggle id="vs-tk" checked={f.inboundTickets} onChange={(v) => set("inboundTickets", v)} label={t("voice.settings.inboundTickets")} hint={t("voice.settings.inboundTicketsHint")} />
        <Toggle id="vs-ld" checked={f.inboundLeads} onChange={(v) => set("inboundLeads", v)} label={t("voice.settings.inboundLeads")} hint={t("voice.settings.inboundLeadsHint")} />
        <Field label={t("voice.settings.voicemailUser")} htmlFor="vs-vm" hint={t("voice.settings.voicemailHint")}>
          <Select id="vs-vm" value={f.voicemailUserId ?? ""} onChange={(e) => set("voicemailUserId", e.target.value || null)}>
            <option value="">{t("voice.settings.voicemailEveryone")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
      <FormError error={error} />
      {saved ? <Notice tone="success">{t("voice.settings.saved")}</Notice> : null}
      {canManage ? (
        <div>
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {completeSetup ? t("voice.setup.saveRules") : t("common.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** Choose the voice platform (Vapi or Retell AI). */
export function ProviderPicker({ base, current, states, canManage }: { base: string; current: "VAPI" | "RETELL" | null; states: Record<"vapi" | "retell", string>; canManage: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        {(["VAPI", "RETELL"] as const).map((p) => {
          const key = p === "VAPI" ? "vapi" : "retell";
          const state = states[key];
          const selected = current === p;
          return (
            <div key={p} className={cn("grid gap-3 rounded-lg border p-4", selected ? "border-primary bg-accent/40" : "")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{t(`voice.providers.${key}.name`)}</p>
                  <p className="text-sm text-muted-foreground">{t(`voice.providers.${key}.pitch`)}</p>
                </div>
                <span className={cn("rounded-sm border px-1.5 py-0.5 text-[11px]", state === "connected" ? "border-success/30 text-success" : state === "error" ? "border-danger/40 text-danger" : "text-muted-foreground")}>{t(`voice.connection.${state}`)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManage ? (
                  <Button type="button" size="sm" variant={selected ? "soft" : "secondary"} disabled={busy || selected} onClick={() => void run(() => api(`${base}/voice/settings`, { method: "PATCH", body: { provider: p } }))}>
                    {selected ? (
                      <>
                        <Check aria-hidden /> {t("voice.setup.selected")}
                      </>
                    ) : (
                      t("voice.setup.use")
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <FormError error={error} />
    </div>
  );
}

// ───────────── Agents ─────────────

export interface AgentValue {
  id?: string;
  name: string;
  aiEmployeeId: string | null;
  goal: (typeof GOALS)[number];
  language: (typeof LANGUAGES)[number];
  voiceId: string;
  greeting: string;
  instructions: string;
  offerNotes: string;
}

export function AgentForm({ base, locale, employees, value }: { base: string; locale: string; employees: { id: string; name: string; jobTitle: string | null }[]; value?: AgentValue }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState<AgentValue>(value ?? { name: "", aiEmployeeId: null, goal: "QUALIFY_LEAD", language: "en-US", voiceId: "", greeting: "", instructions: "", offerNotes: "" });
  const [result, setResult] = useState<{ syncStatus: string; syncError: string | null } | null>(null);
  const { busy, error, run } = useAction();
  const set = <K extends keyof AgentValue>(k: K, v: AgentValue[K]) => setF((p) => ({ ...p, [k]: v }));
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const { id, ...rest } = f;
        const payload = { ...rest, aiEmployeeId: rest.aiEmployeeId || null };
        void run(
          () => (id ? api<{ id: string; syncStatus: string; syncError: string | null }>(`${base}/voice/agents/${id}`, { method: "PATCH", body: payload }) : api<{ id: string; syncStatus: string; syncError: string | null }>(`${base}/voice/agents`, { body: payload })),
          (r) => {
            setResult(r);
            if (!id) router.push(`/${locale}/voice/agents/${r.id}`);
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("voice.agents.name")} htmlFor="va-name" hint={t("voice.agents.nameHint")}>
          <Input id="va-name" required maxLength={60} value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("voice.agents.employee")} htmlFor="va-emp" hint={t("voice.agents.employeeHint")}>
          <Select id="va-emp" value={f.aiEmployeeId ?? ""} onChange={(e) => set("aiEmployeeId", e.target.value || null)}>
            <option value="">{t("voice.agents.noEmployee")}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.jobTitle ? ` · ${e.jobTitle}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("voice.agents.goal")} htmlFor="va-goal" hint={t(`voice.goals.${f.goal}.hint`)}>
          <Select id="va-goal" value={f.goal} onChange={(e) => set("goal", e.target.value as AgentValue["goal"])}>
            {GOALS.map((g) => (
              <option key={g} value={g}>
                {t(`voice.goals.${g}.label`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("voice.agents.language")} htmlFor="va-lang">
          <Select id="va-lang" value={f.language} onChange={(e) => set("language", e.target.value as AgentValue["language"])}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t(`voice.languages.${l}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("voice.agents.greeting")} htmlFor="va-greet" hint={t("voice.agents.greetingHint")}>
        <Input id="va-greet" maxLength={400} value={f.greeting} onChange={(e) => set("greeting", e.target.value)} />
      </Field>
      <Field label={t("voice.agents.offerNotes")} htmlFor="va-offers" hint={t("voice.agents.offerNotesHint")}>
        <Textarea id="va-offers" rows={4} maxLength={3000} value={f.offerNotes} onChange={(e) => set("offerNotes", e.target.value)} />
      </Field>
      <Field label={t("voice.agents.instructions")} htmlFor="va-instr" hint={t("voice.agents.instructionsHint")}>
        <Textarea id="va-instr" rows={4} maxLength={3000} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} />
      </Field>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("voice.agents.advanced")}</summary>
        <Field label={t("voice.agents.voiceId")} htmlFor="va-voice" hint={t("voice.agents.voiceIdHint")} className="mt-3">
          <Input id="va-voice" maxLength={80} value={f.voiceId} onChange={(e) => set("voiceId", e.target.value)} />
        </Field>
      </details>
      <Notice tone="info">{t("voice.agents.disclosureNote")}</Notice>
      <FormError error={error} />
      {result && result.syncStatus !== "SYNCED" ? <Notice tone="warning">{t("voice.agents.savedNotSynced", { error: result.syncError ?? "" })}</Notice> : result ? <Notice tone="success">{t("voice.agents.savedSynced")}</Notice> : null}
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {f.id ? t("voice.agents.save") : t("voice.agents.create")}
        </Button>
      </div>
    </form>
  );
}

/** Generic one-click action with inline error. */
export function VoiceAction({ path, method = "POST", body, label, confirm, variant = "secondary", icon, done }: { path: string; method?: "POST" | "PATCH" | "DELETE"; body?: unknown; label: string; confirm?: string; variant?: "secondary" | "ghost" | "danger" | "default" | "soft"; icon?: "sync" | "phone"; done?: string }) {
  const { busy, error, run } = useAction();
  const [ok, setOk] = useState(false);
  return (
    <span className="inline-grid gap-1">
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setOk(false);
          void run(() => api(path, { method, body: body ?? (method === "DELETE" ? undefined : {}) }), () => setOk(true));
        }}
      >
        {icon === "sync" ? <RefreshCw aria-hidden className={busy ? "motion-safe:animate-spin" : ""} /> : icon === "phone" ? <Phone aria-hidden /> : null}
        {label}
      </Button>
      {ok && done ? <span className="text-xs text-success">{done}</span> : null}
      <FormError error={error} />
    </span>
  );
}

// ───────────── Numbers ─────────────

interface TwilioOptions {
  connected: boolean;
  owned: { number: string; label: string | null; imported?: boolean }[];
  available: { number: string; label: string | null; locality: string | null }[];
}

export function GetNumber({ base, provider, twilioConnected }: { base: string; locale?: string; provider: "VAPI" | "RETELL"; twilioConnected: boolean }) {
  const t = useT();
  const [mode, setMode] = useState<"provider" | "twilio">(provider === "VAPI" && twilioConnected ? "twilio" : "provider");
  const [areaCode, setAreaCode] = useState("");
  const [label, setLabel] = useState("");
  const [country, setCountry] = useState("US");
  const [opts, setOpts] = useState<TwilioOptions | null>(null);
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-4">
      {provider === "VAPI" ? (
        <div className="flex flex-wrap gap-2" role="tablist">
          {(["twilio", "provider"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("rounded-md border px-3 py-1.5 text-sm", mode === m ? "border-primary bg-accent font-medium" : "text-muted-foreground hover:bg-muted")}>
              {t(`voice.numbers.mode.${m}`)}
            </button>
          ))}
        </div>
      ) : null}
      <Field label={t("voice.numbers.label")} htmlFor="vn-label">
        <Input id="vn-label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("voice.numbers.labelPlaceholder")} />
      </Field>
      {mode === "provider" ? (
        <form
          className="grid gap-3 sm:grid-cols-[10rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!window.confirm(t("voice.numbers.buyConfirm"))) return;
            void run(() => api(`${base}/voice/numbers`, { body: { mode: "provider", areaCode, label: label || undefined } }));
          }}
        >
          <Field label={t("voice.numbers.areaCode")} htmlFor="vn-area" hint={t(provider === "VAPI" ? "voice.numbers.vapiFreeHint" : "voice.numbers.retellHint")}>
            <Input id="vn-area" required inputMode="numeric" pattern="\d{3}" maxLength={3} value={areaCode} onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {t("voice.numbers.buy")}
          </Button>
        </form>
      ) : !twilioConnected ? (
        <Notice tone="info">
          {t("voice.numbers.twilioMissing")}
        </Notice>
      ) : (
        <div className="grid gap-3">
          <form
            className="grid gap-3 sm:grid-cols-[8rem_8rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api<TwilioOptions>(`${base}/voice/numbers/twilio?country=${encodeURIComponent(country)}${areaCode ? `&areaCode=${encodeURIComponent(areaCode)}` : ""}`), setOpts);
            }}
          >
            <Field label={t("voice.numbers.country")} htmlFor="vn-country">
              <Input id="vn-country" required maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />
            </Field>
            <Field label={t("voice.numbers.areaCode")} htmlFor="vn-area2">
              <Input id="vn-area2" inputMode="numeric" maxLength={5} value={areaCode} onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Button type="submit" variant="secondary" disabled={busy}>
              {t("voice.numbers.search")}
            </Button>
          </form>
          {opts ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid content-start gap-2">
                <p className="text-sm font-medium">{t("voice.numbers.owned")}</p>
                {opts.owned.length ? (
                  opts.owned.map((n) => (
                    <div key={n.number} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                      <span className="font-mono">{n.number}</span>
                      {n.imported ? (
                        <span className="text-xs text-muted-foreground">{t("voice.numbers.alreadyConnected")}</span>
                      ) : (
                        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(`${base}/voice/numbers`, { body: { mode: "twilio_import", number: n.number, label: label || undefined } }))}>
                          {t("voice.numbers.import")}
                        </Button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">{t("voice.numbers.noneOwned")}</p>
                )}
              </div>
              <div className="grid content-start gap-2">
                <p className="text-sm font-medium">{t("voice.numbers.available")}</p>
                {opts.available.length ? (
                  opts.available.map((n) => (
                    <div key={n.number} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                      <span>
                        <span className="font-mono">{n.number}</span>
                        {n.locality ? <span className="ms-2 text-xs text-muted-foreground">{n.locality}</span> : null}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(t("voice.numbers.buyTwilioConfirm", { number: n.number }))) return;
                          void run(() => api(`${base}/voice/numbers`, { body: { mode: "twilio_buy", number: n.number, label: label || undefined } }));
                        }}
                      >
                        {t("voice.numbers.buy")}
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">{t("voice.numbers.noneAvailable")}</p>
                )}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("voice.numbers.twilioShareNote")}</p>
        </div>
      )}
      <FormError error={error} />
    </div>
  );
}

export function AssignNumber({ base, numberId, agents, current }: { base: string; numberId: string; agents: Option[]; current: string | null }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-1">
      <Select
        aria-label={t("voice.numbers.inboundAgent")}
        value={current ?? ""}
        disabled={busy}
        onChange={(e) => void run(() => api(`${base}/voice/numbers/${numberId}`, { method: "PATCH", body: { inboundAgentId: e.target.value || null } }))}
      >
        <option value="">{t("voice.numbers.noInbound")}</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <FormError error={error} />
    </div>
  );
}

// ───────────── Calls ─────────────

interface CallRequestResult {
  callId: string;
  status: string;
  approvalId: string | null;
  scheduledFor?: string | null;
  blockedReason?: string | null;
}

function CallRequestOutcome({ base, locale, r, canApprove, onDone }: { base: string; locale: string; r: CallRequestResult; canApprove: boolean; onDone?: () => void }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [approved, setApproved] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      {approved ? (
        <Notice tone="success">{approved}</Notice>
      ) : r.approvalId ? (
        <Notice tone="warning" title={t("voice.call.awaitingTitle")}>
          {t("voice.call.awaitingBody")}
        </Notice>
      ) : (
        <Notice tone={r.status === "QUEUED" || r.status === "SCHEDULED" ? "success" : "warning"}>{t(`voice.call.result.${r.status}`)}</Notice>
      )}
      <div className="flex flex-wrap gap-2">
        {r.approvalId && canApprove && !approved ? (
          <Button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void run(() => api<{ result?: string }>(`${base}/approvals/${r.approvalId}/decision`, { body: { decision: "approve" } }), (x) => { setApproved(x.result ?? t("voice.call.approved")); onDone?.(); })}
          >
            <ShieldCheck aria-hidden /> {t("voice.call.approveNow")}
          </Button>
        ) : null}
        <Link href={`/${locale}/voice/calls/${r.callId}`} className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted">
          {t("voice.call.open")}
        </Link>
      </div>
      <FormError error={error} />
    </div>
  );
}

/**
 * "Call with AI" button for CRM lead/contact pages and /voice. Files a call request (approval) for the subject; when
 * the viewer can approve, offers to approve right away. Disabled with the reason when calling is not possible.
 */
export function CallButton({
  base,
  locale,
  agents,
  subject,
  canApprove,
  disabledReason,
  size = "default",
}: {
  base: string;
  locale: string;
  agents: Option[];
  subject: { leadId?: string; contactId?: string; name: string };
  canApprove: boolean;
  /** i18n key under voice.callButton.disabled when calling is not possible. */
  disabledReason?: string | null;
  size?: "default" | "sm";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [purpose, setPurpose] = useState("");
  const [result, setResult] = useState<CallRequestResult | null>(null);
  const { busy, error, run } = useAction();
  if (disabledReason) {
    return (
      <span className="inline-grid gap-1">
        <Button type="button" size={size} variant="secondary" disabled>
          <PhoneCall aria-hidden /> {t("voice.callButton.label")}
        </Button>
        <span className="text-xs text-muted-foreground">{t(`voice.callButton.disabled.${disabledReason}`)}</span>
      </span>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setResult(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size={size} variant="soft">
          <PhoneCall aria-hidden /> {t("voice.callButton.label")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("voice.callButton.title", { name: subject.name })} description={t("voice.callButton.description")} closeLabel={t("common.close")}>
        {result ? (
          <CallRequestOutcome base={base} locale={locale} r={result} canApprove={canApprove} />
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api<CallRequestResult>(`${base}/voice/calls`, { body: { agentId, purpose, ...(subject.leadId ? { leadId: subject.leadId } : { contactId: subject.contactId }) } }), setResult);
            }}
          >
            <Field label={t("voice.callButton.agent")} htmlFor="cb-agent">
              <Select id="cb-agent" required value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("voice.callButton.purpose")} htmlFor="cb-purpose" hint={t("voice.callButton.purposeHint")}>
              <Textarea id="cb-purpose" required minLength={3} maxLength={1000} rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">{t("voice.callButton.rules")}</p>
            <FormError error={error} />
            <div>
              <Button type="submit" disabled={busy || !agentId} aria-busy={busy}>
                {t("voice.callButton.request")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Call someone who is not in the CRM (international number). */
export function ManualCallForm({ base, locale, agents, canApprove }: { base: string; locale: string; agents: Option[]; canApprove: boolean }) {
  const t = useT();
  const [f, setF] = useState({ agentId: agents[0]?.id ?? "", phone: "", name: "", purpose: "" });
  const [result, setResult] = useState<CallRequestResult | null>(null);
  const { busy, error, run } = useAction();
  if (result) return <CallRequestOutcome base={base} locale={locale} r={result} canApprove={canApprove} />;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api<CallRequestResult>(`${base}/voice/calls`, { body: { agentId: f.agentId, phone: f.phone, name: f.name || undefined, purpose: f.purpose } }), setResult);
      }}
    >
      <Field label={t("voice.callButton.phone")} htmlFor="mc-phone" hint={t("voice.callButton.phoneHint")}>
        <Input id="mc-phone" required type="tel" maxLength={40} placeholder="+44 20 7946 0958" value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} />
      </Field>
      <Field label={t("voice.callButton.name")} htmlFor="mc-name">
        <Input id="mc-name" maxLength={120} value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
      </Field>
      <Field label={t("voice.callButton.agent")} htmlFor="mc-agent">
        <Select id="mc-agent" required value={f.agentId} onChange={(e) => setF((p) => ({ ...p, agentId: e.target.value }))}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("voice.callButton.purpose")} htmlFor="mc-purpose" className="sm:col-span-2">
        <Textarea id="mc-purpose" required minLength={3} maxLength={1000} rows={2} value={f.purpose} onChange={(e) => setF((p) => ({ ...p, purpose: e.target.value }))} />
      </Field>
      <div className="sm:col-span-2 grid gap-2">
        <FormError error={error} />
        <div>
          <Button type="submit" disabled={busy || !f.agentId} aria-busy={busy}>
            {t("voice.callButton.request")}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ───────────── Campaigns ─────────────

export function CampaignForm({ base, agents, numbers, people }: { base: string; agents: (Option & { provider: string })[]; numbers: (Option & { provider: string })[]; people: { id: string; kind: "lead" | "contact"; name: string; phone: string; detail: string | null }[] }) {
  const t = useT();
  const [f, setF] = useState({ name: "", agentId: agents[0]?.id ?? "", numberId: "", purpose: "" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ targets: number; skipped: { id: string; reason: string }[]; approvalId: string | null } | null>(null);
  const { busy, error, run } = useAction();
  const agent = agents.find((a) => a.id === f.agentId);
  const usable = numbers.filter((n) => !agent || n.provider === agent.provider);
  const numberId = usable.some((n) => n.id === f.numberId) ? f.numberId : (usable[0]?.id ?? "");
  const shown = people.filter((p) => !q || `${p.name} ${p.phone} ${p.detail ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const key = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`;
  if (result)
    return (
      <div className="grid gap-2">
        <Notice tone="success" title={t("voice.campaigns.created")}>
          {t("voice.campaigns.createdBody", { count: result.targets })}
        </Notice>
        {result.skipped.length ? <Notice tone="warning">{t("voice.campaigns.skipped", { count: result.skipped.length })}</Notice> : null}
      </div>
    );
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const ids = [...picked];
        void run(
          () =>
            api<{ targets: number; skipped: { id: string; reason: string }[]; approvalId: string | null }>(`${base}/voice/campaigns`, {
              body: { ...f, numberId, leadIds: ids.filter((x) => x.startsWith("lead:")).map((x) => x.slice(5)), contactIds: ids.filter((x) => x.startsWith("contact:")).map((x) => x.slice(8)) },
            }),
          setResult,
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("voice.campaigns.name")} htmlFor="vc-name">
          <Input id="vc-name" required maxLength={120} value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
        </Field>
        <Field label={t("voice.callButton.agent")} htmlFor="vc-agent">
          <Select id="vc-agent" required value={f.agentId} onChange={(e) => setF((p) => ({ ...p, agentId: e.target.value }))}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("voice.campaigns.number")} htmlFor="vc-number">
          <Select id="vc-number" required value={numberId} onChange={(e) => setF((p) => ({ ...p, numberId: e.target.value }))}>
            {usable.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("voice.callButton.purpose")} htmlFor="vc-purpose" hint={t("voice.callButton.purposeHint")}>
        <Textarea id="vc-purpose" required minLength={3} maxLength={1000} rows={2} value={f.purpose} onChange={(e) => setF((p) => ({ ...p, purpose: e.target.value }))} />
      </Field>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{t("voice.campaigns.people", { count: picked.size })}</span>
          <Input className="max-w-xs" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("voice.campaigns.search")} aria-label={t("voice.campaigns.search")} />
        </div>
        {people.length ? (
          <ul className="grid max-h-80 gap-1 overflow-y-auto rounded-md border p-1">
            {shown.map((p) => {
              const k = key(p);
              const on = picked.has(k);
              return (
                <li key={k}>
                  <label className={cn("flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted/60", on ? "bg-accent/50" : "")}>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={on}
                      onChange={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(k)) n.delete(k);
                          else if (n.size < 200) n.add(k);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {p.name}
                      {p.detail ? <span className="ms-2 text-xs text-muted-foreground">{p.detail}</span> : null}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.phone}</span>
                    <span className="shrink-0 rounded-sm border px-1 text-[10px] text-muted-foreground">{t(`voice.campaigns.kind.${p.kind}`)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("voice.campaigns.noPeople")}</p>
        )}
      </div>
      <Notice tone="info">{t("voice.campaigns.approvalNote")}</Notice>
      <FormError error={error} />
      <div>
        <Button type="submit" disabled={busy || !picked.size || !numberId} aria-busy={busy}>
          {t("voice.campaigns.create")}
        </Button>
      </div>
    </form>
  );
}

// ───────────── Do-not-call ─────────────

export function DncForm({ base }: { base: string }) {
  const t = useT();
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/voice/dnc`, { body: { phone, reason: reason || undefined } }), () => {
          setPhone("");
          setReason("");
        });
      }}
    >
      <Field label={t("voice.dnc.phone")} htmlFor="dnc-phone">
        <Input id="dnc-phone" required type="tel" maxLength={40} placeholder="+49 30 1234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label={t("voice.dnc.reason")} htmlFor="dnc-reason">
        <Input id="dnc-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy} aria-busy={busy}>
        {t("voice.dnc.add")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}
