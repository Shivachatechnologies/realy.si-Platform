"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, FilePlus2, HandCoins, PiggyBank, Receipt, Sparkles, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { AnimatedProgress } from "@/components/motion/animated-progress";
import { CountUp } from "@/components/motion/count-up";
import { FormError } from "@/components/form-error";
import { AiTaskCard, ChoiceCard, useTaskPoll } from "@/components/crm/guided-kit";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Finance OS beginner flows: six short guided flows (2–4 steps) with recommended choices preselected and jargon explained
 * inline. Each saves through the existing finance API and then shows what changed in plain words.
 */

export const FLOWS = ["income", "expense", "invoice", "payments", "bills", "profit"] as const;
export type Flow = (typeof FLOWS)[number];

export interface Snapshot {
  currency: string;
  monthRevenue: string;
  monthExpenses: string;
  monthProfit: string;
  cash: string;
  receivables: string;
  overdue: string;
  payables: string;
  payablesOverdue: string;
  upcomingCount: number;
  upcomingTotal: string;
  runwayMonths: number | null;
}

export interface FlowOptions {
  accounts: { id: string; name: string; type: string }[];
  incomeCategories: { id: string; name: string }[];
  expenseCategories: { id: string; name: string }[];
  customers: { id: string; name: string; email: string | null }[];
  vendors: { id: string; name: string }[];
  openInvoices: { id: string; number: string; customer: string; dueDate: string; currency: string; balanceMinor: string; overdue: boolean }[];
  upcomingBills: { id: string; number: string; vendor: string; dueDate: string; currency: string; balanceMinor: string; overdue: boolean }[];
  defaultDueDays: number;
}

type Draft = Record<string, string | number | boolean | null>;

export const FLOW_ICON: Record<Flow, typeof Wallet> = { income: TrendingUp, expense: TrendingDown, invoice: FilePlus2, payments: HandCoins, bills: CalendarClock, profit: PiggyBank };
const STEP_COUNT: Record<Flow, number> = { income: 3, expense: 3, invoice: 3, payments: 3, bills: 3, profit: 2 };

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const AMOUNT = /^\d{1,13}(\.\d{1,3})?$/;
const validAmount = (v: unknown) => typeof v === "string" && AMOUNT.test(v.trim()) && /[1-9]/.test(v);
const minorToMajor = (minor: string, digits = 2) => {
  const n = BigInt(minor);
  const s = (n < 0n ? -n : n).toString().padStart(digits + 1, "0");
  return digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
};

/** Plain-language definition shown next to a finance term. */
function Explain({ term, children }: { term: string; children: ReactNode }) {
  return (
    <p className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs">
      <span className="font-semibold text-info">{term}: </span>
      {children}
    </p>
  );
}

export function FinanceFlows({ base, companyBase, locale, options, snapshot, progress, initialFlow, canManage, aiReady }: {
  base: string;
  companyBase: string;
  locale: string;
  options: FlowOptions;
  snapshot: Snapshot;
  progress: Record<Flow, { step: number; data: Draft; completed: boolean }>;
  initialFlow: Flow | null;
  canManage: boolean;
  aiReady: boolean;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [flow, setFlow] = useState<Flow | null>(initialFlow);
  const f = (k: string, v?: Record<string, string | number>) => t(`finance.os.${k}`, v);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FLOWS.map((k, i) => {
          const Icon = FLOW_ICON[k];
          return (
            <motion.button
              key={k}
              type="button"
              onClick={() => setFlow(k)}
              aria-pressed={flow === k}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn("hover-lift grid gap-1 rounded-lg border bg-surface p-4 text-start shadow-elev-1", flow === k && "border-success shadow-glow")}
            >
              <span className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-lg bg-success/10 text-success">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="text-base font-semibold">{f(`flows.${k}.title`)}</span>
                {progress[k].completed ? <CheckCircle2 aria-label={f("doneBefore")} className="ms-auto size-4 text-success" /> : null}
              </span>
              <span className="text-sm text-muted-foreground">{f(`flows.${k}.hint`)}</span>
            </motion.button>
          );
        })}
      </div>
      {flow ? (
        <FlowRunner key={flow} flow={flow} base={base} companyBase={companyBase} locale={locale} options={options} snapshot={snapshot} saved={progress[flow]} canManage={canManage} aiReady={aiReady} onClose={() => setFlow(null)} />
      ) : null}
    </div>
  );
}

