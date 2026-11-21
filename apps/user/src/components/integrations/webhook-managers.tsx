"use client";

import { useState, type FormEvent } from "react";
import { Copy, KeyRound, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "@/components/automation/use-action";

/** Shows a just-created secret once, with a copy button. */
export function SecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Notice tone="warning">
      <p className="font-medium">{t("integrations.webhooks.secretOnce")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="max-w-full break-all rounded bg-muted px-2 py-1 font-mono text-xs">{secret}</code>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(secret).then(() => setCopied(true));
          }}
        >
          <Copy aria-hidden />
          {copied ? t("integrations.webhooks.copied") : t("integrations.webhooks.copy")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("integrations.webhooks.secretSaved")}
        </Button>
      </div>
    </Notice>
  );
}

export function CopyText({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1 text-start font-mono text-xs hover:bg-muted/70"
      title={label}
      onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true))}
    >
      <span className="truncate">{value}</span>
      <Copy className="size-3 shrink-0" aria-hidden />
      {copied ? <span className="sr-only">✓</span> : null}
    </button>
  );
}

const VERIFICATIONS = ["TOKEN", "HMAC_SHA256", "STRIPE", "GITHUB", "SHOPIFY", "SLACK", "TWILIO", "CALENDLY", "META", "ELEVENLABS", "ZENDESK", "INTERCOM"] as const;
type Verification = (typeof VERIFICATIONS)[number];
const PRESET_HEADERS: Partial<Record<Verification, string>> = { STRIPE: "Stripe-Signature", GITHUB: "X-Hub-Signature-256", SHOPIFY: "X-Shopify-Hmac-Sha256", SLACK: "X-Slack-Signature",
  TWILIO: "X-Twilio-Signature",
  CALENDLY: "Calendly-Webhook-Signature",
  META: "X-Hub-Signature-256",
  ELEVENLABS: "ElevenLabs-Signature",
  ZENDESK: "X-Zendesk-Webhook-Signature",
  INTERCOM: "X-Hub-Signature",
};
const isPreset = (v: Verification) => v in PRESET_HEADERS;

export function NewHookForm({ base }: { base: string }) {
  const t = useT();
  const [name, setName] = useState("");
  const [verification, setVerification] = useState<Verification>("TOKEN");
  const [signatureHeader, setSignatureHeader] = useState("x-realy-signature");
  const [signingSecret, setSigningSecret] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const preset = isPreset(verification);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api<{ secret: string | null }>(`${base}/integration-hooks`, { body: { name, verification, signatureHeader, ...(preset ? { signingSecret } : {}) } }),
      (r) => {
        setSecret(r.secret);
        setSaved(!r.secret);
        setName("");
        setSigningSecret("");
      },
    );
  };
  return (
    <div className="grid gap-3 p-3">
      {secret ? <SecretReveal secret={secret} onDone={() => setSecret(null)} /> : null}
      {saved ? <Notice tone="success">{t("integrations.webhooks.presetSaved")}</Notice> : null}
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_14rem_auto] lg:items-end">
        <Field label={t("integrations.webhooks.name")} htmlFor="hook-name">
          <Input id="hook-name" value={name} required maxLength={120} placeholder={t("integrations.webhooks.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("integrations.webhooks.verification")} htmlFor="hook-verification">
          <Select id="hook-verification" value={verification} onChange={(e) => setVerification(e.target.value as Verification)}>
            {VERIFICATIONS.map((v) => (
              <option key={v} value={v}>
                {t(`integrations.webhooks.verification${v}`)}
              </option>
            ))}
          </Select>
        </Field>
        {preset ? (
          <Field label={t("integrations.webhooks.signingSecret")} htmlFor="hook-signing-secret" hint={t("integrations.webhooks.signingSecretHint", { header: PRESET_HEADERS[verification] ?? "" })}>
            <Input id="hook-signing-secret" type="password" autoComplete="off" value={signingSecret} required minLength={8} maxLength={500} onChange={(e) => setSigningSecret(e.target.value)} />
          </Field>
        ) : (
          <Field label={t("integrations.webhooks.signatureHeader")} htmlFor="hook-header">
            <Input id="hook-header" value={signatureHeader} disabled={verification !== "HMAC_SHA256"} maxLength={64} pattern="[A-Za-z0-9-]{1,64}" onChange={(e) => setSignatureHeader(e.target.value)} />
          </Field>
        )}
        <Button type="submit" disabled={busy || !name.trim() || (preset && signingSecret.trim().length < 8)} className="min-h-11 sm:min-h-9">
          <Plus aria-hidden />
          {t("integrations.webhooks.createHook")}
        </Button>
      </form>
      <FormError error={error} />
    </div>
  );
}

