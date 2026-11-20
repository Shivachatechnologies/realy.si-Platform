"use client";

import { useState } from "react";
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./use-action";

export function AddConnection({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const [protocol, setProtocol] = useState<"OIDC" | "SAML">("OIDC");
  const [f, setF] = useState({
    name: "",
    issuer: "",
    clientId: "",
    clientSecret: "",
    samlMetadataXml: "",
    samlEntityId: "",
    samlSsoUrl: "",
  });
  const a = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const body =
    protocol === "OIDC"
      ? {
          protocol,
          name: f.name,
          issuer: f.issuer,
          clientId: f.clientId,
          clientSecret: f.clientSecret,
        }
      : {
          protocol,
          name: f.name,
          samlMetadataXml: f.samlMetadataXml || undefined,
          samlEntityId: f.samlEntityId || undefined,
          samlSsoUrl: f.samlSsoUrl || undefined,
        };
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(
          () =>
            api(`/api/v1/organizations/${orgId}/enterprise/sso/connections`, {
              body,
            }),
          () =>
            setF({
              name: "",
              issuer: "",
              clientId: "",
              clientSecret: "",
              samlMetadataXml: "",
              samlEntityId: "",
              samlSsoUrl: "",
            }),
        );
      }}
    >
      <Field label={t("enterprise.sso.protocol")} htmlFor="sso-proto">
        <Select id="sso-proto" value={protocol} onChange={(e) => setProtocol(e.target.value as "OIDC" | "SAML")}>
          <option value="OIDC">OpenID Connect (OIDC)</option>
          <option value="SAML">SAML 2.0</option>
        </Select>
      </Field>
      <Field label={t("enterprise.sso.name")} htmlFor="sso-name" error={a.fields.name}>
        <Input id="sso-name" value={f.name} maxLength={80} required onChange={set("name")} placeholder={t("enterprise.sso.namePlaceholder")} />
      </Field>
      {protocol === "OIDC" ? (
        <>
          <Field label={t("enterprise.sso.issuer")} htmlFor="sso-issuer" hint={t("enterprise.sso.issuerHint")} error={a.fields.issuer} className="sm:col-span-2">
            <Input id="sso-issuer" type="url" dir="ltr" value={f.issuer} required onChange={set("issuer")} placeholder="https://login.example.com" />
          </Field>
          <Field label={t("enterprise.sso.clientId")} htmlFor="sso-cid" error={a.fields.clientId}>
            <Input id="sso-cid" dir="ltr" value={f.clientId} required onChange={set("clientId")} />
          </Field>
          <Field label={t("enterprise.sso.clientSecret")} htmlFor="sso-secret" hint={t("enterprise.sso.secretHint")} error={a.fields.clientSecret}>
            <Input id="sso-secret" type="password" dir="ltr" autoComplete="off" value={f.clientSecret} required onChange={set("clientSecret")} />
          </Field>
        </>
      ) : (
        <>
          <Notice tone="info" className="sm:col-span-2">
            {t("enterprise.sso.samlNote")}
          </Notice>
          <Field label={t("enterprise.sso.samlEntityId")} htmlFor="sso-entity">
            <Input id="sso-entity" dir="ltr" value={f.samlEntityId} onChange={set("samlEntityId")} />
          </Field>
          <Field label={t("enterprise.sso.samlSsoUrl")} htmlFor="sso-url" error={a.fields.samlSsoUrl}>
            <Input id="sso-url" type="url" dir="ltr" value={f.samlSsoUrl} onChange={set("samlSsoUrl")} />
          </Field>
          <Field label={t("enterprise.sso.samlMetadata")} htmlFor="sso-meta" className="sm:col-span-2">
            <Textarea id="sso-meta" dir="ltr" rows={5} className="font-mono text-xs" value={f.samlMetadataXml} onChange={set("samlMetadataXml")} />
          </Field>
        </>
      )}
      <div className="grid gap-2 sm:col-span-2">
        <FormError error={a.error} />
        <div>
          <Button type="submit" disabled={a.busy || !f.name}>
            <Plus aria-hidden />
            {t("enterprise.sso.addConnection")}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function ConnectionActions({ orgId, id, enabled, protocol }: { orgId: string; id: string; enabled: boolean; protocol: string }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const a = useAction();
  const url = `/api/v1/organizations/${orgId}/enterprise/sso/connections/${id}`;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={enabled ? "secondary" : "default"}
          disabled={a.busy || (protocol === "SAML" && !enabled)}
          onClick={() => void a.run(() => api(url, { method: "PATCH", body: { enabled: !enabled } }))}
        >
          {enabled ? t("enterprise.sso.disable") : t("enterprise.sso.enable")}
        </Button>
        {confirm ? (
          <Button size="sm" variant="danger" disabled={a.busy} onClick={() => void a.run(() => api(url, { method: "DELETE" }))}>
            {t("enterprise.sso.confirmDelete")}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" aria-label={t("enterprise.sso.delete")} onClick={() => setConfirm(true)}>
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
      <FormError error={a.error} />
    </div>
  );
}

export function AddDomain({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const [domain, setDomain] = useState("");
  const a = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(
          () =>
            api(`/api/v1/organizations/${orgId}/enterprise/sso/domains`, {
              body: { domain },
            }),
          () => setDomain(""),
        );
      }}
    >
      <Field label={t("enterprise.sso.domain")} htmlFor="sso-domain" error={a.fields.domain} className="min-w-60 flex-1">
        <Input id="sso-domain" dir="ltr" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
      </Field>
      <Button type="submit" variant="secondary" disabled={a.busy || !domain}>
        <Plus aria-hidden />
        {t("enterprise.sso.addDomain")}
      </Button>
      <div className="w-full">
        <FormError error={a.error} />
      </div>
    </form>
  );
}