function FlowRunner({ flow, base, companyBase, locale, options, snapshot, saved, canManage, aiReady, onClose }: {
  flow: Flow;
  base: string;
  companyBase: string;
  locale: string;
  options: FlowOptions;
  snapshot: Snapshot;
  saved: { step: number; data: Draft };
  canManage: boolean;
  aiReady: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const f = (k: string, v?: Record<string, string | number>) => t(`finance.os.${k}`, v);
  const total = STEP_COUNT[flow];
  const defaults = (): Draft => {
    const cats = flow === "income" ? options.incomeCategories : options.expenseCategories;
    return {
      date: today(),
      amount: "",
      description: "",
      categoryId: cats[0]?.id ?? "",
      accountId: options.accounts[0]?.id ?? "",
      customerId: options.customers.length ? "" : "",
      newCustomer: options.customers.length ? "" : "",
      customerEmail: "",
      item: "",
      quantity: "1",
      price: "",
      dueDays: options.defaultDueDays,
      invoiceId: options.openInvoices[0]?.id ?? "",
      method: "BANK_TRANSFER",
      vendorId: "",
      newVendor: "",
      billNumber: `BILL-${today().replace(/-/g, "")}`,
      dueDate: plusDays(14),
      expenseCategoryId: options.expenseCategories[0]?.id ?? "",
    };
  };
  const [step, setStep] = useState(Math.min(saved.step, total - 1));
  const [data, setData] = useState<Draft>({ ...defaults(), ...saved.data });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ snapshot: Snapshot; extra?: ReactNode } | null>(null);
  const [created, setCreated] = useState<{ invoiceId?: string; number?: string } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useTaskPoll(companyBase, taskId);
  const set = (k: string, v: string | number) => setData((d) => ({ ...d, [k]: v }));
  const str = (k: string) => String(data[k] ?? "");
  const money = (minor: string, cur = snapshot.currency) => formatMoney({ amountMinor: minor, currency: cur }, locale);

  // Save progress server-side whenever the step changes (resume later).
  const persist = (nextStep: number, completed = false) => {
    if (!canManage) return;
    const clean = Object.fromEntries(Object.entries(data).filter(([k]) => /^[a-zA-Z]{1,40}$/.test(k)));
    void api(`${base}/guided/progress/${flow}`, { method: "PUT", body: { step: nextStep, data: clean, completed } }).catch(() => undefined);
  };
  const go = (n: number) => {
    setError(null);
    setStep(n);
    persist(n);
  };
  const finish = async (save: () => Promise<ReactNode | void>) => {
    setBusy(true);
    setError(null);
    try {
      const extra = await save();
      const snap = await api<Snapshot>(`${base}/guided/summary`);
      setResult({ snapshot: snap, extra: extra ?? undefined });
      persist(0, true);
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const Icon = FLOW_ICON[flow];
  const nav = (next: (() => void) | null, nextLabel: string, disabled = false) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      {step > 0 ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => go(step - 1)}>
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
          {f("back")}
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {f("close")}
        </Button>
      )}
      {next ? (
        <Button type="button" size="sm" loading={busy} disabled={disabled || busy} onClick={next}>
          {nextLabel}
          {step < total - 1 ? <ArrowRight aria-hidden className="rtl:-scale-x-100" /> : null}
        </Button>
      ) : null}
    </div>
  );

  if (!canManage && flow !== "profit") return <Notice tone="warning">{f("noPermission")}</Notice>;

  if (result) {
    const s = result.snapshot;
    const profitNeg = BigInt(s.monthProfit) < 0n;
    return (
      <Card variant="highlight" className="animate-fade-up">
        <CardBody className="grid gap-3">
          <p className="flex items-center gap-2 text-base font-semibold text-success">
            <CheckCircle2 aria-hidden className="size-5" />
            {f(`flows.${flow}.done`)}
          </p>
          {result.extra}
          <div className="grid gap-3 sm:grid-cols-3">
            <ChangeTile label={f("profitNow")} money={{ amountMinor: s.monthProfit, currency: s.currency }} tone={profitNeg ? "danger" : "success"} />
            <ChangeTile label={f("owedToYou")} money={{ amountMinor: s.receivables, currency: s.currency }} />
            <ChangeTile label={f("billsDue")} money={{ amountMinor: s.upcomingTotal, currency: s.currency }} />
          </div>
          <p className="text-sm">{f("profitSentence", { amount: money(s.monthProfit, s.currency), revenue: money(s.monthRevenue, s.currency), expenses: money(s.monthExpenses, s.currency) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => { setResult(null); setCreated(null); setData(defaults()); setStep(0); }}>
              {f("again")}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              {f("close")}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card variant="elevated" className="animate-fade-up">
      <CardBody className="grid gap-4">
        <header className="grid gap-2">
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-success uppercase">
            <Icon aria-hidden className="size-3.5" />
            {f(`flows.${flow}.title`)} · {f("stepOf", { n: step + 1, total })}
          </p>
          <AnimatedProgress value={step + 1} max={total} tone="success" label={f("stepOf", { n: step + 1, total })} />
          <h2 className="text-lg font-semibold tracking-tight">{f(`flows.${flow}.q${step + 1}`)}</h2>
        </header>

        {/* ── income / expense ── */}
        {(flow === "income" || flow === "expense") && step === 0 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={f("amount")} htmlFor="g-amount" hint={f("amountHint", { currency: snapshot.currency })}>
                <Input id="g-amount" inputMode="decimal" autoFocus value={str("amount")} onChange={(e) => set("amount", e.target.value)} aria-invalid={!!str("amount") && !validAmount(str("amount"))} />
              </Field>
              <Field label={f("date")} htmlFor="g-date">
                <Input id="g-date" type="date" value={str("date")} onChange={(e) => set("date", e.target.value)} />
              </Field>
              <Field label={f(`flows.${flow}.what`)} htmlFor="g-desc" hint={f(`flows.${flow}.whatHint`)} className="sm:col-span-2">
                <Input id="g-desc" maxLength={300} value={str("description")} onChange={(e) => set("description", e.target.value)} />
              </Field>
            </div>
            {nav(() => go(1), f("continue"), !validAmount(str("amount")) || !str("description").trim() || !str("date"))}
          </>
        ) : null}
        {(flow === "income" || flow === "expense") && step === 1 ? (
          <>
            <AccountPicker base={base} accounts={options.accounts} value={str("accountId")} onChange={(v) => set("accountId", v)} onCreated={() => router.refresh()} />
            <Field label={f("category")} htmlFor="g-cat" hint={f("categoryHint")}>
              <Select id="g-cat" value={str("categoryId")} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">{f("noCategory")}</option>
                {(flow === "income" ? options.incomeCategories : options.expenseCategories).map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {i === 0 ? ` (${f("recommended")})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Explain term={f("terms.category")}>{f("terms.categoryText")}</Explain>
            {nav(() => go(2), f("continue"), !str("accountId"))}
          </>
        ) : null}
        {(flow === "income" || flow === "expense") && step === 2 ? (
          <>
            <Review
              rows={[
                [f("amount"), `${str("amount")} ${snapshot.currency}`],
                [f("date"), str("date")],
                [f(`flows.${flow}.what`), str("description")],
                [f("account"), options.accounts.find((a) => a.id === str("accountId"))?.name ?? "—"],
                [f("category"), [...options.incomeCategories, ...options.expenseCategories].find((c) => c.id === str("categoryId"))?.name ?? f("noCategory")],
              ]}
            />
            <Explain term={f("terms.profit")}>{f("terms.profitText")}</Explain>
            {nav(
              () =>
                void finish(async () => {
                  await api(`${base}/transactions`, {
                    body: { type: flow === "income" ? "INCOME" : "EXPENSE", date: str("date"), amount: str("amount").trim(), financeAccountId: str("accountId"), categoryId: str("categoryId") || null, description: str("description").trim() },
                  });
                }),
              f("save"),
            )}
          </>
        ) : null}

        {/* ── invoice ── */}
        {flow === "invoice" && step === 0 ? (
          <>
            <Explain term={f("terms.invoice")}>{f("terms.invoiceText")}</Explain>
            {options.customers.length ? (
              <Field label={f("customerExisting")} htmlFor="g-cust">
                <Select id="g-cust" value={str("customerId")} onChange={(e) => set("customerId", e.target.value)}>
                  <option value="">{f("customerNewOption")}</option>
                  {options.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {!str("customerId") ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={f("customerName")} htmlFor="g-newcust">
                  <Input id="g-newcust" maxLength={200} value={str("newCustomer")} onChange={(e) => set("newCustomer", e.target.value)} />
                </Field>
                <Field label={f("customerEmail")} htmlFor="g-custemail" hint={f("customerEmailHint")}>
                  <Input id="g-custemail" type="email" maxLength={254} value={str("customerEmail")} onChange={(e) => set("customerEmail", e.target.value)} />
                </Field>
              </div>
            ) : null}
            {nav(() => go(1), f("continue"), !str("customerId") && !str("newCustomer").trim())}
          </>
        ) : null}
        {flow === "invoice" && step === 1 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_6rem_minmax(0,1fr)]">
              <Field label={f("item")} htmlFor="g-item" hint={f("itemHint")}>
                <Input id="g-item" maxLength={500} value={str("item")} onChange={(e) => set("item", e.target.value)} />
              </Field>
              <Field label={f("quantity")} htmlFor="g-qty">
                <Input id="g-qty" inputMode="decimal" value={str("quantity")} onChange={(e) => set("quantity", e.target.value)} />
              </Field>
              <Field label={f("price")} htmlFor="g-price" hint={snapshot.currency}>
                <Input id="g-price" inputMode="decimal" value={str("price")} onChange={(e) => set("price", e.target.value)} />
              </Field>
            </div>
            <Field label={f("dueIn")} htmlFor="g-due" hint={f("dueInHint")}>
              <Select id="g-due" value={String(data.dueDays ?? options.defaultDueDays)} onChange={(e) => set("dueDays", Number(e.target.value))}>
                {[...new Set([7, 14, options.defaultDueDays, 30, 60])].sort((a, b) => a - b).map((d) => (
                  <option key={d} value={d}>
                    {f("days", { count: d })}
                    {d === options.defaultDueDays ? ` (${f("recommended")})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {nav(() => go(2), f("continue"), !str("item").trim() || !validAmount(str("price")) || !/^\d{1,9}(\.\d{1,3})?$/.test(str("quantity")))}
          </>
        ) : null}
        {flow === "invoice" && step === 2 ? (
          created?.invoiceId ? (
            <InvoiceSend base={base} locale={locale} invoiceId={created.invoiceId} number={created.number ?? ""} onDone={(extra) => void finish(async () => extra)} />
          ) : (
            <>
              <Review
                rows={[
                  [f("customer"), options.customers.find((c) => c.id === str("customerId"))?.name ?? str("newCustomer")],
                  [f("item"), str("item")],
                  [f("total"), `${(Number(str("quantity")) * Number(str("price")) || 0).toFixed(2)} ${snapshot.currency} ${f("beforeTax")}`],
                  [f("dueIn"), f("days", { count: Number(data.dueDays ?? options.defaultDueDays) })],
                ]}
              />
              <Explain term={f("terms.receivable")}>{f("terms.receivableText")}</Explain>
              <FormError error={error} />
              {nav(
                () => {
                  setBusy(true);
                  setError(null);
                  api<{ id: string; number: string }>(`${base}/invoices`, {
                    body: {
                      accountId: str("customerId") || null,
                      newCustomer: str("customerId") ? null : { name: str("newCustomer").trim(), email: str("customerEmail").trim() || null },
                      issueDate: today(),
                      dueDate: plusDays(Number(data.dueDays ?? options.defaultDueDays)),
                      lines: [{ description: str("item").trim(), quantity: str("quantity"), unitPrice: str("price").trim() }],
                    },
                  })
                    .then((inv) => setCreated({ invoiceId: inv.id, number: inv.number }))
                    .catch(setError)
                    .finally(() => setBusy(false));
                },
                f("createInvoice"),
              )}
            </>
          )
        ) : null}

        {/* ── payments ── */}
        {flow === "payments" && step === 0 ? (
          <>
            <Explain term={f("terms.payment")}>{f("terms.paymentText")}</Explain>
            {options.openInvoices.length ? (
              <div className="grid gap-2" role="radiogroup" aria-label={f("flows.payments.q1")}>
                {options.openInvoices.slice(0, 20).map((i) => (
                  <ChoiceCard
                    key={i.id}
                    name="inv"
                    value={i.id}
                    checked={str("invoiceId") === i.id}
                    onChange={(v) => {
                      set("invoiceId", v);
                      set("amount", minorToMajor(i.balanceMinor));
                    }}
                    title={`${i.number} · ${i.customer}`}
                    description={`${money(i.balanceMinor, i.currency)} · ${f("due", { date: i.dueDate })}`}
                  >
                    {i.overdue ? <Badge tone="danger">{f("overdue")}</Badge> : null}
                  </ChoiceCard>
                ))}
              </div>
            ) : (
              <Notice action={<Link href={`/${locale}/finance/start?flow=invoice`} className="text-xs underline">{f("flows.invoice.title")}</Link>}>{f("noOpenInvoices")}</Notice>
            )}
            {nav(
              options.openInvoices.length
                ? () => {
                    const inv = options.openInvoices.find((i) => i.id === str("invoiceId"));
                    if (inv && !validAmount(str("amount"))) set("amount", minorToMajor(inv.balanceMinor));
                    go(1);
                  }
                : null,
              f("continue"),
              !str("invoiceId"),
            )}
          </>
        ) : null}
        {flow === "payments" && step === 1 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={f("amountReceived")} htmlFor="g-pamount" hint={f("amountReceivedHint")}>
                <Input id="g-pamount" inputMode="decimal" value={str("amount")} onChange={(e) => set("amount", e.target.value)} />
              </Field>
              <Field label={f("date")} htmlFor="g-pdate">
                <Input id="g-pdate" type="date" value={str("date")} onChange={(e) => set("date", e.target.value)} />
              </Field>
            </div>
            <AccountPicker base={base} accounts={options.accounts} value={str("accountId")} onChange={(v) => set("accountId", v)} onCreated={() => router.refresh()} />
            {nav(() => go(2), f("continue"), !validAmount(str("amount")) || !str("accountId"))}
          </>
        ) : null}
        {flow === "payments" && step === 2 ? (
          <>
            <Review
              rows={[
                [f("invoice"), options.openInvoices.find((i) => i.id === str("invoiceId"))?.number ?? "—"],
                [f("amountReceived"), `${str("amount")} ${snapshot.currency}`],
                [f("date"), str("date")],
                [f("account"), options.accounts.find((a) => a.id === str("accountId"))?.name ?? "—"],
              ]}
            />
            {nav(
              () =>
                void finish(async () => {
                  await api(`${base}/invoices/${str("invoiceId")}/payments`, { body: { amount: str("amount").trim(), date: str("date"), method: "BANK_TRANSFER", financeAccountId: str("accountId") } });
                }),
              f("recordPayment"),
            )}
          </>
        ) : null}

        {/* ── bills ── */}
        {flow === "bills" && step === 0 ? (
          <>
            <Explain term={f("terms.payable")}>{f("terms.payableText")}</Explain>
            {options.upcomingBills.length ? (
              <ul className="grid divide-y rounded-md border text-sm">
                {options.upcomingBills.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    {b.overdue ? <Badge tone="danger">{f("overdue")}</Badge> : <Badge tone="warning">{f("due", { date: b.dueDate })}</Badge>}
                    <Link href={`/${locale}/finance/bills/${b.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {b.vendor} · {b.number}
                    </Link>
                    <span className="tabular-nums">{money(b.balanceMinor, b.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Notice tone="success">{f("noUpcomingBills")}</Notice>
            )}
            {nav(() => go(1), f("addBill"))}
          </>
        ) : null}
        {flow === "bills" && step === 1 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {options.vendors.length ? (
                <Field label={f("vendorExisting")} htmlFor="g-vendor">
                  <Select id="g-vendor" value={str("vendorId")} onChange={(e) => set("vendorId", e.target.value)}>
                    <option value="">{f("vendorNewOption")}</option>
                    {options.vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {!str("vendorId") ? (
                <Field label={f("vendorName")} htmlFor="g-newvendor" hint={f("vendorHint")}>
                  <Input id="g-newvendor" maxLength={200} value={str("newVendor")} onChange={(e) => set("newVendor", e.target.value)} />
                </Field>
              ) : null}
              <Field label={f("billNumber")} htmlFor="g-billno" hint={f("billNumberHint")}>
                <Input id="g-billno" maxLength={60} value={str("billNumber")} onChange={(e) => set("billNumber", e.target.value)} />
              </Field>
              <Field label={f("amount")} htmlFor="g-bamount" hint={snapshot.currency}>
                <Input id="g-bamount" inputMode="decimal" value={str("amount")} onChange={(e) => set("amount", e.target.value)} />
              </Field>
              <Field label={f("dueDate")} htmlFor="g-bdue">
                <Input id="g-bdue" type="date" value={str("dueDate")} onChange={(e) => set("dueDate", e.target.value)} />
              </Field>
              <Field label={f("category")} htmlFor="g-bcat">
                <Select id="g-bcat" value={str("expenseCategoryId")} onChange={(e) => set("expenseCategoryId", e.target.value)}>
                  <option value="">{f("noCategory")}</option>
                  {options.expenseCategories.map((c, i) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {i === 0 ? ` (${f("recommended")})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {nav(() => go(2), f("continue"), (!str("vendorId") && !str("newVendor").trim()) || !str("billNumber").trim() || !validAmount(str("amount")) || !str("dueDate"))}
          </>
        ) : null}
        {flow === "bills" && step === 2 ? (
          <>
            <Review
              rows={[
                [f("vendor"), options.vendors.find((v) => v.id === str("vendorId"))?.name ?? str("newVendor")],
                [f("billNumber"), str("billNumber")],
                [f("amount"), `${str("amount")} ${snapshot.currency}`],
                [f("dueDate"), str("dueDate")],
              ]}
            />
            <p className="text-xs text-muted-foreground">{f("billApprovalNote")}</p>
            {nav(
              () =>
                void finish(async () => {
                  await api(`${base}/bills`, {
                    body: {
                      vendorId: str("vendorId") || null,
                      newVendor: str("vendorId") ? null : { name: str("newVendor").trim() },
                      number: str("billNumber").trim(),
                      issueDate: today(),
                      dueDate: str("dueDate"),
                      lines: [{ description: str("billNumber").trim(), quantity: "1", unitPrice: str("amount").trim(), categoryId: str("expenseCategoryId") || null }],
                      submit: true,
                    },
                  });
                }),
              f("saveBill"),
            )}
          </>
        ) : null}

        {/* ── profit ── */}
        {flow === "profit" && step === 0 ? (
          <>
            <ProfitEquation snapshot={snapshot} />
            <Explain term={f("terms.profit")}>{f("terms.profitText")}</Explain>
            <Explain term={f("terms.cashflow")}>{f("terms.cashflowText")}</Explain>
            {nav(() => go(1), f("askWhy"))}
          </>
        ) : null}
        {flow === "profit" && step === 1 ? (
          <>
            {!aiReady ? <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
            <Field label={f("question")} htmlFor="g-q">
              <Input id="g-q" maxLength={2000} value={str("question") || f("defaultQuestion", { amount: money(snapshot.monthProfit) })} onChange={(e) => set("question", e.target.value)} />
            </Field>
            {!taskId ? (
              <div>
                <Button
                  type="button"
                  variant="gradient"
                  loading={busy}
                  disabled={!aiReady || busy}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    const question = (str("question") || f("defaultQuestion", { amount: money(snapshot.monthProfit) })).trim();
                    api<{ id: string }>(`${base}/ask`, { body: { question: `${question} (Answer in the language of the locale "${locale}".)` } })
                      .then((r) => setTaskId(r.id))
                      .catch(setError)
                      .finally(() => setBusy(false));
                  }}
                >
                  <Sparkles aria-hidden />
                  {f("askCfo")}
                </Button>
              </div>
            ) : (
              <AiTaskCard task={task ?? { id: taskId, status: "QUEUED", output: null }} locale={locale} />
            )}
            {nav(null, "")}
          </>
        ) : null}

        {flow !== "invoice" || step !== 2 ? <FormError error={error} /> : null}
      </CardBody>
    </Card>
  );
}

function ChangeTile({ label, money, tone }: { label: string; money: { amountMinor: string; currency: string }; tone?: "success" | "danger" }) {
  return (
    <div className={cn("rounded-lg border p-3", tone === "danger" ? "border-danger/40 bg-danger/5" : tone === "success" ? "border-success/40 bg-success/5" : "bg-surface")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "success" && "text-success")}>
        <CountUp money={money} />
      </p>
    </div>
  );
}

function Review({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-2 rounded-lg border bg-surface-2/60 p-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="font-medium break-words">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Revenue − expenses = profit, this month, as an animated visual equation. */
export function ProfitEquation({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const f = (k: string) => t(`finance.os.${k}`);
  const rev = Number(snapshot.monthRevenue);
  const exp = Number(snapshot.monthExpenses);
  const max = Math.max(1, rev, exp);
  const bar = (v: number, color: string, i: number) => (
    <motion.div className={cn("h-3 rounded-full", color)} style={{ width: `${Math.max(2, (Math.abs(v) / max) * 100)}%`, transformOrigin: "left" }} initial={reduced ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: i * 0.25, duration: 0.8 }} />
  );
  const profit = BigInt(snapshot.monthProfit);
  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground">{f("thisMonth")}</p>
      <div className="grid gap-1">
        <span className="flex justify-between text-sm">
          <span>{f("moneyIn")}</span>
          <CountUp money={{ amountMinor: snapshot.monthRevenue, currency: snapshot.currency }} />
        </span>
        {bar(rev, "bg-success", 0)}
      </div>
      <div className="grid gap-1">
        <span className="flex justify-between text-sm">
          <span>− {f("moneyOut")}</span>
          <CountUp money={{ amountMinor: snapshot.monthExpenses, currency: snapshot.currency }} />
        </span>
        {bar(exp, "bg-danger", 1)}
      </div>
      <div className="flex items-baseline justify-between border-t pt-2">
        <span className="font-semibold">= {f("profit")}</span>
        <span className={cn("text-xl font-semibold", profit < 0n ? "text-danger" : "text-success")}>
          <CountUp money={{ amountMinor: snapshot.monthProfit, currency: snapshot.currency }} />
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{profit < 0n ? f("lossVerdict") : profit === 0n ? f("zeroVerdict") : f("profitVerdict")}</p>
    </div>
  );
}

/** Account select; when the company has none yet, a one-click "create my main account" (recommended). */
function AccountPicker({ base, accounts, value, onChange, onCreated }: { base: string; accounts: FlowOptions["accounts"]; value: string; onChange: (v: string) => void; onCreated: () => void }) {
  const { t } = useI18n();
  const f = (k: string) => t(`finance.os.${k}`);
  const [name, setName] = useState(f("mainAccount"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!value && accounts[0]) onChange(accounts[0].id);
  }, [accounts, value, onChange]);
  if (accounts.length) {
    return (
      <Field label={f("account")} htmlFor="g-acct" hint={f("accountHint")}>
        <Select id="g-acct" value={value} onChange={(e) => onChange(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border border-dashed p-3">
      <p className="text-sm">{f("noAccount")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={f("accountName")} htmlFor="g-newacct">
          <Input id="g-newacct" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button
          type="button"
          size="sm"
          loading={busy}
          disabled={!name.trim() || busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            api<{ id: string }>(`${base}/accounts`, { body: { name: name.trim(), type: "BANK", openingBalance: "0" } })
              .then((a) => {
                onChange(a.id);
                onCreated();
              })
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          <Wallet aria-hidden />
          {f("createAccount")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}

/** After creating an invoice: email it (truthful provider status), mark it sent, or keep it as a draft. */
function InvoiceSend({ base, locale, invoiceId, number, onDone }: { base: string; locale: string; invoiceId: string; number: string; onDone: (extra: ReactNode) => void }) {
  const { t } = useI18n();
  const f = (k: string, v?: Record<string, string>) => t(`finance.os.${k}`, v);
  const [mode, setMode] = useState<"email" | "mark" | "draft">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "email") {
        const r = await api<{ status: string }>(`${base}/invoices/${invoiceId}/send`, { body: { subject: f("emailSubject", { number }), message: f("emailMessage", { number }), locale } });
        onDone(
          r.status === "SENT" ? (
            <Notice tone="success">{f("emailSent")}</Notice>
          ) : r.status === "NOT_CONFIGURED" ? (
            <Notice tone="warning" action={<Link href={`/${locale}/integrations`} className="text-xs underline">{f("connectEmail")}</Link>}>{f("emailNotConfigured")}</Notice>
          ) : (
            <Notice tone="danger">{f("emailFailed")}</Notice>
          ),
        );
      } else if (mode === "mark") {
        await api(`${base}/invoices/${invoiceId}/mark-sent`, { body: {} });
        onDone(<Notice tone="success">{f("markedSent")}</Notice>);
      } else {
        onDone(<Notice>{f("keptDraft")}</Notice>);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <Notice tone="success" action={<Link href={`/${locale}/finance/invoices/${invoiceId}`} className="text-xs underline">{f("openInvoice")}</Link>}>
        {f("invoiceCreated", { number })}
      </Notice>
      <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label={f("sendHow")}>
        <ChoiceCard name="send" value="email" checked={mode === "email"} onChange={() => setMode("email")} title={f("sendEmail")} description={f("sendEmailHint")} recommended recommendedLabel={f("recommended")} />
        <ChoiceCard name="send" value="mark" checked={mode === "mark"} onChange={() => setMode("mark")} title={f("sendMark")} description={f("sendMarkHint")} />
        <ChoiceCard name="send" value="draft" checked={mode === "draft"} onChange={() => setMode("draft")} title={f("sendDraft")} description={f("sendDraftHint")} />
      </div>
      <div>
        <Button type="button" loading={busy} disabled={busy} onClick={() => void go()}>
          <Receipt aria-hidden />
          {f("finishInvoice")}
        </Button>
      </div>
      <FormError error={error} />
    </div>
  );
}
