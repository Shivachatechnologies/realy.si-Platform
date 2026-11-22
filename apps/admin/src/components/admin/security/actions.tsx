"use client";

import { useState } from "react";
import { Ban, FlaskConical, Headphones, Plus, Send, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ActionDialog, useAdminAction } from "../action-dialog";

/**
 * Stream F client actions (security, developer, email, telephony, flags). Every mutating action goes through
 * ActionDialog: a reason (audited server-side) and, where destructive, a typed confirmation.
 */

// ───────────── API keys ─────────────

/** Narrow the scopes of a key and/or bring its expiry forward (also used as "rotate": expiry with a grace period). */
export function RestrictApiKey({ keyId, name, scopes, mode }: { keyId: string; name: string; scopes: string[]; mode: "restrict" | "rotate" }) {
  const t = useT();
  const run = useAdminAction({ success: t("admin.developers.restrictDone") });
  const [keep, setKeep] = useState<string[]>(scopes);
  const [days, setDays] = useState(mode === "rotate" ? "7" : "");
  const rotate = mode === "rotate";
  const dayNum = days.trim() === "" ? undefined : Number(days);
  const valid = (rotate ? dayNum !== undefined : true) && (dayNum === undefined || (Number.isInteger(dayNum) && dayNum >= 0 && dayNum <= 730)) && keep.length > 0 && (rotate || dayNum !== undefined || keep.length < scopes.length);
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <SlidersHorizontal />
          {rotate ? t("admin.developers.rotate") : t("admin.developers.restrict")}
        </Button>
      }
      title={rotate ? t("admin.developers.rotateTitle", { name }) : t("admin.developers.restrictTitle", { name })}
      description={rotate ? t("admin.developers.rotateHint") : t("admin.developers.restrictHint")}
      confirmLabel={rotate ? t("admin.developers.rotate") : t("admin.developers.restrict")}
      canSubmit={valid}
      onConfirm={(reason) => run(`/api/v1/admin/api-keys/${keyId}/restrict`, "POST", { reason, ...(dayNum !== undefined ? { expiresInDays: dayNum } : {}), ...(!rotate && keep.length < scopes.length ? { scopes: keep } : {}) })}
    >
      {!rotate && scopes.length ? (
        <fieldset className="grid max-h-56 gap-1 overflow-auto rounded-md border p-2">
          <legend className="px-1 text-xs text-muted-foreground">{t("admin.developers.keepScopes")}</legend>
          {scopes.map((s) => (
            <label key={s} className="flex items-center gap-2 font-mono text-xs">
              <input type="checkbox" checked={keep.includes(s)} onChange={(e) => setKeep((k) => (e.target.checked ? [...k, s] : k.filter((x) => x !== s)))} />
              {s}
            </label>
          ))}
        </fieldset>
      ) : null}
      <Field label={rotate ? t("admin.developers.graceDays") : t("admin.developers.expireInDays")} htmlFor={`exp-${keyId}`} hint={t("admin.developers.expireHint")}>
        <Input id={`exp-${keyId}`} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))} className="w-28" />
      </Field>
    </ActionDialog>
  );
}

// ───────────── Email ─────────────

export function AddSuppression() {
  const t = useT();
  const run = useAdminAction({ success: t("admin.email.suppressedDone") });
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Ban />
          {t("admin.email.addSuppression")}
        </Button>
      }
      title={t("admin.email.addSuppression")}
      description={t("admin.email.addSuppressionHint")}
      confirmLabel={t("admin.email.addSuppression")}
      canSubmit={/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
      onConfirm={(reason) => run("/api/v1/admin/email/suppressions", "POST", { email: email.trim(), note: note.trim() || undefined, reason })}
    >
      <Field label={t("admin.email.address")} htmlFor="sup-email">
        <Input id="sup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" />
      </Field>
      <Field label={t("admin.email.note")} htmlFor="sup-note">
        <Input id="sup-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
    </ActionDialog>
  );
}

export function TestSendEmail({ defaultTo }: { defaultTo: string }) {
  const t = useT();
  const run = useAdminAction({ success: t("admin.email.testSent") });
  const [to, setTo] = useState(defaultTo);
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          <Send />
          {t("admin.email.testSend")}
        </Button>
      }
      title={t("admin.email.testSend")}
      description={t("admin.email.testSendHint")}
      confirmLabel={t("admin.email.send")}
      canSubmit={/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())}
      onConfirm={(reason) => run("/api/v1/admin/email/test-send", "POST", { to: to.trim(), reason })}
    >
      <Field label={t("admin.email.address")} htmlFor="test-to">
        <Input id="test-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} maxLength={254} />
      </Field>
    </ActionDialog>
  );
}