export function DomainActions({ orgId, id, verified }: { orgId: string; id: string; verified: boolean }) {
  const { t } = useI18n();
  const [result, setResult] = useState<{
    verified: boolean;
    found: boolean;
  } | null>(null);
  const a = useAction();
  const url = `/api/v1/organizations/${orgId}/enterprise/sso/domains/${id}`;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap gap-1">
        {!verified ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={a.busy}
            onClick={() =>
              void a.run(
                () =>
                  api<{ verified: boolean; found: boolean }>(url, {
                    method: "POST",
                    body: {},
                  }),
                setResult,
              )
            }
          >
            <RefreshCw aria-hidden />
            {t("enterprise.sso.checkDns")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" aria-label={t("enterprise.sso.removeDomain")} disabled={a.busy} onClick={() => void a.run(() => api(url, { method: "DELETE" }))}>
          <Trash2 aria-hidden />
        </Button>
      </div>
      {result && !result.found ? <p className="text-xs text-warning">{t("enterprise.sso.txtNotFound")}</p> : null}
      <FormError error={a.error} />
    </div>
  );
}

export function CopyValue({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <code dir="ltr" className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">
        {value}
      </code>
      <button
        type="button"
        className="rounded p-1 text-muted-foreground hover:bg-muted"
        aria-label={t("enterprise.developers.copy")}
        onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
      >
        <Copy className="size-3.5" aria-hidden />
      </button>
      {copied ? <Badge tone="success">{t("enterprise.developers.copied")}</Badge> : null}
    </span>
  );
}

export function EnforceSsoToggle({ orgId, enforced, ready }: { orgId: string; enforced: boolean; ready: boolean }) {
  const { t } = useI18n();
  const a = useAction();
  return (
    <div className="grid gap-2">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={enforced}
          disabled={a.busy || (!ready && !enforced)}
          onChange={(e) =>
            void a.run(() =>
              api(`/api/v1/organizations/${orgId}/enterprise/sso`, {
                method: "PUT",
                body: { enforceSso: e.target.checked },
              }),
            )
          }
        />
        <span>
          <span className="font-medium">{t("enterprise.sso.enforce")}</span>
          <span className="block text-xs text-muted-foreground">{ready ? t("enterprise.sso.enforceHint") : t("enterprise.sso.enforceNotReady")}</span>
        </span>
      </label>
      <FormError error={a.error} />
    </div>
  );
}
