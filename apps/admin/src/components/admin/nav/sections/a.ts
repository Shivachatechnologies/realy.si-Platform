import { LayoutDashboard } from "lucide-react";
import type { NavSection } from "../types";

/**
 * Stream A — command center, action center, notifications, personal settings. Badge ids are resolved by the shell
 * (BE/admin/action-center.ts#actionBadges: "actions.open" and every action item id; "notifications.unread").
 */
export const sectionsA: NavSection[] = [
  {
    id: "overview",
    href: "",
    label: "admin.nav.overview",
    icon: LayoutDashboard,
    order: 10,
    perms: [],
    group: "monitor",
    children: [
      { id: "commandCenter", href: "", label: "admin.nav.commandCenter", perms: [] },
      { id: "actionCenter", href: "/actions", label: "admin.nav.actionCenter", perms: [], badge: "actions.open" },
      { id: "notifications", href: "/notifications", label: "admin.nav.notifications", perms: [], badge: "notifications.unread" },
      { id: "me", href: "/me", label: "admin.nav.me", perms: [] },
    ],
  },
];