export function HookRowActions({ base, hookId, active }: { base: string; hookId: string; active: boolean }) {
  const t = useT();
  const [secret, setSecret] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/integration-hooks/${hookId}`, { method: "PATCH", body: { active: !active } }))}>
          {active ? t("integrations.webhooks.disable") : t("integrations.webhooks.enable")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (confirm(t("integrations.webhooks.rotateConfirm"))) void run(() => api<{ secret: string }>(`${base}/integration-hooks/${hookId}/rotate`, { method: "POST", body: {} }), (r) => setSecret(r.secret));
          }}
        >
          <KeyRound aria-hidden />
          {t("integrations.webhooks.rotate")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={t("integrations.webhooks.delete")}
          onClick={() => {
            if (confirm(t("integrations.webhooks.deleteConfirm"))) void run(() => api(`${base}/integration-hooks/${hookId}`, { method: "DELETE" }));
          }}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {secret ? <SecretReveal secret={secret} onDone={() => setSecret(null)} /> : null}
      <FormError error={error} />
    </div>
  );
}

export function NewSubscriptionForm({ base, eventTypes, eventLabels }: { base: string; eventTypes: string[]; eventLabels: Record<string, string> }) {
  const t = useT();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [all, setAll] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => api<{ secret: string }>(`${base}/integration-webhooks`, { body: { name, url, eventTypes: all ? ["*"] : selected } }),
      (r) => {
        setSecret(r.secret);
        setName("");
        setUrl("");
        setSelected([]);
      },
    );
  };
  const toggle = (type: string) => setSelected((s) => (s.includes(type) ? s.filter((x) => x !== type) : [...s, type]));
  return (
    <div className="grid gap-3 p-3">
      {secret ? <SecretReveal secret={secret} onDone={() => setSecret(null)} /> : null}
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t("integrations.webhooks.name")} htmlFor="sub-name">
            <Input id="sub-name" value={name} required maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("integrations.webhooks.url")} htmlFor="sub-url" hint={t("integrations.webhooks.urlHint")}>
            <Input id="sub-url" type="url" value={url} required maxLength={2000} placeholder="https://example.com/realy-webhook" onChange={(e) => setUrl(e.target.value)} />
          </Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t("integrations.webhooks.events")}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {t("integrations.webhooks.allEvents")}
          </label>
          {!all ? (
            <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2 lg:grid-cols-3">
              {eventTypes.map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={selected.includes(type)} onChange={() => toggle(type)} />
                  <span className="truncate">{eventLabels[type] ?? type}</span>
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>
        <div>
          <Button type="submit" disabled={busy || !name.trim() || !url.trim() || (!all && !selected.length)}>
            <Plus aria-hidden />
            {t("integrations.webhooks.createSubscription")}
          </Button>
        </div>
      </form>
      <FormError error={error} />
    </div>
  );
}

export function SubscriptionRowActions({ base, id, active }: { base: string; id: string; active: boolean }) {
  const t = useT();
  const [secret, setSecret] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/integration-webhooks/${id}`, { method: "PATCH", body: { active: !active } }))}>
          {active ? t("integrations.webhooks.disable") : t("integrations.webhooks.enable")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (confirm(t("integrations.webhooks.rotateConfirm"))) void run(() => api<{ secret: string }>(`${base}/integration-webhooks/${id}/rotate`, { method: "POST", body: {} }), (r) => setSecret(r.secret));
          }}
        >
          <KeyRound aria-hidden />
          {t("integrations.webhooks.rotate")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-label={t("integrations.webhooks.delete")}
          onClick={() => {
            if (confirm(t("integrations.webhooks.deleteConfirm"))) void run(() => api(`${base}/integration-webhooks/${id}`, { method: "DELETE" }));
          }}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {secret ? <SecretReveal secret={secret} onDone={() => setSecret(null)} /> : null}
      <FormError error={error} />
    </div>
  );
}

export function RedeliverButton({ base, deliveryId }: { base: string; deliveryId: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <div className="grid justify-items-end gap-1">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => api(`${base}/integration-webhook-deliveries/${deliveryId}/redeliver`, { method: "POST", body: {} }))}>
        {busy ? <RotateCcw className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        {t("integrations.webhooks.redeliver")}
      </Button>
      <FormError error={error} />
    </div>
  );
}
