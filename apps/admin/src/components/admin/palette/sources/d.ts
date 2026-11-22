import { Coins, CreditCard, FileText, Layers, ReceiptText, TicketPercent, TrendingUp } from "lucide-react";
import { commandSource, type PaletteSource } from "../types";
import { formatMoney } from "@/i18n/format";

const PRICING = ["pricing.read", "platform.subscriptions.read"] as const;

/** Stream D — billing results from the `billing` search provider, plus billing commands. */
export const paletteD: PaletteSource[] = [
  {
    group: "subscriptions",
    label: "admin.nav.subscriptions",
    order: 45,
    hits: ({ data, base, t }) =>
      (data?.subscriptions ?? []).map((s) => ({ id: `s:${s.id}`, label: s.organization.name, sub: `${s.plan.name} · ${t(`admin.subscriptions.status.${s.status}`)}`, href: `${base}/subscriptions/${s.id}`, icon: ReceiptText })),
  },
  {
    group: "invoices",
    label: "admin.invoices.nav",
    order: 46,
    hits: ({ data, base, t }) =>
      (data?.invoices ?? []).map((i) => ({ id: `i:${i.id}`, label: i.number ?? i.stripeInvoiceId, sub: `${formatMoney({ amountMinor: i.totalMinor, currency: i.currency }, "en-US")} · ${t(`admin.invoices.status.${i.status}`)}`, href: `${base}/invoices/${i.id}`, icon: FileText })),
  },
  {
    group: "payments",
    label: "admin.payments.nav",
    order: 47,
    hits: ({ data, base, t }) =>
      (data?.payments ?? []).map((p) => ({ id: `p:${p.id}`, label: p.stripeChargeId ?? p.id, sub: `${formatMoney({ amountMinor: p.amountMinor, currency: p.currency }, "en-US")} · ${t(`admin.payments.status.${p.status}`)}`, href: `${base}/payments/${p.id}`, icon: CreditCard })),
  },
  {
    group: "plans",
    label: "admin.nav.plans",
    order: 48,
    hits: ({ data, base }) => (data?.plans ?? []).map((p) => ({ id: `pl:${p.id}`, label: p.name, sub: `${p.key} · ${p.status}`, href: `${base}/plans`, icon: Layers })),
  },
  {
    group: "promotions",
    label: "admin.growth.coupons",
    order: 49,
    hits: ({ data, base }) => (data?.promotions ?? []).map((p) => ({ id: `pr:${p.id}`, label: p.name, sub: p.codes.join(", "), href: `${base}/plans`, icon: TicketPercent })),
  },
  commandSource({
    group: "billing-commands",
    label: "admin.nav.billing",
    order: 51,
    commands: [
      { id: "billing-overview", label: "admin.revenue.overview.nav", href: "/revenue", icon: TrendingUp, perms: PRICING, keywords: ["mrr", "arr", "revenue", "net"] },
      { id: "failed-payments", label: "admin.revenue.overview.failed", href: "/payments?status=failed", icon: CreditCard, perms: PRICING, keywords: ["failed", "dunning"] },
      { id: "open-disputes", label: "admin.payments.disputes.title", href: "/payments/disputes?open=1", icon: CreditCard, perms: PRICING, keywords: ["dispute", "chargeback"] },
      { id: "credits", label: "admin.credits.nav", href: "/credits", icon: Coins, perms: PRICING, keywords: ["credits", "ledger"] },
    ],
  }),
];
