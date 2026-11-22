import { Building2, User } from "lucide-react";
import type { PaletteSource } from "../types";

/** Stream B — users, organizations and companies from the `people` search provider. */
export const paletteB: PaletteSource[] = [
  {
    group: "users",
    label: "admin.nav.users",
    order: 20,
    hits: ({ data, base, t }) =>
      (data?.users ?? []).map((u) => ({ id: `u:${u.id}`, label: u.name, sub: `${u.email} · ${t(`admin.users.status.${u.status}`)}`, href: `${base}/users/${u.id}`, icon: User })),
  },
  {
    group: "organizations",
    label: "admin.search.organizations",
    order: 30,
    hits: ({ data, base, t }) =>
      (data?.organizations ?? []).map((o) => ({ id: `o:${o.id}`, label: o.name, sub: `${o.slug} · ${t(`admin.organizations.status.${o.status}`)}`, href: `${base}/organizations/${o.id}`, icon: Building2 })),
  },
  {
    group: "companies",
    label: "admin.search.companies",
    order: 40,
    hits: ({ data, base }) => (data?.companies ?? []).map((c) => ({ id: `c:${c.id}`, label: c.name, sub: c.organization.name, href: `${base}/organizations/${c.organizationId}`, icon: Building2 })),
  },
];