interface ProbeResult {
  ok?: boolean;
  message?: string;
  status?: number | null;
  supported?: boolean;
  senderDomain?: string | null;
  senderVerified?: boolean | null;
  domains?: { name: string; status: string }[];
}

/** One-click read-only check (connection test, sender verification): shows the provider's answer inline. */
export function ProbeButton({ path, label }: { path: string; label: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setResult(await api<ProbeResult>(path, { method: "POST", body: {} }));
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FlaskConical />
          {busy ? t("common.loading") : label}
        </Button>
      </div>
      <FormError error={error} />
      {result ? (
        result.supported === false ? (
          <Notice tone="info">{t("admin.email.senderUnsupported", { domain: result.senderDomain ?? "—" })}</Notice>
        ) : result.domains ? (
          <div className="grid gap-1 text-xs">
            <span>
              {t("admin.email.senderDomain")}: <span className="font-mono">{result.senderDomain ?? "—"}</span>{" "}
              <Badge tone={result.senderVerified ? "success" : result.senderVerified === false ? "danger" : "neutral"}>{result.senderVerified ? t("admin.email.verified") : result.senderVerified === false ? t("admin.email.notVerified") : t("admin.settings.kit.unavailable")}</Badge>
            </span>
            {result.domains.map((d) => (
              <span key={d.name} className="font-mono text-muted-foreground">
                {d.name} · {d.status}
              </span>
            ))}
          </div>
        ) : (
          <Notice tone={result.ok ? "success" : "danger"}>
            {result.message}
            {result.status ? ` (${result.status})` : ""}
          </Notice>
        )
      ) : null}
    </div>
  );
}

// ───────────── Telephony ─────────────

interface Recording {
  recordingUrl: string | null;
  summary: string | null;
  transcript: { role: string; text: string; atSec: number | null }[];
}

