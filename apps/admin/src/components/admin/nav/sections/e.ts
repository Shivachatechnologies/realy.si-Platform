import { Gauge } from "lucide-react";
import type { NavSection } from "../types";

const OPS = ["platform.controls.manage", "platform.security.read", "platform.audit.read"];

/** Stream E — system, jobs, ops, health, incidents, alerts, infra, logs, errors, releases, data. */
export const sectionsE: NavSection[] = [
  {
    id: "system",
    href: "/system",
    label: "admin.nav.system",
    icon: Gauge,
    order: 100,
    perms: [...OPS, "platform.subscriptions.read"],
    children: [
      { id: "system", href: "/system", label: "admin.nav.system", perms: OPS },
      { id: "ops", href: "/ops", label: "admin.nav.ops", perms: [...OPS, "platform.subscriptions.read"] },
    ],
  },
];
