import { CreditCard } from "lucide-react";
import type { NavSection } from "../types";

const PRICING = ["pricing.read", "platform.subscriptions.read", "globalization.read"];

/** Stream D — pricing, plans, subscriptions, revenue, countries, invoices, payments, credits, growth. */
export const sectionsD: NavSection[] = [
  {
    id: "billing",
    href: "/pricing",
    label: "admin.nav.billing",
    icon: CreditCard,
    order: 50,
    perms: PRICING,
    children: [
      { id: "pricing", href: "/pricing", label: "admin.nav.pricing", perms: PRICING },
      { id: "plans", href: "/plans", label: "admin.nav.plans", perms: PRICING },
      { id: "subscriptions", href: "/subscriptions", label: "admin.nav.subscriptions", perms: PRICING },
      { id: "revenue", href: "/revenue", label: "admin.nav.revenue", perms: PRICING },
      { id: "countries", href: "/countries", label: "admin.nav.countries", perms: ["globalization.read", "pricing.read"] },
    ],
  },
];
