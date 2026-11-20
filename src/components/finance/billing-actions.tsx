"use client";

import { useState, type FormEvent } from "react";
import { Copy, Mail, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction, type Option } from "./ui";

/**
 * Compose and send an invoice, reminder or estimate email. The outcome is shown truthfully: only "sent" means the
 * provider accepted it; "not configured" means nothing left the platform.
 */
export function SendEmailForm({ endpoint, to, subject, message, link }: { endpoint: string; to: string | null; subject: string; message: string; link?: string }) {
  const { t, locale } = useI18n();
  const [v, setV] = useState({ to: to ?? "", subject, message: link ? `${message}\n\n${link}` : message });
  const [status, setStatus] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setStatus(null);
        void run(() => api<{ status: string }>(endpoint, { body: { to: v.to || undefined, subject: v.subject, message: v.message, locale } }), (r) => setStatus(r.status));
      }}
    >
      <Field label={t("finance.email.to")} htmlFor="em-to">
        <Input id="em-to" type="email" required maxLength={254} value={v.to} onChange={(e) => setV((p) => ({ ...p, to: e.target.value }))} />
      </Field>
      <Field label={t("finance.email.subject")} htmlFor="em-subject">
        <Input id="em-subject" required maxLength={200} value={v.subject} onChange={(e) => setV((p) => ({ ...p, subject: e.target.value }))} />
      </Field>
      <Field label={t("finance.email.message")} htmlFor="em-message" hint={link ? t("finance.email.linkHint") : undefined}>
        <Textarea id="em-message" rows={8} required maxLength={5000} value={v.message} onChange={(e) => setV((p) => ({ ...p, message: e.target.value }))} />
      </Field>
      <div>
        <Button type="submit" disabled={busy}>
          <Mail aria-hidden />
          {busy ? t("finance.email.sending") : t("finance.email.send")}
        </Button>
      </div>
      {status === "SENT" ? <Notice tone="success">{t("finance.email.sent")}</Notice> : null}
      {status === "NOT_CONFIGURED" ? <Notice tone="warning">{t("finance.email.notConfigured")}</Notice> : null}
      {status === "FAILED" ? <Notice tone="danger">{t("finance.email.failed")}</Notice> : null}
      <FormError error={error} />
    </form>
  );
}

export function PaymentForm({ endpoint, accounts, balance, currencyHint }: { endpoint: string; accounts: Option[]; balance: string; currencyHint: string }) {
  const t = useT();
  const [v, setV] = useState({ amount: balance, date: new Date().toISOString().slice(0, 10), method: "BANK_TRANSFER", financeAccountId: accounts[0]?.value ?? "", reference: "" });
  const { busy, error, run } = useAction();
  if (!accounts.length) return <Notice tone="warning">{t("finance.transactions.needAccount")}</Notice>;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(endpoint, { body: { ...v, reference: v.reference || null } }));
      }}
    >
      <Field label={t("finance.fields.amount")} htmlFor="pay-amount" hint={currencyHint}>
        <Input id="pay-amount" inputMode="decimal" required pattern="\d{1,13}([.]\d{1,3})?" value={v.amount} onChange={(e) => setV((p) => ({ ...p, amount: e.target.value }))} />
      </Field>
      <Field label={t("finance.fields.date")} htmlFor="pay-date">
        <Input id="pay-date" type="date" required value={v.date} onChange={(e) => setV((p) => ({ ...p, date: e.target.value }))} />
      </Field>
      <Field label={t("finance.payments.method")} htmlFor="pay-method">
        <Select id="pay-method" value={v.method} onChange={(e) => setV((p) => ({ ...p, method: e.target.value }))}>
          {["BANK_TRANSFER", "CARD", "CASH", "CHECK", "OTHER"].map((m) => (
            <option key={m} value={m}>
              {t(`finance.payments.methods.${m}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("finance.payments.depositTo")} htmlFor="pay-account">
        <Select id="pay-account" value={v.financeAccountId} onChange={(e) => setV((p) => ({ ...p, financeAccountId: e.target.value }))}>
          {accounts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("finance.fields.reference")} htmlFor="pay-ref" className="sm:col-span-2">
        <Input id="pay-ref" maxLength={120} value={v.reference} onChange={(e) => setV((p) => ({ ...p, reference: e.target.value }))} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? t("common.saving") : t("finance.payments.record")}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ApplyCreditForm({ base, invoiceId, credits }: { base: string; invoiceId: string; credits: { id: string; label: string; remaining: string }[] }) {
  const t = useT();
  const [creditId, setCreditId] = useState(credits[0]?.id ?? "");
  const [amount, setAmount] = useState(credits[0]?.remaining ?? "");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(() => api(`${base}/credit-notes/${creditId}/apply`, { body: { invoiceId, amount } }));
      }}
    >
      <Field label={t("finance.creditNotes.title")} htmlFor="cr-note">
        <Select
          id="cr-note"
          value={creditId}
          onChange={(e) => {
            setCreditId(e.target.value);
            setAmount(credits.find((c) => c.id === e.target.value)?.remaining ?? "");
          }}
        >
          {credits.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("finance.fields.amount")} htmlFor="cr-amount">
        <Input id="cr-amount" inputMode="decimal" required pattern="\d{1,13}([.]\d{1,3})?" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || !creditId}>
          {t("finance.creditNotes.apply")}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function CopyLink({ url }: { url: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input readOnly value={url} className="h-8 min-w-0 flex-1 font-mono text-xs" aria-label={t("finance.invoices.publicLink")} onFocus={(e) => e.target.select()} />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <Copy aria-hidden />
        {copied ? t("finance.copied") : t("finance.copy")}
      </Button>
    </div>
  );
}

export function PrintButton() {
  const t = useT();
  return (
    <Button type="button" size="sm" variant="secondary" className="print:hidden" onClick={() => window.print()}>
      <Printer aria-hidden />
      {t("finance.print")}
    </Button>
  );
}
