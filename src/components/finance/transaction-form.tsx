"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { useAction, type Option } from "./ui";

export interface TxnOptions {
  accounts: Option[];
  categories: (Option & { kind: "INCOME" | "EXPENSE" })[];
  counterparties: (Option & { type: string })[];
  costCenters: Option[];
}

export interface TxnValues {
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  date: string;
  amount: string;
  financeAccountId: string;
  toAccountId: string;
  categoryId: string;
  accountId: string;
  departmentId: string;
  description: string;
  reference: string;
  notes: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/gif,image/heic,text/plain,text/csv";

export async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function upload(base: string, id: string, file: File) {
  await api(`${base}/transactions/${id}/attachment`, { method: "PUT", body: { fileName: file.name, contentType: file.type || "application/octet-stream", dataBase64: await fileToBase64(file) } });
}

/** Create or edit a transaction (income / expense / transfer) with an optional receipt attachment. */
export function TransactionForm({ base, locale, options, initial, id, readOnlyMoney }: { base: string; locale: string; options: TxnOptions; initial?: Partial<TxnValues>; id?: string; readOnlyMoney?: boolean }) {
  const t = useT();
  const router = useRouter();
  const empty: TxnValues = {
    type: "EXPENSE",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    financeAccountId: options.accounts[0]?.value ?? "",
    toAccountId: "",
    categoryId: "",
    accountId: "",
    departmentId: "",
    description: "",
    reference: "",
    notes: "",
  };
  const [v, setV] = useState<TxnValues>({ ...empty, ...initial });
  const [newParty, setNewParty] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, error, run, setError } = useAction();
  const set = (k: keyof TxnValues) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const categories = options.categories.filter((c) => c.kind === v.type);
  const parties = options.counterparties.filter((c) => (v.type === "INCOME" ? c.type !== "VENDOR" : c.type !== "CUSTOMER" && c.type !== "PROSPECT"));
  if (!options.accounts.length) return <Notice tone="warning">{t("finance.transactions.needAccount")}</Notice>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file && file.size > MAX_BYTES) return setError(new Error("too_large"));
    void run(async () => {
      let accountId = v.accountId || null;
      if (!accountId && newParty.trim() && v.type !== "TRANSFER") {
        const a = await api<{ id: string }>(`${base}/counterparties`, { body: { name: newParty.trim(), type: v.type === "INCOME" ? "CUSTOMER" : "VENDOR" } });
        accountId = a.id;
      }
      const body = {
        ...v,
        toAccountId: v.type === "TRANSFER" ? v.toAccountId || null : null,
        categoryId: v.type === "TRANSFER" ? null : v.categoryId || null,
        accountId,
        departmentId: v.departmentId || null,
        reference: v.reference || null,
        notes: v.notes || null,
      };
      const saved = id ? await api<{ id: string }>(`${base}/transactions/${id}`, { method: "PATCH", body }) : await api<{ id: string }>(`${base}/transactions`, { body });
      if (file) await upload(base, saved.id, file);
      return saved;
    }, (saved) => {
      if (!id) {
        setV({ ...empty, financeAccountId: v.financeAccountId, type: v.type });
        setNewParty("");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        if (saved) router.push(`/${locale}/finance/transactions/${saved.id}`);
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
      <Field label={t("finance.transactions.type")} htmlFor="tx-type">
        <Select id="tx-type" value={v.type} disabled={readOnlyMoney} onChange={(e) => setV((p) => ({ ...p, type: e.target.value as TxnValues["type"], categoryId: "" }))}>
          {(["EXPENSE", "INCOME", "TRANSFER"] as const).map((x) => (
            <option key={x} value={x}>
              {t(`finance.transactions.types.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("finance.fields.date")} htmlFor="tx-date">
        <Input id="tx-date" type="date" required value={v.date} disabled={readOnlyMoney} onChange={set("date")} />
      </Field>
      <Field label={t("finance.fields.amount")} htmlFor="tx-amount">
        <Input id="tx-amount" inputMode="decimal" required pattern="\d{1,13}([.]\d{1,3})?" value={v.amount} disabled={readOnlyMoney} onChange={set("amount")} placeholder="0.00" />
      </Field>
      <Field label={v.type === "TRANSFER" ? t("finance.transactions.fromAccount") : t("finance.fields.account")} htmlFor="tx-account">
        <Select id="tx-account" value={v.financeAccountId} disabled={readOnlyMoney} onChange={set("financeAccountId")}>
          {options.accounts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      {v.type === "TRANSFER" ? (
        <Field label={t("finance.transactions.toAccount")} htmlFor="tx-to">
          <Select id="tx-to" required value={v.toAccountId} disabled={readOnlyMoney} onChange={set("toAccountId")}>
            <option value="">—</option>
            {options.accounts
              .filter((o) => o.value !== v.financeAccountId)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </Select>
        </Field>
      ) : (
        <>
          <Field label={t("finance.fields.category")} htmlFor="tx-category">
            <Select id="tx-category" value={v.categoryId} onChange={set("categoryId")}>
              <option value="">{t("finance.fields.uncategorized")}</option>
              {categories.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={v.type === "INCOME" ? t("finance.fields.customer") : t("finance.fields.vendor")} htmlFor="tx-party" hint={v.accountId ? undefined : t("finance.transactions.newPartyHint")}>
            <div className="grid gap-1">
              <Select id="tx-party" value={v.accountId} onChange={set("accountId")}>
                <option value="">{t("common.none")}</option>
                {parties.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {!v.accountId ? <Input value={newParty} maxLength={200} onChange={(e) => setNewParty(e.target.value)} placeholder={t("finance.transactions.newParty")} aria-label={t("finance.transactions.newParty")} /> : null}
            </div>
          </Field>
        </>
      )}
      <Field label={t("finance.fields.costCenter")} htmlFor="tx-cc">
        <Select id="tx-cc" value={v.departmentId} onChange={set("departmentId")}>
          <option value="">{t("common.none")}</option>
          {options.costCenters.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("finance.fields.description")} htmlFor="tx-desc" className="sm:col-span-2">
        <Input id="tx-desc" required maxLength={300} value={v.description} onChange={set("description")} />
      </Field>
      <Field label={t("finance.fields.reference")} htmlFor="tx-ref">
        <Input id="tx-ref" maxLength={120} value={v.reference} onChange={set("reference")} />
      </Field>
      <Field label={t("finance.fields.notes")} htmlFor="tx-notes" className="sm:col-span-2">
        <Textarea id="tx-notes" rows={2} maxLength={5000} value={v.notes} onChange={set("notes")} />
      </Field>
      {!id ? (
        <Field label={t("finance.transactions.attachment")} htmlFor="tx-file" hint={t("finance.transactions.attachmentHint")}>
          <Input id="tx-file" ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy}>
          {id ? null : <Plus aria-hidden />}
          {busy ? t("common.saving") : id ? t("common.save") : t("finance.transactions.add")}
        </Button>
        {file && file.size > MAX_BYTES ? <span className="text-xs text-danger">{t("finance.transactions.attachmentTooLarge")}</span> : null}
      </div>
      <div className="sm:col-span-3">
        <FormError error={error instanceof Error && error.message === "too_large" ? null : error} />
      </div>
    </form>
  );
}

/** Upload / replace / remove the receipt of a transaction. */
export function AttachmentControl({ base, id, attachment, canManage }: { base: string; id: string; attachment: { fileName: string; sizeBytes: number } | null; canManage: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const [tooLarge, setTooLarge] = useState(false);
  const href = `${base}/transactions/${id}/attachment`;
  return (
    <div className="grid gap-2">
      {attachment ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Paperclip className="size-4 text-muted-foreground" aria-hidden />
          <a href={href} target="_blank" rel="noopener" className="font-medium hover:underline">
            {attachment.fileName}
          </a>
          <span className="text-xs text-muted-foreground">{Math.ceil(attachment.sizeBytes / 1024)} KB</span>
          {canManage ? (
            <Button size="sm" variant="ghost" disabled={busy} aria-label={t("finance.transactions.removeAttachment")} onClick={() => void run(() => api(href, { method: "DELETE" }))}>
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("finance.transactions.noAttachment")}</p>
      )}
      {canManage ? (
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs hover:bg-muted">
          <Upload className="size-3.5" aria-hidden />
          {attachment ? t("finance.transactions.replaceAttachment") : t("finance.transactions.uploadAttachment")}
          <input
            type="file"
            className="sr-only"
            accept={ACCEPT}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setTooLarge(f.size > MAX_BYTES);
              if (f.size <= MAX_BYTES) void run(() => upload(base, id, f));
            }}
          />
        </label>
      ) : null}
      {tooLarge ? <Notice tone="danger">{t("finance.transactions.attachmentTooLarge")}</Notice> : null}
      <FormError error={error} />
    </div>
  );
}

/** CSV import: pick a file, send it; shows per-row errors when the import is rejected. */
export function ImportCsv({ base, accounts }: { base: string; accounts: Option[] }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [defaultAccountId, setDefault] = useState(accounts[0]?.value ?? "");
  const [result, setResult] = useState<{ created: number; errors: { row: number; message: string }[] } | null>(null);
  const { busy, error, run } = useAction();
  const rowErrors = (error as { details?: { rows?: { row: number; message: string }[] } } | null)?.details?.rows ?? result?.errors ?? [];
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return;
        setResult(null);
        void run(async () => api<{ created: number; errors: { row: number; message: string }[] }>(`${base}/transactions/import`, { body: { csv: await file.text(), defaultAccountId: defaultAccountId || null } }), setResult);
      }}
    >
      <p className="text-xs text-muted-foreground">{t("finance.transactions.importHint")}</p>
      <code className="block overflow-x-auto rounded-md bg-muted px-2 py-1 text-[11px]">date,type,amount,account,category,counterparty,cost_center,reference,description,notes</code>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("finance.transactions.csvFile")} htmlFor="imp-file">
          <Input id="imp-file" type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label={t("finance.transactions.defaultAccount")} htmlFor="imp-acct">
          <Select id="imp-acct" value={defaultAccountId} onChange={(e) => setDefault(e.target.value)}>
            {accounts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={busy || !file}>
          <Upload aria-hidden />
          {busy ? t("common.saving") : t("finance.transactions.import")}
        </Button>
      </div>
      {result && !result.errors.length ? <Notice tone="success">{t("finance.transactions.imported", { count: result.created })}</Notice> : null}
      {rowErrors.length ? (
        <Notice tone="danger">
          <p>{t("finance.transactions.importRejected")}</p>
          <ul className="mt-1 list-disc ps-4 text-xs">
            {rowErrors.slice(0, 20).map((r, i) => (
              <li key={i}>{t("finance.transactions.importRowError", { row: r.row, field: r.message })}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <FormError error={error} />
      )}
    </form>
  );
}
