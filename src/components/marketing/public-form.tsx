"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api-client";

interface PublicField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "select" | "checkbox";
  required: boolean;
  options?: string[];
}

/** Public lead-capture form (no auth). Passes UTM parameters from the page URL for attribution. */
export function PublicLeadForm({ formId, fields, submitLabel, successMessage, companyName, utm }: { formId: string; fields: PublicField[]; submitLabel: string | null; successMessage: string | null; companyName: string; utm: { campaign?: string; source?: string; medium?: string } }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const fieldErrors = error instanceof ApiError ? error.fieldErrors() : {};
  const issues = error instanceof ApiError ? ((error.details?.issues as { path: string; message: string }[] | undefined) ?? []) : [];
  const issueFor = (key: string) => issues.find((i) => i.path === key)?.message ?? fieldErrors[`values.${key}`];
  if (done !== null) return <Notice tone="success">{done || t("marketing.publicForm.thanks")}</Notice>;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ message: string | null }>(`/api/public/forms/${formId}`, { body: { values, consent, campaign: utm.campaign, utmSource: utm.source, utmMedium: utm.medium, website } });
          setDone(r.message ?? successMessage ?? "");
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map((f) => {
        const id = `pf-${f.key}`;
        const issue = issueFor(f.key);
        const err = issue ? t(`marketing.publicForm.errors.${issue}`) : undefined;
        const value = typeof values[f.key] === "string" ? (values[f.key] as string) : "";
        const set = (v: string | boolean) => setValues((p) => ({ ...p, [f.key]: v }));
        if (f.type === "checkbox") {
          return (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" required={f.required} checked={values[f.key] === true} onChange={(e) => set(e.target.checked)} />
              {f.label}
              {err ? <span className="text-xs text-danger">{err}</span> : null}
            </label>
          );
        }
        return (
          <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={id} error={err}>
            {f.type === "textarea" ? (
              <Textarea id={id} rows={4} required={f.required} maxLength={5000} value={value} onChange={(e) => set(e.target.value)} />
            ) : f.type === "select" ? (
              <Select id={id} required={f.required} value={value} onChange={(e) => set(e.target.value)}>
                <option value="" />
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={id} type={f.type} required={f.required} maxLength={f.type === "email" ? 254 : 500} autoComplete={f.type === "email" ? "email" : f.type === "tel" ? "tel" : undefined} value={value} onChange={(e) => set(e.target.value)} />
            )}
          </Field>
        );
      })}
      <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t("marketing.publicForm.consent", { company: companyName })}</span>
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? t("marketing.publicForm.sending") : submitLabel || t("marketing.publicForm.submit")}
      </Button>
      {error && !issues.length ? <FormError error={error} /> : null}
    </form>
  );
}
