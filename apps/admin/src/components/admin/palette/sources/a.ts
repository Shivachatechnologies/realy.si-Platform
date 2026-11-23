import { Bell, Bot, CircleAlert, CreditCard, Inbox, LayoutDashboard, Skull, Store, UserCog } from "lucide-react";
import { commandSource, type PaletteSource } from "../types";

const OPS = ["platform.controls.manage", "platform.security.read", "platform.audit.read"];
const BILLING = ["pricing.read", "platform.subscriptions.read", "globalization.read"];

/**
 * Stream A — quick commands (real deep links only). The "Go to" (nav registry), "Recent searches", "Context" and
 * "See all results" groups are rendered by the palette itself (palette/command-palette.tsx).
 */
export const paletteA: PaletteSource[] = [
  commandSource({
    group: "quick",
    label: "admin.palette.groups.quick",
    order: 5,
    commands: [
      { id: "actions", label: "admin.palette.cmd.actions", href: "/actions", icon: Inbox, perms: [], keywords: ["attention", "todo", "queue"] },
      { id: "notifications", label: "admin.palette.cmd.notifications", href: "/notifications", icon: Bell, perms: [], keywords: ["inbox", "bell"] },
      { id: "me", label: "admin.palette.cmd.me", href: "/me", icon: UserCog, perms: [], keywords: ["preferences", "settings", "profile", "favorites"] },
      { id: "cc24h", label: "admin.palette.cmd.last24h", href: "?range=24h", icon: LayoutDashboard, perms: [], keywords: ["overview", "today", "24h"] },
      { id: "cc7d", label: "admin.palette.cmd.last7d", href: "?range=7d", icon: LayoutDashboard, perms: [], keywords: ["overview", "week", "7d"] },
      { id: "dlq", label: "admin.palette.cmd.deadLetters", href: "/system/jobs?status=DEAD", icon: Skull, perms: OPS, keywords: ["dlq", "dead", "jobs", "queue"] },
      { id: "failedTasks", label: "admin.palette.cmd.failedTasks", href: "/ai/tasks?status=FAILED", icon: Bot, perms: ["platform.ai.read", "platform.ai.manage"], keywords: ["errors", "ai"] },
      { id: "pastDue", label: "admin.palette.cmd.pastDue", href: "/subscriptions?status=PAST_DUE", icon: CreditCard, perms: BILLING, keywords: ["billing", "dunning", "payments"] },
      { id: "review", label: "admin.palette.cmd.marketplaceReview", href: "/marketplace?status=IN_REVIEW", icon: Store, perms: ["platform.content.manage"], keywords: ["moderation", "listings"] },
      { id: "emergency", label: "admin.palette.cmd.controls", href: "/controls", icon: CircleAlert, perms: ["platform.controls.manage", "platform.audit.read", "platform.ai.read"], keywords: ["kill", "switch", "maintenance", "lockdown"] },
    ],
  }),
];
