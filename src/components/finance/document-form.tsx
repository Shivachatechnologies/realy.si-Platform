"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { formatMoney, minorUnits } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { useAction, type Option } from "./ui";

export interface TaxRateOption {
  value: string;
  label: string;
  rateBps: number;
  inclusive: boolean;
}

export interface LineValue {
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRateId: string;
}

export interface DocValues {
  accountId: string;
  issueDate: string;
  dueDate: string;
  expiryDate: string;
  discount: string;
  notes: string;
  terms: string;
  name: string;
  frequency: string;
  nextIssueDate: string;
  endDate: string;
  dueDays: string;
  lines: LineValue[];
}

const emptyLine = (): LineValue => ({ description: "", quantity: "1", unitPrice: "", discount: "", taxRateId: "" });

/** Client preview of the totals (the server recomputes authoritatively with exact integer arithmetic). */
function preview(lines: LineValue[], docDiscount: string, rates: TaxRateOption[], currency: string) {
  const f = 10 ** minorUnits(currency);
  const d = Math.min(Math.max(Number(docDiscount) || 0, 0), 100) / 100;
  let subtotal = 0, discount = 0, tax = 0, total = 0;
  for (const l of lines) {
    const gross = Math.round((Number(l.unitPrice) || 0) * f * (Number(l.quantity) || 0));
    const afterLine = gross - Math.round(gross * (Math.min(Math.max(Number(l.discount) || 0, 0), 100) / 100));
    const net = afterLine - Math.round(afterLine * d);
    const rate = rates.find((r) => r.value === l.taxRateId);
    const bps = rate?.rateBps ?? 0;
    let lineTax: number, lineTotal: number;
    if (rate?.inclusive) {
      lineTotal = net;
      lineTax = net - Math.round((net * 10_000) / (10_000 + bps));
    } else {
      lineTax = Math.round((net * bps) / 10_000);
      lineTotal = net + lineTax;
    }
    subtotal += gross;
    discount += gross - net;
    tax += lineTax;
    total += lineTotal;
  }
  return { subtotal, discount, tax, total };
}

/**
 * Invoice / estimate / recurring-invoice editor: customer (existing or new), dates, line items with quantity, unit price,
 * discount and tax, document discount, notes and terms.
 */
