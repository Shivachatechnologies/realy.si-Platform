"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { formatMoney, minorUnits } from "@/i18n/format";
import { api } from "@/lib/api-client";
import type { TaxRateOption } from "./document-form";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, uploadTo } from "./transaction-form";
import { useAction, type Option } from "./ui";

export interface BillLineValue {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRateId: string;
  categoryId: string;
  departmentId: string;
  projectId: string;
}

export interface BillValues {
  vendorId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  notes: string;
  lines: BillLineValue[];
}

export interface BillOptions {
  vendors: Option[];
  taxRates: TaxRateOption[];
  categories: Option[];
  costCenters: Option[];
  projects: Option[];
}

const emptyLine = (): BillLineValue => ({ description: "", quantity: "1", unitPrice: "", taxRateId: "", categoryId: "", departmentId: "", projectId: "" });

function preview(lines: BillLineValue[], rates: TaxRateOption[], currency: string) {
  const f = 10 ** minorUnits(currency);
  let net = 0, tax = 0, total = 0;
  for (const l of lines) {
    const gross = Math.round((Number(l.unitPrice) || 0) * f * (Number(l.quantity) || 0));
    const rate = rates.find((r) => r.value === l.taxRateId);
    const bps = rate?.rateBps ?? 0;
    if (rate?.inclusive) {
      const n = Math.round((gross * 10_000) / (10_000 + bps));
      net += n;
      tax += gross - n;
      total += gross;
    } else {
      const t = Math.round((gross * bps) / 10_000);
      net += gross;
      tax += t;
      total += gross + t;
    }
  }
  return { net, tax, total };
}

