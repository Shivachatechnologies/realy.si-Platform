"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, Pencil, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { Markdownish } from "@/components/comms/markdownish";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction } from "./lead-forms";

/** Client parts of proposal management: create, editor (sections + priced lines), send, AI draft, public decision. */

export interface ProposalLineValue {
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  tax: string;
}
export interface ProposalValues {
  title: string;
  contactId: string;
  validUntil: string;
  intro: string;
  scope: string;
  timeline: string;
  terms: string;
  createEstimateOnAccept: boolean;
  lines: ProposalLineValue[];
}

const SECTIONS = ["intro", "scope", "timeline", "terms"] as const;
const emptyLine: ProposalLineValue = { description: "", quantity: "1", unitPrice: "", discount: "0", tax: "0" };

export function NewProposalForm({ base, locale, deals, dealId }: { base: string; locale: string; deals: { id: string; name: string }[]; dealId?: string }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ dealId: dealId ?? deals[0]?.id ?? "", title: "" });
  const { busy, error, run } = useAction();
  if (!deals.length && !dealId) return <p className="text-sm text-muted-foreground">{t("crm.proposals.needDeal")}</p>;
  return (
    <form
      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => api<{ id: string }>(`${base}/crm/proposals`, { body: { dealId: f.dealId, title: f.title } }),
          (p) => router.push(`/${locale}/crm/proposals/${p.id}`),
        );
      }}
    >
      {dealId ? null : (
        <Field label={t("crm.proposals.deal")} htmlFor="np-deal">
          <Select id="np-deal" value={f.dealId} required onChange={(e) => setF((p) => ({ ...p, dealId: e.target.value }))}>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("crm.proposals.titleLabel")} htmlFor="np-title" className={dealId ? "sm:col-span-2" : undefined}>
        <Input id="np-title" value={f.title} required maxLength={200} placeholder={t("crm.proposals.titlePlaceholder")} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} />
      </Field>
      <Button type="submit" disabled={busy || !f.title.trim() || !f.dealId}>
        <Plus aria-hidden />
        {t("crm.proposals.create")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Client-side preview of the totals (the server recomputes them on save). */
function previewTotals(lines: ProposalLineValue[]) {
  let subtotal = 0;
  let net = 0;
  let tax = 0;
  for (const l of lines) {
    const gross = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
    const n = gross * (1 - (Number(l.discount) || 0) / 100);
    subtotal += gross;
    net += n;
    tax += n * ((Number(l.tax) || 0) / 100);
  }
  return { subtotal, discount: subtotal - net, tax, total: net + tax };
}

export function ProposalEditor({
  base,
  proposalId,
  currency,
  contacts,
  initial,
  locked,
  revisedNotice,
}: {
  base: string;
  proposalId: string;
  currency: string;
  contacts: { id: string; name: string }[];
  initial: ProposalValues;
  locked: boolean;
  revisedNotice: boolean;
}) {
  const { t, locale } = useI18n();
  const [f, setF] = useState<ProposalValues>(initial);
  const [preview, setPreview] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const totals = useMemo(() => previewTotals(f.lines), [f.lines]);
  const fmt = (v: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(v);
    } catch {
      return `${v.toFixed(2)} ${currency}`;
    }
  };
  const setLine = (i: number, patch: Partial<ProposalLineValue>) => setF((p) => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const disabled = locked || busy;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void run(
          () =>
            api(`${base}/crm/proposals/${proposalId}`, {
              method: "PATCH",
              body: {
                title: f.title,
                contactId: f.contactId || null,
                validUntil: f.validUntil || null,
                intro: f.intro,
                scope: f.scope,
                timeline: f.timeline,
                terms: f.terms,
                createEstimateOnAccept: f.createEstimateOnAccept,
                lines: f.lines.filter((l) => l.description.trim() || l.unitPrice).map((l) => ({ ...l, unitPrice: l.unitPrice || "0", discount: l.discount || "0", tax: l.tax || "0" })),
              },
            }),
          () => setSaved(true),
        );
      }}
    >
      {revisedNotice && !locked ? <Notice tone="info">{t("crm.proposals.revisionNotice")}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("crm.proposals.titleLabel")} htmlFor="pe-title" className="sm:col-span-3">
          <Input id="pe-title" value={f.title} required maxLength={200} disabled={disabled} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} />
        </Field>
        <Field label={t("crm.fields.contact")} htmlFor="pe-contact">
          <Select id="pe-contact" value={f.contactId} disabled={disabled} onChange={(e) => setF((p) => ({ ...p, contactId: e.target.value }))}>
            <option value="">{t("common.none")}</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("crm.proposals.validUntil")} htmlFor="pe-valid">
          <Input id="pe-valid" type="date" value={f.validUntil} disabled={disabled} onChange={(e) => setF((p) => ({ ...p, validUntil: e.target.value }))} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={f.createEstimateOnAccept} disabled={disabled} onChange={(e) => setF((p) => ({ ...p, createEstimateOnAccept: e.target.checked }))} />
          {t("crm.proposals.estimateOnAccept")}
        </label>
      </div>

      {SECTIONS.map((key) => (
        <div key={key} className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`pe-${key}`} className="text-sm font-medium">
              {t(`crm.proposals.sections.${key}`)}
            </label>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreview((p) => ({ ...p, [key]: !p[key] }))}>
              {preview[key] ? <Pencil aria-hidden /> : <Eye aria-hidden />}
              {preview[key] ? t("crm.edit") : t("crm.proposals.preview")}
            </Button>
          </div>
          {preview[key] ? (
            <div className="min-h-20 rounded-md border p-3 text-sm">{f[key].trim() ? <Markdownish text={f[key]} className="grid gap-2" /> : <span className="text-muted-foreground">—</span>}</div>
          ) : (
            <Textarea id={`pe-${key}`} rows={key === "scope" ? 8 : 5} maxLength={20000} disabled={disabled} value={f[key]} onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))} />
          )}
        </div>
      ))}
      <p className="-mt-2 text-xs text-muted-foreground">{t("crm.proposals.formatHint")}</p>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">{t("crm.proposals.lines")}</legend>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="p-1 text-start font-medium">{t("crm.proposals.description")}</th>
                <th className="w-20 p-1 text-end font-medium">{t("crm.proposals.quantity")}</th>
                <th className="w-32 p-1 text-end font-medium">{t("crm.proposals.unitPrice", { currency })}</th>
                <th className="w-20 p-1 text-end font-medium">{t("crm.proposals.discountPct")}</th>
                <th className="w-20 p-1 text-end font-medium">{t("crm.proposals.taxPct")}</th>
                <th className="w-10 p-1" />
              </tr>
            </thead>
            <tbody>
              {f.lines.map((l, i) => (
                <tr key={i}>
                  <td className="p-1">
                    <Input aria-label={t("crm.proposals.description")} value={l.description} maxLength={500} disabled={disabled} onChange={(e) => setLine(i, { description: e.target.value })} />
                  </td>
                  <td className="p-1">
                    <Input aria-label={t("crm.proposals.quantity")} inputMode="decimal" className="text-end" value={l.quantity} disabled={disabled} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  </td>
                  <td className="p-1">
                    <Input aria-label={t("crm.proposals.unitPrice", { currency })} inputMode="decimal" className="text-end" value={l.unitPrice} disabled={disabled} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                  </td>
                  <td className="p-1">
                    <Input aria-label={t("crm.proposals.discountPct")} inputMode="decimal" className="text-end" value={l.discount} disabled={disabled} onChange={(e) => setLine(i, { discount: e.target.value })} />
                  </td>
                  <td className="p-1">
                    <Input aria-label={t("crm.proposals.taxPct")} inputMode="decimal" className="text-end" value={l.tax} disabled={disabled} onChange={(e) => setLine(i, { tax: e.target.value })} />
                  </td>
                  <td className="p-1">
                    <Button type="button" size="icon" variant="ghost" disabled={disabled} aria-label={t("crm.delete")} onClick={() => setF((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))}>
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Button type="button" size="sm" variant="secondary" disabled={disabled || f.lines.length >= 200} onClick={() => setF((p) => ({ ...p, lines: [...p.lines, { ...emptyLine }] }))}>
            <Plus aria-hidden />
            {t("crm.proposals.addLine")}
          </Button>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm tabular-nums">
            <dt className="text-muted-foreground">{t("crm.proposals.subtotal")}</dt>
            <dd className="text-end">{fmt(totals.subtotal)}</dd>
            <dt className="text-muted-foreground">{t("crm.proposals.discount")}</dt>
            <dd className="text-end">−{fmt(totals.discount)}</dd>
            <dt className="text-muted-foreground">{t("crm.proposals.tax")}</dt>
            <dd className="text-end">{fmt(totals.tax)}</dd>
            <dt className="font-medium">{t("crm.proposals.total")}</dt>
            <dd className="text-end font-medium">{fmt(totals.total)}</dd>
          </dl>
        </div>
        <p className="text-xs text-muted-foreground">{t("crm.proposals.totalsHint")}</p>
      </fieldset>

      {locked ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || !f.title.trim()}>
            {t("common.save")}
          </Button>
          {saved && !busy ? <span className="text-sm text-success">{t("crm.proposals.saved")}</span> : null}
        </div>
      )}
      <FormError error={error} />
    </form>
  );
}

