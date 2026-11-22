import { Building2, Users } from "lucide-react";
import type { NavSection } from "../types";

const USERS = ["platform.users.read", "platform.support.read"];
const ROLES = ["platform.security.read", "platform.security.manage", "platform.users.read", "platform.roles.manage"];

/** Stream B — users, organizations, platform roles and access. */
export const sectionsB: NavSection[] = [
  {
    id: "users",
    href: "/users",
    label: "admin.nav.users",
    icon: Users,
    order: 20,
    perms: [...USERS, ...ROLES],
    children: [
      { id: "users", href: "/users", label: "admin.nav.users", perms: USERS },
      { id: "roles", href: "/roles", label: "admin.nav.roles", perms: ROLES },
      { id: "viewAs", href: "/roles/view-as", label: "admin.nav.viewAs", perms: ROLES },
    ],
  },
  { id: "companies", href: "/organizations", label: "admin.nav.companies", icon: Building2, order: 30, perms: ["platform.organizations.read", "platform.support.read"] },
];
