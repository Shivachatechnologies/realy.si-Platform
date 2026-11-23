import { CreditCard, Rocket } from "lucide-react";
import type { NavSection } from "../types";

const PRICING = ["pricing.read", "platform.subscriptions.read", "globalization.read"];
const GROWTH = [...PRICING, "platform.users.read"];

/** Stream D — billing (revenue, plans, subscriptions, invoices, payments, credits, usage) and growth analytics. */
export const sectionsD: NavSection[] = [
  {
    id: "billing",
    href: "/revenue",
    label: "admin.nav.billing",
    icon: CreditCard,
    order: 50,
    perms: PRICING,
    children: [
      { id: "revenue", href: "/revenue", label: "admin.revenue.overview.nav", perms: PRICING },
      { id: "revenue-analytics", href: "/revenue/analytics", label: "admin.revenue.analytics.nav", perms: PRICING },
      { id: "subscriptions", href: "/subscriptions", label: "admin.nav.subscriptions", perms: PRICING },
      { id: "invoices", href: "/invoices", label: "admin.invoices.nav", perms: PRICING },
      { id: "payments", href: "/payments", label: "admin.payments.nav", perms: PRICING },
      { id: "credits", href: "/credits", label: "admin.credits.nav", perms: PRICING },
      { id: "usage", href: "/usage", label: "admin.usage.nav", perms: PRICING },
      { id: "plans", href: "/plans", label: "admin.nav.plans", perms: PRICING },
      { id: "pricing", href: "/pricing", label: "admin.nav.pricing", perms: PRICING },
      { id: "countries", href: "/countries", label: "admin.nav.countries", perms: ["globalization.read", "pricing.read"] },
    ],
  },
  {
    id: "growth",
    group: "revenue",
    href: "/growth",
    label: "admin.growth.nav",
    icon: Rocket,
    order: 55,
    perms: GROWTH,
    children: [
      { id: "growth-overview", href: "/growth", label: "admin.growth.nav", perms: GROWTH },
      { id: "analytics", href: "/analytics", label: "admin.analytics.nav", perms: GROWTH },
    ],
  },
];