export function SendProposalForm({ base, proposalId, defaultTo, defaultSubject, emailReady }: { base: string; proposalId: string; defaultTo: string; defaultSubject: string; emailReady: boolean }) {
  const { t, locale } = useI18n();
  const [f, setF] = useState({ to: defaultTo, subject: defaultSubject, message: "" });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSentTo(null);
        void run(
          () => api<{ to: string }>(`${base}/crm/proposals/${proposalId}/send`, { body: { to: f.to, subject: f.subject, message: f.message || undefined, locale } }),
          (r) => setSentTo(r.to),
        );
      }}
    >
      {!emailReady ? <Notice tone="warning">{t("crm.proposals.emailNotConfigured")}</Notice> : null}
      <Field label={t("crm.proposals.sendTo")} htmlFor="ps-to">
        <Input id="ps-to" type="email" required maxLength={254} value={f.to} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))} />
      </Field>
      <Field label={t("crm.proposals.subject")} htmlFor="ps-subject">
        <Input id="ps-subject" required maxLength={200} value={f.subject} onChange={(e) => setF((p) => ({ ...p, subject: e.target.value }))} />
      </Field>
      <Field label={t("crm.proposals.message")} htmlFor="ps-message" hint={t("crm.proposals.messageHint")}>
        <Textarea id="ps-message" rows={4} maxLength={5000} value={f.message} onChange={(e) => setF((p) => ({ ...p, message: e.target.value }))} />
      </Field>
      <div>
        <Button type="submit" disabled={busy || !f.to.trim() || !f.subject.trim()}>
          <Send aria-hidden />
          {t("crm.proposals.send")}
        </Button>
      </div>
      {sentTo ? <Notice tone="success">{t("crm.proposals.sentTo", { to: sentTo })}</Notice> : null}
      <FormError error={error} />
    </form>
  );
}

