import { Activity, Bell, Bug, Database, HeartPulse, Layers, ListChecks, Rocket, ScrollText, Server, Siren } from "lucide-react";
import { commandSource, type PaletteSource } from "../types";

const OBSERVE = ["platform.controls.manage", "platform.security.read", "platform.audit.read", "platform.incidents.read", "platform.incidents.manage"];

/** Stream E — ops commands and live results (incidents, alerts, error groups, job runs). */
export const paletteE: PaletteSource[] = [
  commandSource({
    group: "opsCommands",
    label: "admin.system.palette.commands",
    order: 95,
    commands: [
      { id: "health", label: "admin.system.palette.openHealth", href: "/health", icon: HeartPulse, perms: OBSERVE, keywords: ["status", "uptime"] },
      { id: "incidents", label: "admin.system.palette.openIncidents", href: "/incidents", icon: Siren, perms: ["platform.incidents.read"], keywords: ["outage", "sev"] },
      { id: "newIncident", label: "admin.system.palette.newIncident", href: "/incidents?new=1", icon: Siren, perms: ["platform.incidents.manage"], keywords: ["declare"] },
      { id: "alerts", label: "admin.system.palette.openAlerts", href: "/alerts", icon: Bell, perms: ["platform.incidents.read", "platform.alerts.manage"] },
      { id: "errors", label: "admin.system.palette.openErrors", href: "/errors", icon: Bug, perms: ["platform.logs.read"], keywords: ["exceptions"] },
      { id: "dlq", label: "admin.system.palette.openDlq", href: "/system/jobs?status=DEAD", icon: Layers, perms: OBSERVE, keywords: ["dead letter", "jobs"] },
      { id: "logs", label: "admin.system.palette.openLogs", href: "/logs", icon: ScrollText, perms: ["platform.logs.read"] },
      { id: "infra", label: "admin.system.palette.openInfra", href: "/infra", icon: Server, perms: OBSERVE, keywords: ["redis", "postgres"] },
      { id: "releases", label: "admin.system.palette.openReleases", href: "/releases", icon: Rocket, perms: OBSERVE, keywords: ["deploy", "version"] },
      { id: "data", label: "admin.system.palette.openData", href: "/data", icon: Database, perms: ["platform.data.read"], keywords: ["migrations", "export"] },
    ],
  }),
  {
    group: "incidents",
    label: "admin.system.nav.incidents",
    order: 96,
    hits: ({ data, base }) => (data?.incidents ?? []).map((i) => ({ id: `inc:${i.id}`, label: `#${i.number} ${i.title}`, sub: `${i.severity} · ${i.status}`, href: `${base}/incidents/${i.id}`, icon: Siren })),
  },
  {
    group: "alerts",
    label: "admin.system.nav.alerts",
    order: 97,
    hits: ({ data, base }) => (data?.alerts ?? []).map((a) => ({ id: `al:${a.id}`, label: a.title, sub: `${a.severity} · ${a.status} · ${a.rule}`, href: `${base}/alerts/${a.id}`, icon: Bell })),
  },
  {
    group: "errorGroups",
    label: "admin.system.nav.errors",
    order: 98,
    hits: ({ data, base }) => (data?.errorGroups ?? []).map((g) => ({ id: `err:${g.id}`, label: g.name, sub: g.message, href: `${base}/errors/${g.id}`, icon: Bug })),
  },
  {
    group: "jobRuns",
    label: "admin.system.nav.jobs",
    order: 99,
    hits: ({ data, base }) => (data?.jobRuns ?? []).map((j) => ({ id: `job:${j.id}`, label: `${j.queue}/${j.jobName}`, sub: j.status, href: `${base}/system/jobs?run=${j.id}`, icon: j.status === "DEAD" ? ListChecks : Activity })),
  },
];