/** Transcript / recording access: reason first (audited), then the transcript in a dialog. */
export function RecordingAccess({ callId }: { callId: string }) {
  const t = useT();
  const [data, setData] = useState<Recording | null>(null);
  return (
    <>
      <ActionDialog
        trigger={
          <Button size="sm" variant="ghost">
            <Headphones />
            {t("admin.telephony.openRecording")}
          </Button>
        }
        title={t("admin.telephony.recordingTitle")}
        description={t("admin.telephony.recordingHint")}
        confirmLabel={t("admin.telephony.openRecording")}
        onConfirm={async (reason) => setData(await api<Recording>(`/api/v1/admin/telephony/calls/${callId}/recording`, { method: "POST", body: { reason } }))}
      />
      <Dialog open={!!data} onOpenChange={(o) => (!o ? setData(null) : undefined)}>
        <DialogContent title={t("admin.telephony.transcript")} closeLabel={t("common.close")}>
          {data ? (
            <div className="grid max-h-[60vh] gap-2 overflow-auto text-sm">
              {data.recordingUrl ? (
                <a href={data.recordingUrl} target="_blank" rel="noreferrer noopener" className="text-xs text-primary hover:underline">
                  {t("admin.telephony.recordingLink")}
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">{t("admin.telephony.noRecording")}</p>
              )}
              {data.summary ? <p className="rounded-md bg-muted p-2 text-xs">{data.summary}</p> : null}
              {data.transcript.length === 0 ? <p className="text-xs text-muted-foreground">{t("admin.telephony.noTranscript")}</p> : null}
              {data.transcript.map((l, i) => (
                <p key={i} className="text-xs">
                  <span className="font-mono text-muted-foreground">{l.atSec !== null ? `${l.atSec}s ` : ""}</span>
                  <span className="font-medium">{l.role}:</span> {l.text}
                </p>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────── Feature flags v2 ─────────────

export function CreateFlag() {
  const t = useT();
  const toast = useToast();
  const run = useAdminAction();
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [on, setOn] = useState(false);
  return (
    <ActionDialog
      trigger={
        <Button size="sm">
          <Plus />
          {t("admin.flags.create")}
        </Button>
      }
      title={t("admin.flags.create")}
      description={t("admin.flags.createHint")}
      confirmLabel={t("admin.flags.create")}
      canSubmit={/^[a-z][a-z0-9_.-]{2,79}$/.test(key)}
      onConfirm={async (reason) => {
        await run("/api/v1/admin/feature-flags", "POST", { key, description, defaultEnabled: on, reason });
        toast.success(t("admin.flags.created", { key }));
        setKey("");
        setDescription("");
      }}
    >
      <Field label={t("admin.flags.key")} htmlFor="flag-key" hint={t("admin.flags.keyHint")}>
        <Input id="flag-key" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} maxLength={80} className="font-mono" autoComplete="off" />
      </Field>
      <Field label={t("admin.flags.description")} htmlFor="flag-desc">
        <Input id="flag-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        {t("admin.flags.defaultOn")}
      </label>
    </ActionDialog>
  );
}

const ENVS = ["production", "preview", "development"] as const;
const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");

/** Percentage rollout, environment targeting and schedule window. */
export function RolloutEditor({ flagId, flagKey, rollout }: { flagId: string; flagKey: string; rollout: { percentage: number | null; environments: string[]; startsAt: string | null; endsAt: string | null } | null }) {
  const t = useT();
  const run = useAdminAction({ success: t("admin.flags.rolloutSaved") });
  const [pct, setPct] = useState(rollout?.percentage === null || rollout?.percentage === undefined ? "" : String(rollout.percentage));
  const [envs, setEnvs] = useState<string[]>(rollout?.environments ?? []);
  const [start, setStart] = useState(toLocalInput(rollout?.startsAt ?? null));
  const [end, setEnd] = useState(toLocalInput(rollout?.endsAt ?? null));
  const n = pct === "" ? null : Number(pct);
  const valid = (n === null || (Number.isInteger(n) && n >= 0 && n <= 100)) && (!start || !end || start < end);
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          {t("admin.flags.rollout")}
        </Button>
      }
      title={t("admin.flags.rolloutTitle", { key: flagKey })}
      description={t("admin.flags.rolloutHint")}
      confirmLabel={t("common.save")}
      canSubmit={valid}
      onConfirm={(reason) =>
        run(`/api/v1/admin/feature-flags/${flagId}/rollout`, "PUT", {
          percentage: n,
          environments: envs,
          startsAt: start ? new Date(start).toISOString() : null,
          endsAt: end ? new Date(end).toISOString() : null,
          reason,
        })
      }
    >
      <Field label={t("admin.flags.percentage")} htmlFor={`pct-${flagId}`} hint={t("admin.flags.percentageHint")}>
        <Input id={`pct-${flagId}`} inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} className="w-24" />
      </Field>
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 text-xs text-muted-foreground">{t("admin.flags.environments")}</legend>
        {ENVS.map((e) => (
          <label key={e} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={envs.includes(e)} onChange={(ev) => setEnvs((x) => (ev.target.checked ? [...x, e] : x.filter((v) => v !== e)))} />
            {t(`admin.flags.env.${e}`)}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("admin.flags.startsAt")} htmlFor={`st-${flagId}`}>
          <Input id={`st-${flagId}`} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t("admin.flags.endsAt")} htmlFor={`en-${flagId}`}>
          <Input id={`en-${flagId}`} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
    </ActionDialog>
  );
}

/** Generic select-then-confirm action (priority, status, assignee): the choice travels with the reason. */
export function SelectAction({ path, method, field, options, current, label, title, extra = {}, nullable }: { path: string; method: string; field: string; options: { value: string; label: string }[]; current: string | null; label: string; title: string; extra?: Record<string, unknown>; nullable?: boolean }) {
  const t = useT();
  const run = useAdminAction({ success: t("admin.settings.kit.saved") });
  const [value, setValue] = useState(current ?? "");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="secondary">
          {label}
        </Button>
      }
      title={title}
      confirmLabel={t("common.save")}
      canSubmit={value !== (current ?? "")}
      onConfirm={(reason) => run(path, method, { ...extra, [field]: value === "" && nullable ? null : value, reason })}
    >
      <Select value={value} onChange={(e) => setValue(e.target.value)} aria-label={label}>
        {nullable ? <option value="">{t("common.none")}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </ActionDialog>
  );
}
