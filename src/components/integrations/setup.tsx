"use client";

import { useState, type FormEvent } from "react";
import { ExternalLink, PlugZap, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import type { CredentialField } from "@/server/modules/integrations/catalog";
import { useAction } from "@/components/automation/use-action";

/** "Connect with <provider>" (OAuth) — a top-level navigation to the start route, which redirects to the provider. */
export function OAuthConnectButton({ provider, name, orgId, companyId, locale, reconnect }: { provider: string; name: string; orgId: string; companyId: string; locale: string; reconnect?: boolean }) {
  const t = useT();
  const href = `/api/v1/integrations/oauth/${provider}/start?${new URLSearchParams({ orgId, companyId, locale })}`;
  return (
    <Button asChild variant={reconnect ? "secondary" : "default"}>
      <a href={href}>
        <PlugZap aria-hidden />
        {reconnect ? t("integrations.reconnect") : t("integrations.connectWith", { name })}
      </a>
    </Button>
  );
}

/** API-key setup form; credentials are verified by the server with a live call before they are stored. */
export function ApiKeyForm({ base, provider, fields, connected }: { base: string; provider: string; fields: CredentialField[]; connected: boolean }) {
  const t = useT();
  const empty = Object.fromEntries(fields.map((f) => [f.key, f.key === "headerName" ? "Authorization" : f.key === "headerPrefix" ? "Bearer" : ""]));
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const fieldErrors = error instanceof ApiError ? error.fieldErrors() : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    void run(
      () => api(`${base}/integrations/${provider}/credentials`, { body: values }),
      () => {
        setValues(empty);
        setSaved(true);
      },
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" autoComplete="off">
      {fields.map((f) => (
        <Field key={f.key} label={`${t(`integrations.fields.${f.key}`)}${f.required ? "" : ` (${t("common.optional")})`}`} htmlFor={`f-${f.key}`} error={fieldErrors[f.key]} hint={f.secret ? t("integrations.secretHint") : undefined}>
          <Input
            id={`f-${f.key}`}
            type={f.secret ? "password" : "text"}
            value={values[f.key] ?? ""}
            required={f.required}
            placeholder={f.placeholder}
            maxLength={4000}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </Field>
      ))}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>
          <ShieldCheck aria-hidden />
          {busy ? t("integrations.verifying") : connected ? t("integrations.updateCredentials") : t("integrations.verifyAndConnect")}
        </Button>
        {saved ? <span className="text-sm text-success">{t("integrations.connectedNotice")}</span> : null}
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ConnectionActions({ base, provider, canSync, syncEnabled, syncIntervalMinutes }: { base: string; provider: string; canSync: boolean; syncEnabled: boolean; syncIntervalMinutes: number }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const test = () =>
    run(
      () => api<{ ok: boolean; account?: string | null; error?: string }>(`${base}/integrations/${provider}/test`, { method: "POST", body: {} }),
      (r) => setResult(r.ok ? { ok: true, text: t("integrations.testOk", { account: r.account ?? "—" }) } : { ok: false, text: t("integrations.testFailed", { error: r.error ?? "" }) }),
    );
  const sync = () =>
    run(
      () => api<{ data: { kind: string; status: string; counts: { read: number; created: number; errors: number } }[] }>(`${base}/integrations/${provider}/sync`, { method: "POST", body: {} }),
      (r) => setResult({ ok: r.data.every((x) => x.status !== "FAILED"), text: r.data.map((x) => t("integrations.syncResult", { kind: x.kind, status: t(`integrations.syncStatus.${x.status}`), read: x.counts.read, created: x.counts.created, errors: x.counts.errors })).join(" · ") }),
    );
  const disconnect = () => {
    if (!confirm(t("integrations.disconnectConfirm"))) return;
    void run(() => api(`${base}/integrations/${provider}`, { method: "DELETE" }));
  };
  const settings = (body: { syncEnabled?: boolean; syncIntervalMinutes?: number }) => run(() => api(`${base}/integrations/${provider}`, { method: "PATCH", body }));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void test()}>
          <ShieldCheck aria-hidden />
          {t("integrations.testConnection")}
        </Button>
        {canSync ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void sync()}>
            <RefreshCw aria-hidden />
            {t("integrations.syncNow")}
          </Button>
        ) : null}
        <Button type="button" variant="danger" disabled={busy} onClick={disconnect}>
          <Unplug aria-hidden />
          {t("integrations.disconnect")}
        </Button>
      </div>
      {canSync ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4" checked={syncEnabled} disabled={busy} onChange={(e) => void settings({ syncEnabled: e.target.checked })} />
            {t("integrations.autoSync")}
          </label>
          <Select className="w-auto" value={String(syncIntervalMinutes)} disabled={busy || !syncEnabled} aria-label={t("integrations.syncInterval")} onChange={(e) => void settings({ syncIntervalMinutes: Number(e.target.value) })}>
            {[15, 30, 60, 180, 360, 720, 1440].map((m) => (
              <option key={m} value={m}>
                {t("integrations.everyMinutes", { count: m })}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {result ? <Notice tone={result.ok ? "success" : "danger"}>{result.text}</Notice> : null}
      <FormError error={error} />
    </div>
  );
}

export function DocsLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
      {label}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}