/** "Draft with AI" (creates the agent task and opens it). */
export function DraftWithAiButton({ base, locale, proposalId }: { base: string; locale: string; proposalId: string }) {
  const t = useT();
  const router = useRouter();
  const [guidance, setGuidance] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <Field label={t("crm.assistGuidance")} htmlFor="pa-guidance" hint={t("crm.proposals.aiHint")}>
        <Input id="pa-guidance" value={guidance} maxLength={1000} placeholder={t("crm.assistPlaceholder")} onChange={(e) => setGuidance(e.target.value)} />
      </Field>
      <div>
        <Button
          type="button"
          disabled={busy}
          onClick={() => void run(() => api<{ id: string }>(`${base}/crm/proposals/${proposalId}/ai`, { body: { guidance: guidance.trim() || undefined } }), (task) => router.push(`/${locale}/tasks/${task.id}`))}
        >
          <Sparkles aria-hidden />
          {t("crm.proposals.draftWithAi")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** "Use AI draft": copies a completed task's output into the sections. */
export function UseAiDraftButton({ base, proposalId, taskId }: { base: string; proposalId: string; taskId: string }) {
  const t = useT();
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          if (window.confirm(t("crm.proposals.useAiConfirm"))) void run(() => api(`${base}/crm/proposals/${proposalId}/ai/apply`, { body: { taskId } }), () => window.location.reload());
        }}
      >
        <Check aria-hidden />
        {t("crm.proposals.useAiDraft")}
      </Button>
      <FormError error={error} />
    </span>
  );
}

/** Customer decision on the public page. */
export function ProposalDecisionForm({ token }: { token: string }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ name: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const decide = async (decision: "accept" | "decline") => {
    if (!f.name.trim()) return;
    if (!window.confirm(t(decision === "accept" ? "crm.publicProposal.acceptConfirm" : "crm.publicProposal.declineConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/public/proposals/${token}/decision`, { body: { decision, name: f.name, note: f.note || undefined } });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={(e) => e.preventDefault()}>
      <Field label={t("crm.publicProposal.yourName")} htmlFor="pd-name">
        <Input id="pd-name" required maxLength={200} autoComplete="name" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
      </Field>
      <Field label={t("crm.publicProposal.note")} htmlFor="pd-note">
        <Textarea id="pd-note" rows={3} maxLength={2000} value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !f.name.trim()} onClick={() => void decide("accept")}>
          <Check aria-hidden />
          {t("crm.publicProposal.accept")}
        </Button>
        <Button type="button" variant="secondary" disabled={busy || !f.name.trim()} onClick={() => void decide("decline")}>
          <X aria-hidden />
          {t("crm.publicProposal.decline")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("crm.publicProposal.recordNote")}</p>
      <FormError error={error} />
    </form>
  );
}
