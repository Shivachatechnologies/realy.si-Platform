"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Check, Copy, ExternalLink, Eye, EyeOff, KeyRound, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { formatDateTime } from "@/i18n/format";
import { api, ApiError } from "@/lib/api-client";
import { ActionDialog } from "./action-dialog";

const API = "/api/v1/admin/platform-secrets";

/** Serializable status of one platform key (mirrors PlatformKeyStatus; never carries a secret value). */
export interface PlatformKeyRowData {
  key: string;
  kind: "secret" | "plain";
  label: string;
  help: string;
  docsUrl: string | null;
  placeholder: string | null;
  register: { kind: "redirect" | "webhook"; urls: string[] } | null;
  blocks: string[];
  restart: boolean;
  testable: boolean;
  source: "admin" | "host" | "missing";
  hostSet: boolean;
  last4: string | null;
  value: string | null;
  note: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string; email: string } | null;
}

interface TestResult {
  ok: boolean;
  kind: "provider" | "format";
  status: number | null;
  message: string;
}

export function SourcePill({ source }: { source: PlatformKeyRowData["source"] }) {
  const { t } = useI18n();
  if (source === "admin") return <Badge tone="success" shape="pill">{t("admin.keys.status.admin")}</Badge>;
  if (source === "host") return <Badge tone="info" shape="pill">{t("admin.keys.status.host")}</Badge>;
  return <Badge tone="warning" shape="pill">{t("admin.keys.status.missing")}</Badge>;
}

function CopyUrl({ url }: { url: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <code className="min-w-0 flex-1 truncate rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px]" title={url}>
        {url}
      </code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={t("admin.keys.copy")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable: the URL is selectable */
          }
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  );
}

/** Format errors carry an English hint that describes the expected shape (never the value): show it as is. */
function errorText(err: unknown): string | null {
  return err instanceof ApiError && err.code === "validation_error" && typeof err.details?.key === "string" ? err.message : null;
}

/** One platform key: status, help, register URLs and — for managers — a write-only editor with Save / Test / Clear. */
export function PlatformKeyRow({ item, canManage, timeZone }: { item: PlatformKeyRowData; canManage: boolean; timeZone: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const secret = item.kind === "secret";

  const close = () => {
    setEditing(false);
    setValue("");
    setReveal(false);
    setReason("");
    setError(null);
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await api(`${API}/${item.key}`, { method: "PUT", body: { value, reason: reason.trim() } });
      close();
      setTest(null);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      setTest(await api<TestResult>(`${API}/${item.key}/test`, { method: "POST", body: value.trim() ? { value } : {} }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const formatError = errorText(error);
  return (
    <div className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{item.label}</span>
            <code className="font-mono text-[11px] text-muted-foreground">{item.key}</code>
            <SourcePill source={item.source} />
            {item.source === "admin" && item.hostSet ? <Badge tone="neutral">{t("admin.keys.overridesHost")}</Badge> : null}
            {item.restart ? <Badge tone="neutral">{t("admin.keys.restart")}</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.help}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {secret ? (
              item.last4 ? (
                <span className="font-mono">•••• {item.last4}</span>
              ) : item.source !== "missing" ? (
                <span className="font-mono">••••</span>
              ) : null
            ) : item.value ? (
              <span className="font-mono text-foreground">{item.value}</span>
            ) : null}
            {item.updatedAt ? (
              <span>{t("admin.keys.updated", { who: item.updatedBy?.name ?? item.updatedBy?.email ?? "—", when: formatDateTime(item.updatedAt, locale, timeZone) })}</span>
            ) : null}
            {item.note ? <span>“{item.note}”</span> : null}
            {item.docsUrl ? (
              <a href={item.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                {t("admin.keys.whereToGet")}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>
          {item.source === "missing" && item.blocks.length ? (
            <p className="mt-1 text-xs text-warning">
              {t("admin.keys.blocks", { features: item.blocks.map((b) => t(`admin.keys.features.${b}`)).join(", ") })}
            </p>
          ) : null}
        </div>
        {canManage && !editing ? (
          <div className="flex shrink-0 items-center gap-2">
            {item.testable && item.source !== "missing" ? (
              <Button size="sm" variant="ghost" onClick={runTest} loading={busy === "test"}>
                {t("admin.keys.test")}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <KeyRound aria-hidden />
              {item.source === "admin" ? t("admin.keys.replace") : t("admin.keys.set")}
            </Button>
            {item.source === "admin" ? (
              <ActionDialog
                trigger={
                  <Button size="sm" variant="ghost" aria-label={t("admin.keys.clear")}>
                    <RotateCcw aria-hidden />
                    {t("admin.keys.clear")}
                  </Button>
                }
                title={t("admin.keys.clearTitle", { key: item.key })}
                description={item.hostSet ? t("admin.keys.clearToHost") : t("admin.keys.clearToMissing")}
                confirmLabel={t("admin.keys.clear")}
                danger={!item.hostSet}
                onConfirm={async (r) => {
                  await api(`${API}/${item.key}`, { method: "DELETE", body: { reason: r } });
                  setTest(null);
                  router.refresh();
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {item.register ? (
        <div className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">{item.register.kind === "webhook" ? t("admin.keys.webhookUrl") : t("admin.keys.redirectUrl")}</span>
          {item.register.urls.map((u) => (
            <CopyUrl key={u} url={u} />
          ))}
        </div>
      ) : null}

      {canManage && editing ? (
        <form
          className="grid gap-2 rounded-md border bg-surface-2/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() && reason.trim().length >= 3) void save();
          }}
        >
          <Field label={secret ? t("admin.keys.newValue") : t("admin.keys.value")} htmlFor={`${id}-value`} hint={secret ? t("admin.keys.writeOnly") : undefined}>
            <div className="flex items-center gap-1.5">
              <Input
                id={`${id}-value`}
                name={`platform-key-${item.key}`}
                type={secret && !reveal ? "password" : "text"}
                autoComplete={secret ? "new-password" : "off"}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                className="font-mono"
                placeholder={item.placeholder ?? undefined}
                value={value}
                maxLength={4096}
                onChange={(e) => setValue(e.target.value)}
              />
              {secret ? (
                <Button type="button" size="sm" variant="ghost" aria-label={reveal ? t("admin.keys.hide") : t("admin.keys.show")} aria-pressed={reveal} disabled={!value} onClick={() => setReveal((v) => !v)}>
                  {reveal ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label={t("common.reason")} htmlFor={`${id}-reason`} hint={t("admin.common.reasonAudited")}>
            <Input id={`${id}-reason`} required minLength={3} maxLength={500} value={reason} placeholder={t("common.reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {formatError ? <Notice tone="danger">{formatError}</Notice> : <FormError error={error} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
            {item.testable ? (
              <Button type="button" size="sm" variant="secondary" disabled={!value.trim()} loading={busy === "test"} onClick={runTest}>
                {t("admin.keys.test")}
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!value.trim() || reason.trim().length < 3} loading={busy === "save"}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      ) : null}

      {!editing && error ? formatError ? <Notice tone="danger">{formatError}</Notice> : <FormError error={error} /> : null}
      {test ? (
        <Notice tone={test.ok ? "success" : "danger"} title={test.ok ? t("admin.keys.testOk") : t("admin.keys.testFailed")}>
          {test.message}
          {test.kind === "format" && test.ok ? ` ${t("admin.keys.formatOnly")}` : ""}
        </Notice>
      ) : null}
    </div>
  );
}
