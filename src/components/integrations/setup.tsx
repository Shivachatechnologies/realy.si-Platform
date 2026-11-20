"use client";

import { useState, type FormEvent } from "react";
import { Check, ExternalLink, PlugZap, RefreshCw, Save, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";
import type { ConnectionAccount, CredentialField } from "@/server/modules/integrations/catalog";
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
        <Field key={f.key} label={`${t(`integrations.fields.${f.labelKey ?? f.key}`)}${f.required ? "" : ` (${t("common.optional")})`}`} htmlFor={`f-${f.key}`} error={fieldErrors[f.key]} hint={f.secret ? t("integrations.secretHint") : undefined}>
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
      () => api<{ ok: boolean; account?: string | null; error?: string; calendar?: { ok: boolean; calendars?: number; primary?: string | null; error?: string } }>(`${base}/integrations/${provider}/test`, { method: "POST", body: {} }),
      (r) => {
        if (!r.ok) return setResult({ ok: false, text: t("integrations.testFailed", { error: r.error ?? "" }) });
        const cal = r.calendar ? (r.calendar.ok ? t("integrations.calendarOk", { count: r.calendar.calendars ?? 0, primary: r.calendar.primary ?? "—" }) : t("integrations.calendarFailed", { error: r.calendar.error ?? "" })) : null;
        setResult({ ok: !r.calendar || r.calendar.ok, text: [t("integrations.testOk", { account: r.account ?? "—" }), cal].filter(Boolean).join(" · ") });
      },
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

/** Selectable sub-accounts (pages, channels, ad accounts, sites, audiences...) of a connection; one is active. */
export function AccountPicker({ base, provider, accounts, activeId, canManage }: { base: string; provider: string; accounts: ConnectionAccount[]; activeId: string | null; canManage: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? accounts.filter((a) => a.name.toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle)) : accounts;
  const choose = (accountId: string) => run(() => api(`${base}/integrations/${provider}/account`, { body: { accountId } }));
  return (
    <div className="grid gap-2">
      {accounts.length > 8 ? <Input type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder={t("integrations.accounts.search")} aria-label={t("integrations.accounts.search")} /> : null}
      <ul className="divide-y rounded-md border">
        {shown.map((a) => {
          const active = a.id === activeId;
          return (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t(`integrations.accounts.types.${a.type}`)} · <span dir="ltr">{a.id}</span>
                </p>
              </div>
              {active ? (
                <span className="inline-flex items-center gap-1 text-sm text-success">
                  <Check className="size-4" aria-hidden />
                  {t("integrations.accounts.active")}
                </span>
              ) : canManage ? (
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void choose(a.id)}>
                  {t("integrations.accounts.use")}
                </Button>
              ) : null}
            </li>
          );
        })}
        {shown.length === 0 ? <li className="p-3 text-sm text-muted-foreground">{t("common.noResults")}</li> : null}
      </ul>
      <FormError error={error} />
    </div>
  );
}

/** Provider settings after connecting (catalog configFields). Secret values are write-only: a stored one shows as "set". */
export function ConnectionSettingsForm({ base, provider, fields, values, storedSecrets }: { base: string; provider: string; fields: CredentialField[]; values: Record<string, string>; storedSecrets: string[] }) {
  const t = useT();
  const initial = Object.fromEntries(fields.map((f) => [f.key, f.secret ? "" : (values[f.key] ?? "")]));
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const fieldErrors = error instanceof ApiError ? error.fieldErrors() : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    // Secret fields left empty keep their stored value.
    const payload = Object.fromEntries(Object.entries(form).filter(([k, v]) => !(fields.find((f) => f.key === k)?.secret && !v.trim())));
    void run(
      () => api(`${base}/integrations/${provider}/settings`, { body: payload }),
      () => {
        setSaved(true);
        setForm((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fields.find((f) => f.key === k)?.secret ? "" : x])));
      },
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" autoComplete="off">
      {fields.map((f) => (
        <Field
          key={f.key}
          label={`${t(`integrations.fields.${f.labelKey ?? f.key}`)} (${t("common.optional")})`}
          htmlFor={`s-${f.key}`}
          error={fieldErrors[f.key]}
          hint={f.secret ? (storedSecrets.includes(f.key) ? t("integrations.settings.secretStored") : t("integrations.secretHint")) : undefined}
        >
          <Input
            id={`s-${f.key}`}
            type={f.secret ? "password" : "text"}
            value={form[f.key] ?? ""}
            placeholder={f.placeholder}
            maxLength={4000}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </Field>
      ))}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>
          <Save aria-hidden />
          {t("integrations.settings.save")}
        </Button>
        {saved ? <span className="text-sm text-success">{t("integrations.settings.saved")}</span> : null}
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}