/** Create or edit a vendor bill: vendor (existing or new), the vendor's bill number, dates, coded line items and a scan. */
export function BillForm({ base, locale, currency, options, initial, id }: { base: string; locale: string; currency: string; options: BillOptions; initial?: Partial<BillValues>; id?: string }) {
  const { t, locale: uiLocale } = useI18n();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState<BillValues>({ vendorId: "", number: "", issueDate: today, dueDate: "", notes: "", lines: [emptyLine()], ...initial });
  const [newVendor, setNewVendor] = useState({ name: "", email: "" });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef(false);
  const { busy, error, run } = useAction();
  const set = (k: keyof BillValues) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const setLine = (i: number, k: keyof BillLineValue, value: string) => setV((p) => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, [k]: value } : l)) }));
  const totals = preview(v.lines, options.taxRates, currency);
  const fmt = (n: number) => formatMoney({ amountMinor: BigInt(n), currency }, uiLocale);
  const tooLarge = !!file && file.size > MAX_ATTACHMENT_BYTES;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tooLarge) return;
    const andSubmit = submitRef.current;
    const lines = v.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice || "0", taxRateId: l.taxRateId || null, categoryId: l.categoryId || null, departmentId: l.departmentId || null, projectId: l.projectId || null }));
    const vendor = v.vendorId ? { vendorId: v.vendorId } : { newVendor: newVendor.name.trim() ? { name: newVendor.name.trim(), email: newVendor.email.trim() || null } : null };
    const body = { ...vendor, number: v.number, issueDate: v.issueDate, dueDate: v.dueDate || undefined, notes: v.notes || null, lines };
    void run(
      async () => {
        const saved = id ? await api<{ id: string }>(`${base}/bills/${id}`, { method: "PATCH", body }) : await api<{ id: string }>(`${base}/bills`, { body });
        if (file) await uploadTo(`${base}/bills/${saved.id}/attachment`, file);
        let submitFailed = false;
        // The bill is saved either way; a failed submission is reported on the bill page.
        if (andSubmit) await api(`${base}/bills/${saved.id}/submit`, { body: {} }).catch(() => (submitFailed = true));
        return { ...saved, submitFailed };
      },
      (saved) => {
        if (fileRef.current) fileRef.current.value = "";
        router.push(`/${locale}/finance/bills/${saved.id}${saved.submitFailed ? "?submit=failed" : ""}`);
      },
    );
  };

  const lineGrid = "sm:grid-cols-[minmax(0,1.6fr)_5rem_7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem]";
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("finance.fields.vendor")} htmlFor="bill-vendor" hint={!v.vendorId ? t("finance.bills.newVendorHint") : undefined}>
          <div className="grid gap-1">
            <Select id="bill-vendor" value={v.vendorId} onChange={set("vendorId")}>
              <option value="">{t("finance.bills.newVendor")}</option>
              {options.vendors.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {!v.vendorId ? (
              <div className="grid gap-1 sm:grid-cols-2">
                <Input value={newVendor.name} required maxLength={200} placeholder={t("finance.fields.name")} aria-label={t("finance.bills.newVendor")} onChange={(e) => setNewVendor((p) => ({ ...p, name: e.target.value }))} />
                <Input type="email" value={newVendor.email} maxLength={254} placeholder={t("finance.fields.email")} aria-label={t("finance.fields.email")} onChange={(e) => setNewVendor((p) => ({ ...p, email: e.target.value }))} />
              </div>
            ) : null}
          </div>
        </Field>
        <Field label={t("finance.bills.number")} htmlFor="bill-number" hint={t("finance.bills.numberHint")}>
          <Input id="bill-number" required maxLength={60} value={v.number} onChange={set("number")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("finance.bills.billDate")} htmlFor="bill-issue">
            <Input id="bill-issue" type="date" required value={v.issueDate} onChange={set("issueDate")} />
          </Field>
          <Field label={t("finance.billing.dueDate")} htmlFor="bill-due" hint={t("finance.billing.dueHint")}>
            <Input id="bill-due" type="date" value={v.dueDate} min={v.issueDate} onChange={set("dueDate")} />
          </Field>
        </div>
      </div>

      <div className="grid gap-2">
        <div className={`hidden gap-2 text-xs text-muted-foreground sm:grid ${lineGrid}`}>
          <span>{t("finance.fields.description")}</span>
          <span>{t("finance.billing.qty")}</span>
          <span>{t("finance.billing.unitPrice")}</span>
          <span>{t("finance.billing.tax")}</span>
          <span>{t("finance.fields.category")}</span>
          <span>{t("finance.fields.costCenter")}</span>
          <span>{t("finance.fields.project")}</span>
          <span />
        </div>
        {v.lines.map((l, i) => (
          <div key={i} className={`grid gap-2 rounded-md border p-2 sm:border-0 sm:p-0 ${lineGrid}`}>
            <Input required maxLength={500} value={l.description} placeholder={t("finance.fields.description")} aria-label={t("finance.fields.description")} onChange={(e) => setLine(i, "description", e.target.value)} />
            <Input required inputMode="decimal" pattern="\d{1,9}([.]\d{1,3})?" value={l.quantity} aria-label={t("finance.billing.qty")} onChange={(e) => setLine(i, "quantity", e.target.value)} />
            <Input required inputMode="decimal" pattern="\d{1,13}([.]\d{1,3})?" value={l.unitPrice} placeholder="0.00" aria-label={t("finance.billing.unitPrice")} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
            <Select value={l.taxRateId} aria-label={t("finance.billing.tax")} onChange={(e) => setLine(i, "taxRateId", e.target.value)}>
              <option value="">{t("finance.billing.noTax")}</option>
              {options.taxRates.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Select value={l.categoryId} aria-label={t("finance.fields.category")} onChange={(e) => setLine(i, "categoryId", e.target.value)}>
              <option value="">{t("finance.fields.uncategorized")}</option>
              {options.categories.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select value={l.departmentId} aria-label={t("finance.fields.costCenter")} onChange={(e) => setLine(i, "departmentId", e.target.value)}>
              <option value="">{t("common.none")}</option>
              {options.costCenters.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select value={l.projectId} aria-label={t("finance.fields.project")} onChange={(e) => setLine(i, "projectId", e.target.value)}>
              <option value="">{t("common.none")}</option>
              {options.projects.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Button type="button" variant="ghost" size="icon" disabled={v.lines.length === 1} aria-label={t("finance.billing.removeLine")} onClick={() => setV((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" size="sm" variant="secondary" disabled={v.lines.length >= 200} onClick={() => setV((p) => ({ ...p, lines: [...p.lines, { ...emptyLine(), departmentId: p.lines.at(-1)?.departmentId ?? "", projectId: p.lines.at(-1)?.projectId ?? "" }] }))}>
            <Plus aria-hidden />
            {t("finance.billing.addLine")}
          </Button>
        </div>
      </div>

      <dl className="ms-auto grid w-full max-w-xs gap-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("finance.billing.subtotal")}</dt>
          <dd className="tabular-nums">{fmt(totals.net)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("finance.billing.tax")}</dt>
          <dd className="tabular-nums">{fmt(totals.tax)}</dd>
        </div>
        <div className="flex justify-between border-t pt-1 font-semibold">
          <dt>{t("finance.billing.total")}</dt>
          <dd className="tabular-nums">{fmt(totals.total)}</dd>
        </div>
        <p className="text-xs text-muted-foreground">{t("finance.billing.previewNote")}</p>
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("finance.fields.notes")} htmlFor="bill-notes">
          <Textarea id="bill-notes" rows={3} maxLength={5000} value={v.notes} onChange={set("notes")} />
        </Field>
        <Field label={t("finance.bills.attachment")} htmlFor="bill-file" hint={id ? t("finance.bills.attachmentReplaceHint") : t("finance.transactions.attachmentHint")}>
          <Input id="bill-file" ref={fileRef} type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {tooLarge ? <span className="text-xs text-danger">{t("finance.transactions.attachmentTooLarge")}</span> : null}
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={busy || tooLarge} onClick={() => (submitRef.current = false)}>
          {busy ? t("common.saving") : id ? t("common.save") : t("finance.bills.saveDraft")}
        </Button>
        <Button type="submit" disabled={busy || tooLarge} onClick={() => (submitRef.current = true)}>
          <Send aria-hidden />
          {t("finance.bills.saveAndSubmit")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("finance.bills.submitHint")}</p>
      <FormError error={error} />
    </form>
  );
}
