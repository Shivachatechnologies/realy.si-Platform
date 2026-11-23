import { Building2, Users } from "lucide-react";
import type { NavSection } from "../types";

const USERS = ["platform.users.read", "platform.support.read"];
const ROLES = ["platform.security.read", "platform.security.manage", "platform.users.read", "platform.roles.manage"];
const REVIEWS = ["platform.roles.manage", "platform.security.manage", "platform.security.read"];
const IMPERSONATION = ["platform.impersonate", "platform.security.read", "platform.security.manage", "platform.audit.read"];
const HISTORY = ["platform.security.read", "platform.audit.read", "platform.roles.manage"];

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
      { id: "roleMatrix", href: "/roles/matrix", label: "admin.access.nav.matrix", perms: ROLES },
      { id: "accessReviews", href: "/roles/reviews", label: "admin.access.nav.reviews", perms: REVIEWS },
      { id: "impersonation", href: "/roles/impersonation", label: "admin.access.nav.impersonation", perms: IMPERSONATION },
      { id: "permissionHistory", href: "/roles/history", label: "admin.access.nav.history", perms: HISTORY },
      { id: "viewAs", href: "/roles/view-as", label: "admin.nav.viewAs", perms: ROLES },
    ],
  },
  { id: "companies", href: "/organizations", label: "admin.nav.companies", icon: Building2, order: 30, perms: ["platform.organizations.read", "platform.support.read"] },
];
