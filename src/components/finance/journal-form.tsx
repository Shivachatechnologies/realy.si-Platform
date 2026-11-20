"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAction, type Option } from "./ui";

export interface JournalLineValue {
  ledgerAccountId: string;
  debit: string;
  credit: string;
  description: string;
  departmentId: string;
}

const blank = (): JournalLineValue => ({ ledgerAccountId: "", debit: "", credit: "", description: "", departmentId: "" });
/** Sum of decimal strings in thousandths (enough for a balance indicator; the server checks exactly). */
const sum = (xs: string[]) => xs.reduce((s, x) => s + Math.round((Number(x) || 0) * 1000), 0);

/** Manual double-entry journal entry: lines must balance (debits = credits) to post. */
export function JournalForm({ base, locale, accounts, costCenters, id, initial }: { base: string; locale: string; accounts: Option[]; costCenters: Option[]; id?: string; initial?: { date: string; memo: string; lines: JournalLineValue[] } }) {
  const t = useT();
  const router = useRouter();
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [lines, setLines] = useState<JournalLineValue[]>(initial?.lines ?? [blank(), blank()]);
  const { busy, error, run } = useAction();
  const set = (i: number, k: keyof JournalLineValue, v: string) => setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const debit = sum(lines.map((l) => l.debit));
  const credit = sum(lines.map((l) => l.credit));
  const balanced = debit === credit && debit > 0;
  const save = (post: boolean) => {
    const body = { date, memo: memo || null, post, lines: lines.map((l) => ({ ledgerAccountId: l.ledgerAccountId, debit: l.debit || undefined, credit: l.credit || undefined, description: l.description || null, departmentId: l.departmentId || null })) };
    void run(
      () => (id ? api<{ id: string }>(`${base}/journal/${id}`, { method: "PATCH", body }) : api<{ id: string }>(`${base}/journal`, { body })),
      (r) => router.push(`/${locale}/finance/accounting/journal/${r.id}`),
    );
  };
  return (
    <form className="grid gap-3" onSubmit={(e) => e.preventDefault()}>
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label={t("finance.fields.date")} htmlFor="je-date">
          <Input id="je-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("finance.journal.memo")} htmlFor="je-memo">
          <Input id="je-memo" maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-2">
        <div className="hidden gap-2 text-xs text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1.4fr)_8rem_8rem_minmax(0,1fr)_10rem_2.5rem]">
          <span>{t("finance.journal.account")}</span>
          <span>{t("finance.journal.debit")}</span>
          <span>{t("finance.journal.credit")}</span>
          <span>{t("finance.fields.description")}</span>
          <span>{t("finance.fields.costCenter")}</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-2 lg:grid-cols-[minmax(0,1.4fr)_8rem_8rem_minmax(0,1fr)_10rem_2.5rem] lg:border-0 lg:p-0">
            <Select required value={l.ledgerAccountId} aria-label={t("finance.journal.account")} onChange={(e) => set(i, "ledgerAccountId", e.target.value)}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
            <Input inputMode="decimal" pattern="\d{1,13}([.]\d{1,3})?" value={l.debit} placeholder={t("finance.journal.debit")} aria-label={t("finance.journal.debit")} onChange={(e) => set(i, "debit", e.target.value)} />
            <Input inputMode="decimal" pattern="\d{1,13}([.]\d{1,3})?" value={l.credit} placeholder={t("finance.journal.credit")} aria-label={t("finance.journal.credit")} onChange={(e) => set(i, "credit", e.target.value)} />
            <Input maxLength={300} value={l.description} aria-label={t("finance.fields.description")} onChange={(e) => set(i, "description", e.target.value)} />
            <Select value={l.departmentId} aria-label={t("finance.fields.costCenter")} onChange={(e) => set(i, "departmentId", e.target.value)}>
              <option value="">{t("common.none")}</option>
              {costCenters.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            <Button type="button" variant="ghost" size="icon" disabled={lines.length <= 2} aria-label={t("finance.delete")} onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="secondary" disabled={lines.length >= 100} onClick={() => setLines((p) => [...p, blank()])}>
            <Plus aria-hidden />
            {t("finance.journal.addLine")}
          </Button>
          <span className={cn("text-xs tabular-nums", balanced ? "text-success" : "text-danger")}>
            {t("finance.journal.totals", { debit: (debit / 1000).toFixed(2), credit: (credit / 1000).toFixed(2) })} · {balanced ? t("finance.journal.balanced") : t("finance.journal.unbalanced", { diff: (Math.abs(debit - credit) / 1000).toFixed(2) })}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => save(false)}>
          {t("finance.journal.saveDraft")}
        </Button>
        <Button type="button" disabled={busy || !balanced} onClick={() => save(true)}>
          {t("finance.journal.post")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
