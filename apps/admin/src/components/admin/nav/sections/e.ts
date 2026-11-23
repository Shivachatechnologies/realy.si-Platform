import { Gauge } from "lucide-react";
import type { NavSection } from "../types";

// Mirrors of the console-gate SECTIONS entries (BE/admin/console-gate.ts).
const OPS = ["platform.controls.manage", "platform.security.read", "platform.audit.read"];
const INCIDENTS = ["platform.incidents.read", "platform.incidents.manage"];
const OBSERVE = [...OPS, ...INCIDENTS];
const ALERTS = ["platform.incidents.read", "platform.alerts.manage"];
const LOGS = ["platform.logs.read", "platform.incidents.read"];
const DATA = ["platform.data.read", "platform.data.export"];

/** Stream E — system, health, incidents, alerts, errors, jobs, logs, infra, releases, data, ops. */
export const sectionsE: NavSection[] = [
  {
    id: "system",
    href: "/system",
    label: "admin.nav.system",
    icon: Gauge,
    order: 100,
    perms: [...OBSERVE, "platform.alerts.manage", "platform.logs.read", ...DATA, "platform.subscriptions.read"],
    children: [
      { id: "system", href: "/system", label: "admin.nav.system", perms: OPS },
      { id: "health", href: "/health", label: "admin.system.nav.health", perms: OBSERVE },
      { id: "incidents", href: "/incidents", label: "admin.system.nav.incidents", perms: INCIDENTS, badge: "incidents.active" },
      { id: "alerts", href: "/alerts", label: "admin.system.nav.alerts", perms: ALERTS, badge: "alerts.open" },
      { id: "errors", href: "/errors", label: "admin.system.nav.errors", perms: LOGS },
      { id: "jobs", href: "/system/jobs", label: "admin.system.nav.jobs", perms: OPS, badge: "jobs.dead" },
      { id: "logs", href: "/logs", label: "admin.system.nav.logs", perms: LOGS },
      { id: "infra", href: "/infra", label: "admin.system.nav.infra", perms: OBSERVE },
      { id: "releases", href: "/releases", label: "admin.system.nav.releases", perms: OBSERVE },
      { id: "data", href: "/data", label: "admin.system.nav.data", perms: DATA },
      { id: "ops", href: "/ops", label: "admin.nav.ops", perms: [...OPS, "platform.subscriptions.read"] },
    ],
  },
];
