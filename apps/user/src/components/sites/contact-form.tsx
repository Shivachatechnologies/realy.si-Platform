"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import type { ContactField } from "@/server/modules/sites/schemas";

export interface ContactFormLabels {
  name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
  send: string;
  sending: string;
  success: string;
  error: string;
  rateLimited: string;
  required: string;
  invalidEmail: string;
  consentDefault: string;
}

const FALLBACK: ContactFormLabels = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  message: "Message",
  send: "Send",
  sending: "Sending…",
  success: "Thanks — your message was sent.",
  error: "Something went wrong. Please try again.",
  rateLimited: "Too many messages. Please try again later.",
  required: "Required",
  invalidEmail: "Enter a valid email address",
  consentDefault: "I agree that my details are stored to answer my request.",
};

const TYPE: Record<ContactField, string> = { name: "text", email: "email", phone: "tel", company: "text", message: "textarea" };
const AUTO: Record<ContactField, string> = { name: "name", email: "email", phone: "tel", company: "organization", message: "off" };

/**
 * Contact / lead form of a published site page. Consent is a required checkbox (its exact text is stored with the
 * submission); a hidden honeypot field and the time the form was open help the server drop bot submissions. In the
 * editor preview (`preview`) the form is inert.
 */
export function SiteContactForm({
  siteSlug,
  pageId,
  blockId,
  fields,
  submitLabel,
  successMessage,
  consentText,
  labels: given,
  preview = false,
}: {
  siteSlug: string;
  pageId: string;
  blockId: string;
  fields: { key: ContactField; required: boolean }[];
  submitLabel: string;
  successMessage: string;
  consentText: string;
  labels?: ContactFormLabels;
  preview?: boolean;
}) {
  const labels = given ?? FALLBACK;
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [honey, setHoney] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const opened = useRef<number>(0);
  useEffect(() => {
    opened.current = Date.now();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (preview) return;
    setBusy(true);
    setError(null);
    setIssues({});
    try {
      const sp = new URLSearchParams(window.location.search);
      const res = await fetch(`/api/public/sites/${encodeURIComponent(siteSlug)}/forms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pageId,
          blockId,
          values,
          consent,
          website: honey || undefined,
          elapsedMs: opened.current ? Date.now() - opened.current : undefined,
          utmSource: sp.get("utm_source")?.slice(0, 100) || undefined,
          utmMedium: sp.get("utm_medium")?.slice(0, 100) || undefined,
          utmCampaign: sp.get("utm_campaign")?.slice(0, 100) || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string | null; error?: { code?: string; details?: { issues?: { path: string; message: string }[] } } } | null;
      if (res.ok) {
        setDone(data?.message || successMessage || labels.success);
        return;
      }
      if (res.status === 429) setError(labels.rateLimited);
      else if (data?.error?.details?.issues?.length) setIssues(Object.fromEntries(data.error.details.issues.map((i) => [i.path, i.message === "invalid_email" ? labels.invalidEmail : labels.required])));
      else setError(labels.error);
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div role="status" className="grid content-center justify-items-start gap-3 rounded-[var(--site-radius)] bg-white p-6 ring-1 ring-slate-200">
        <CircleCheck aria-hidden className="size-8 text-[var(--site-brand)]" />
        <p className="text-base font-medium text-slate-900">{done}</p>
      </div>
    );

  const input = "w-full rounded-[calc(var(--site-radius)*0.6)] border border-slate-300 bg-white px-3 py-2.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[var(--site-brand)] focus:ring-2 focus:ring-[color-mix(in_oklch,var(--site-brand)_30%,transparent)] disabled:opacity-70";
  const idOf = (k: string) => `sf-${blockId}-${k}`;
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {fields.map((f) => (
        <div key={f.key} className="grid gap-1.5">
          <label htmlFor={idOf(f.key)} className="text-sm font-medium text-slate-800">
            {labels[f.key]}
            {f.required ? <span aria-hidden className="text-[var(--site-brand)]"> *</span> : null}
          </label>
          {TYPE[f.key] === "textarea" ? (
            <textarea id={idOf(f.key)} rows={4} className={input} required={f.required} disabled={preview} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} aria-invalid={!!issues[f.key] || undefined} aria-describedby={issues[f.key] ? `${idOf(f.key)}-err` : undefined} maxLength={5000} />
          ) : (
            <input id={idOf(f.key)} type={TYPE[f.key]} autoComplete={AUTO[f.key]} className={input} required={f.required} disabled={preview} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} aria-invalid={!!issues[f.key] || undefined} aria-describedby={issues[f.key] ? `${idOf(f.key)}-err` : undefined} maxLength={f.key === "email" ? 254 : 200} />
          )}
          {issues[f.key] ? (
            <p id={`${idOf(f.key)}-err`} className="text-xs text-red-600">
              {issues[f.key]}
            </p>
          ) : null}
        </div>
      ))}
      {/* Honeypot: hidden from people and assistive technology; bots fill it. */}
      <div aria-hidden className="absolute -start-[9999px] size-px overflow-hidden">
        <label htmlFor={idOf("website")}>Website</label>
        <input id={idOf("website")} type="text" tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} />
      </div>
      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--site-brand)]" checked={consent} disabled={preview} onChange={(e) => setConsent(e.target.checked)} required aria-invalid={!!issues.consent || undefined} />
        <span>
          {consentText || labels.consentDefault}
          {issues.consent ? <span className="block text-xs text-red-600">{issues.consent}</span> : null}
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={preview || busy || !consent} aria-busy={busy || undefined} className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-brand)] px-5 text-sm font-semibold text-[var(--site-brand-fg)] transition hover:brightness-110 disabled:opacity-60 @2xl:w-fit">
        {busy ? labels.sending : submitLabel || labels.send}
      </button>
    </form>
  );
}
