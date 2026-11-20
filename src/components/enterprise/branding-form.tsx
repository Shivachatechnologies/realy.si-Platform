"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./use-action";

export function BrandingForm({
  orgId,
  initial,
  canManage,
}: {
  orgId: string;
  initial: {
    productName: string;
    logoUrl: string;
    primaryColor: string;
    customDomain: string;
  };
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [f, setF] = useState(initial);
  const a = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const color = /^#[0-9a-fA-F]{6}$/.test(f.primaryColor) ? f.primaryColor : "#4f46e5";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() =>
            api(`/api/v1/organizations/${orgId}/enterprise/branding`, {
              method: "PUT",
              body: f,
            }),
          );
        }}
      >
        <fieldset disabled={!canManage} className="contents">
          <Field label={t("enterprise.branding.productName")} htmlFor="br-name" error={a.fields.productName}>
            <Input id="br-name" value={f.productName} maxLength={60} onChange={set("productName")} placeholder="Realy" />
          </Field>
          <Field label={t("enterprise.branding.logoUrl")} htmlFor="br-logo" error={a.fields.logoUrl}>
            <Input id="br-logo" type="url" dir="ltr" value={f.logoUrl} onChange={set("logoUrl")} />
          </Field>
          <Field label={t("enterprise.branding.primaryColor")} htmlFor="br-color" error={a.fields.primaryColor}>
            <div className="flex gap-2">
              <input
                type="color"
                aria-label={t("enterprise.branding.primaryColor")}
                value={color}
                onChange={(e) => setF((p) => ({ ...p, primaryColor: e.target.value }))}
                className="h-9 w-12 cursor-pointer rounded-md border bg-surface"
              />
              <Input id="br-color" dir="ltr" className="font-mono" value={f.primaryColor} maxLength={7} onChange={set("primaryColor")} placeholder="#4f46e5" />
            </div>
          </Field>
          <Field label={t("enterprise.branding.customDomain")} htmlFor="br-domain" hint={t("enterprise.branding.customDomainHint")} error={a.fields.customDomain}>
            <Input id="br-domain" dir="ltr" value={f.customDomain} onChange={set("customDomain")} placeholder="app.example.com" />
          </Field>
        </fieldset>
        <div className="grid gap-2 sm:col-span-2">
          <FormError error={a.error} />
          {a.done ? <Notice tone="success">{t("enterprise.saved")}</Notice> : null}
          {canManage ? (
            <div>
              <Button type="submit" disabled={a.busy}>
                {t("common.save")}
              </Button>
            </div>
          ) : null}
        </div>
      </form>
      <div className="grid content-start gap-2" aria-label={t("enterprise.branding.preview")}>
        <p className="text-xs font-medium text-muted-foreground">{t("enterprise.branding.preview")}</p>
        <div className="grid gap-3 rounded-lg border p-4">
          <div className="flex items-center gap-2 font-semibold">
            {f.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL
              <img src={f.logoUrl} alt="" className="size-6 rounded object-contain" />
            ) : (
              <span className="size-6 rounded" style={{ background: color }} />
            )}
            {f.productName || "Realy"}
          </div>
          <span className="inline-flex h-9 w-fit items-center rounded-md px-4 text-sm font-medium text-white" style={{ background: color }}>
            {t("enterprise.branding.sampleButton")}
          </span>
        </div>
      </div>
    </div>
  );
}

export function VerifyDomainButton({ orgId }: { orgId: string }) {
  const { t } = useI18n();
  const [result, setResult] = useState<boolean | null>(null);
  const a = useAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={a.busy}
        onClick={() =>
          void a.run(
            () => api<{ verified: boolean }>(`/api/v1/organizations/${orgId}/enterprise/branding/verify`, { method: "POST", body: {} }),
            (r) => setResult(r.verified),
          )
        }
      >
        <RefreshCw aria-hidden />
        {t("enterprise.sso.checkDns")}
      </Button>
      {result === false ? <span className="text-xs text-warning">{t("enterprise.sso.txtNotFound")}</span> : null}
      <FormError error={a.error} />
    </span>
  );
}