export function DocumentForm({
  kind,
  base,
  locale,
  currency,
  customers,
  taxRates,
  initial,
  id,
}: {
  kind: "invoice" | "estimate" | "recurring";
  base: string;
  locale: string;
  currency: string;
  customers: Option[];
  taxRates: TaxRateOption[];
  initial?: Partial<DocValues>;
  id?: string;
}) {
  const { t, locale: uiLocale } = useI18n();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState<DocValues>({
    accountId: "",
    issueDate: today,
    dueDate: "",
    expiryDate: "",
    discount: "",
    notes: "",
    terms: "",
    name: "",
    frequency: "MONTHLY",
    nextIssueDate: today,
    endDate: "",
    dueDays: "30",
    lines: [emptyLine()],
    ...initial,
  });
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "" });
  const { busy, error, run } = useAction();
  const set = (k: keyof DocValues) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const setLine = (i: number, k: keyof LineValue, value: string) => setV((p) => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, [k]: value } : l)) }));
  const totals = preview(v.lines, v.discount, taxRates, currency);
  const fmt = (n: number) => formatMoney({ amountMinor: BigInt(n), currency }, uiLocale);
  const path = kind === "invoice" ? "invoices" : kind === "estimate" ? "estimates" : "recurring-invoices";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const lines = v.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice || "0", discount: l.discount === "" ? 0 : Number(l.discount), taxRateId: l.taxRateId || null }));
    const customer = v.accountId ? { accountId: v.accountId } : kind === "recurring" ? {} : { newCustomer: newCustomer.name.trim() ? { name: newCustomer.name.trim(), email: newCustomer.email.trim() || null } : null };
    const common = { ...customer, discount: v.discount === "" ? 0 : Number(v.discount), notes: v.notes || null, lines };
    const body =
      kind === "invoice"
        ? { ...common, issueDate: v.issueDate, dueDate: v.dueDate || undefined, terms: v.terms || null }
        : kind === "estimate"
          ? { ...common, issueDate: v.issueDate, expiryDate: v.expiryDate || null, terms: v.terms || null }
          : { ...common, name: v.name, frequency: v.frequency, nextIssueDate: v.nextIssueDate, endDate: v.endDate || null, dueDays: Number(v.dueDays || 0) };
    void run(
      () => (id ? api<{ id: string }>(`${base}/${path}/${id}`, { method: "PATCH", body }) : api<{ id: string }>(`${base}/${path}`, { body })),
      (r) => {
        if (kind === "recurring") return;
        router.push(`/${locale}/finance/${path}/${r.id}`);
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {kind === "recurring" ? (
          <Field label={t("finance.fields.name")} htmlFor="doc-name">
            <Input id="doc-name" required maxLength={200} value={v.name} onChange={set("name")} />
          </Field>
        ) : null}
        <Field label={t("finance.fields.customer")} htmlFor="doc-customer" hint={!v.accountId && kind !== "recurring" ? t("finance.billing.newCustomerHint") : undefined}>
          <div className="grid gap-1">
            <Select id="doc-customer" value={v.accountId} required={kind === "recurring"} onChange={set("accountId")}>
              <option value="">{kind === "recurring" ? "—" : t("finance.billing.newCustomer")}</option>
              {customers.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            {!v.accountId && kind !== "recurring" ? (
              <div className="grid gap-1 sm:grid-cols-2">
                <Input value={newCustomer.name} required maxLength={200} placeholder={t("finance.fields.name")} aria-label={t("finance.billing.newCustomerName")} onChange={(e) => setNewCustomer((p) => ({ ...p, name: e.target.value }))} />
                <Input type="email" value={newCustomer.email} maxLength={254} placeholder={t("finance.fields.email")} aria-label={t("finance.fields.email")} onChange={(e) => setNewCustomer((p) => ({ ...p, email: e.target.value }))} />
              </div>
            ) : null}
          </div>
        </Field>
        {kind === "recurring" ? (
          <>
            <Field label={t("finance.recurring.frequency")} htmlFor="doc-freq">
              <Select id="doc-freq" value={v.frequency} onChange={set("frequency")}>
                {["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"].map((x) => (
                  <option key={x} value={x}>
                    {t(`finance.frequency.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("finance.recurring.nextIssue")} htmlFor="doc-next">
              <Input id="doc-next" type="date" required value={v.nextIssueDate} onChange={set("nextIssueDate")} />
            </Field>
            <Field label={t("finance.recurring.endDate")} htmlFor="doc-end">
              <Input id="doc-end" type="date" value={v.endDate} onChange={set("endDate")} />
            </Field>
            <Field label={t("finance.recurring.dueDays")} htmlFor="doc-duedays">
              <Input id="doc-duedays" type="number" min={0} max={365} value={v.dueDays} onChange={set("dueDays")} />
            </Field>
          </>
        ) : (
          <>
            <Field label={t("finance.billing.issueDate")} htmlFor="doc-issue">
              <Input id="doc-issue" type="date" required value={v.issueDate} onChange={set("issueDate")} />
            </Field>
            {kind === "invoice" ? (
              <Field label={t("finance.billing.dueDate")} htmlFor="doc-due" hint={t("finance.billing.dueHint")}>
                <Input id="doc-due" type="date" value={v.dueDate} onChange={set("dueDate")} />
              </Field>
            ) : (
              <Field label={t("finance.billing.expiryDate")} htmlFor="doc-exp">
                <Input id="doc-exp" type="date" value={v.expiryDate} onChange={set("expiryDate")} />
              </Field>
            )}
          </>
        )}
        <Field label={t("finance.billing.docDiscount")} htmlFor="doc-discount" hint={t("finance.billing.docDiscountHint")}>
          <Input id="doc-discount" type="number" min={0} max={100} step="0.01" value={v.discount} onChange={set("discount")} />
        </Field>
      </div>

      <div className="grid gap-2">
        <div className="hidden gap-2 text-xs text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_8rem_6rem_10rem_2.5rem]">
          <span>{t("finance.fields.description")}</span>
          <span>{t("finance.billing.qty")}</span>
          <span>{t("finance.billing.unitPrice")}</span>
          <span>{t("finance.billing.discountPct")}</span>
          <span>{t("finance.billing.tax")}</span>
          <span />
        </div>
        {v.lines.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_6rem_10rem_2.5rem] sm:border-0 sm:p-0">
            <Input required maxLength={500} value={l.description} placeholder={t("finance.fields.description")} aria-label={t("finance.fields.description")} onChange={(e) => setLine(i, "description", e.target.value)} />
            <Input required inputMode="decimal" pattern="\d{1,9}([.]\d{1,3})?" value={l.quantity} aria-label={t("finance.billing.qty")} onChange={(e) => setLine(i, "quantity", e.target.value)} />
            <Input required inputMode="decimal" pattern="\d{1,13}([.]\d{1,3})?" value={l.unitPrice} placeholder="0.00" aria-label={t("finance.billing.unitPrice")} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
            <Input type="number" min={0} max={100} step="0.01" value={l.discount} aria-label={t("finance.billing.discountPct")} onChange={(e) => setLine(i, "discount", e.target.value)} />
            <Select value={l.taxRateId} aria-label={t("finance.billing.tax")} onChange={(e) => setLine(i, "taxRateId", e.target.value)}>
              <option value="">{t("finance.billing.noTax")}</option>
              {taxRates.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Button type="button" variant="ghost" size="icon" disabled={v.lines.length === 1} aria-label={t("finance.billing.removeLine")} onClick={() => setV((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" size="sm" variant="secondary" disabled={v.lines.length >= 200} onClick={() => setV((p) => ({ ...p, lines: [...p.lines, emptyLine()] }))}>
            <Plus aria-hidden />
            {t("finance.billing.addLine")}
          </Button>
        </div>
      </div>

      <dl className="ms-auto grid w-full max-w-xs gap-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("finance.billing.subtotal")}</dt>
          <dd className="tabular-nums">{fmt(totals.subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("finance.billing.discount")}</dt>
          <dd className="tabular-nums">−{fmt(totals.discount)}</dd>
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
        <Field label={t("finance.fields.notes")} htmlFor="doc-notes">
          <Textarea id="doc-notes" rows={3} maxLength={5000} value={v.notes} onChange={set("notes")} />
        </Field>
        {kind !== "recurring" ? (
          <Field label={t("finance.billing.terms")} htmlFor="doc-terms">
            <Textarea id="doc-terms" rows={3} maxLength={5000} value={v.terms} onChange={set("terms")} />
          </Field>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? t("common.saving") : id ? t("common.save") : t(`finance.billing.create.${kind}`)}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
