"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ATTACHMENT_ACCEPT, fileToBase64, MAX_ATTACHMENT_BYTES } from "./transaction-form";
import { useAction, type Option } from "./ui";

/** Approve / reject an approval request with an optional note (and, for expense claims, the account that pays it). */
export function DecisionForm({ endpoint, accounts }: { endpoint: string; accounts?: Option[] }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [financeAccountId, setAccount] = useState(accounts?.[0]?.value ?? "");
  const { busy, error, run } = useAction();
  const decide = (decision: "APPROVE" | "REJECT") => {
    if (decision === "REJECT" && !note.trim() && !window.confirm(t("finance.approvals.rejectWithoutNote"))) return;
    void run(() => api(endpoint, { body: { decision, note: note.trim() || null, financeAccountId: accounts ? financeAccountId || null : undefined } }));
  };
  return (
    <div className="grid gap-2">
      {accounts ? (
        accounts.length ? (
          <Field label={t("finance.claims.payFrom")} htmlFor={`dec-acct-${endpoint}`}>
            <Select id={`dec-acct-${endpoint}`} value={financeAccountId} onChange={(e) => setAccount(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-xs text-muted-foreground">{t("finance.claims.firstAccount")}</p>
        )
      ) : null}
      <Textarea rows={2} maxLength={2000} value={note} placeholder={t("finance.approvals.notePlaceholder")} aria-label={t("finance.approvals.note")} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => decide("APPROVE")}>
          <Check aria-hidden />
          {t("finance.approvals.approve")}
        </Button>
        <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => decide("REJECT")}>
          <X aria-hidden />
          {t("finance.approvals.reject")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** "Submit expense": an employee's expense claim with a receipt, sent for approval. */
export function ClaimForm({ base, locale, categories, costCenters, projects }: { base: string; locale: string; categories: Option[]; costCenters: Option[]; projects: Option[] }) {
  const t = useT();
  const router = useRouter();
  const empty = { date: new Date().toISOString().slice(0, 10), amount: "", description: "", merchant: "", categoryId: "", departmentId: "", projectId: "", notes: "" };
  const [v, setV] = useState(empty);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const tooLarge = !!file && file.size > MAX_ATTACHMENT_BYTES;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tooLarge) return;
    void run(
      async () => {
        const receipt = file ? { fileName: file.name, contentType: file.type || "application/octet-stream", dataBase64: await fileToBase64(file) } : undefined;
        return api<{ id: string }>(`${base}/expense-claims`, {
          body: { date: v.date, amount: v.amount, description: v.description, merchant: v.merchant || null, categoryId: v.categoryId || null, departmentId: v.departmentId || null, projectId: v.projectId || null, notes: v.notes || null, receipt },
        });
      },
      (r) => {
        setV(empty);
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        router.push(`/${locale}/finance/claims/${r.id}`);
      },
    );
  };
  const select = (k: "categoryId" | "departmentId" | "projectId", label: string, options: Option[], emptyLabel: string) => (
    <Field label={label} htmlFor={`claim-${k}`}>
      <Select id={`claim-${k}`} value={v[k]} onChange={set(k)}>
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
      <Field label={t("finance.fields.date")} htmlFor="claim-date">
        <Input id="claim-date" type="date" required value={v.date} onChange={set("date")} />
      </Field>
      <Field label={t("finance.fields.amount")} htmlFor="claim-amount">
        <Input id="claim-amount" inputMode="decimal" required pattern="\d{1,13}([.]\d{1,3})?" placeholder="0.00" value={v.amount} onChange={set("amount")} />
      </Field>
      <Field label={t("finance.claims.merchant")} htmlFor="claim-merchant">
        <Input id="claim-merchant" maxLength={200} value={v.merchant} onChange={set("merchant")} />
      </Field>
      <Field label={t("finance.fields.description")} htmlFor="claim-desc" className="sm:col-span-3">
        <Input id="claim-desc" required maxLength={300} value={v.description} onChange={set("description")} placeholder={t("finance.claims.descriptionPlaceholder")} />
      </Field>
      {select("categoryId", t("finance.fields.category"), categories, t("finance.fields.uncategorized"))}
      {select("departmentId", t("finance.fields.costCenter"), costCenters, t("common.none"))}
      {select("projectId", t("finance.fields.project"), projects, t("common.none"))}
      <Field label={t("finance.claims.receipt")} htmlFor="claim-file" hint={t("finance.transactions.attachmentHint")}>
        <Input id="claim-file" ref={fileRef} type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {tooLarge ? <span className="text-xs text-danger">{t("finance.transactions.attachmentTooLarge")}</span> : null}
      </Field>
      <Field label={t("finance.fields.notes")} htmlFor="claim-notes" className="sm:col-span-2">
        <Textarea id="claim-notes" rows={2} maxLength={5000} value={v.notes} onChange={set("notes")} />
      </Field>
      <div className="sm:col-span-3">
        <Button type="submit" disabled={busy || tooLarge}>
          <Send aria-hidden />
          {busy ? t("common.saving") : t("finance.claims.submit")}
        </Button>
      </div>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** "Ask the AI CFO": starts an ai_cfo task about the question; the answer shows below when the task completes. */
export function AskCfoForm({ base }: { base: string }) {
  const t = useT();
  const [question, setQuestion] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (question.trim().length < 3) return;
        void run(() => api(`${base}/ask`, { body: { question: question.trim() } }), () => setQuestion(""));
      }}
    >
      <Textarea rows={2} required minLength={3} maxLength={2000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("finance.ask.placeholder")} aria-label={t("finance.ask.title")} />
      <div>
        <Button type="submit" size="sm" disabled={busy || question.trim().length < 3}>
          <Sparkles aria-hidden />
          {busy ? t("finance.ask.asking") : t("finance.ask.submit")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}
