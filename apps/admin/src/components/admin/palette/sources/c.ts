import { Bot, Cpu, ListChecks, Server, Workflow } from "lucide-react";
import type { PaletteSource } from "../types";

/** Stream C — AI tasks, AI employees, workflows, models and providers from the `ai` search provider. */
export const paletteC: PaletteSource[] = [
  {
    group: "tasks",
    label: "admin.nav.aiTasks",
    order: 50,
    hits: ({ data, base, t }) =>
      (data?.tasks ?? []).map((task) => ({ id: `t:${task.id}`, label: task.title, sub: `${task.id.slice(0, 8)} · ${t(`admin.ai.status.${task.status}`)}`, href: `${base}/ai/tasks/${task.id}`, icon: ListChecks })),
  },
  {
    group: "aiEmployees",
    label: "admin.nav.aiWorkforce",
    order: 51,
    hits: ({ data, base, t }) =>
      (data?.aiEmployees ?? []).map((e) => ({ id: `e:${e.id}`, label: e.name, sub: `${e.profileKey} · ${t(`admin.aiWorkforce.status.${e.status}`)}`, href: `${base}/ai/workforce/${e.id}`, icon: Bot })),
  },
  {
    group: "workflows",
    label: "admin.workflows.nav",
    order: 52,
    hits: ({ data, base }) => (data?.workflows ?? []).map((w) => ({ id: `w:${w.id}`, label: w.name, sub: w.status, href: `${base}/workflows/${w.id}`, icon: Workflow })),
  },
  {
    group: "aiModels",
    label: "admin.nav.aiModels",
    order: 53,
    hits: ({ data, base }) => (data?.aiModels ?? []).map((m) => ({ id: `m:${m.id}`, label: m.id, sub: m.provider, href: `${base}/ai/providers/${m.provider}`, icon: Cpu })),
  },
  {
    group: "aiProviders",
    label: "admin.aiRequests.providers",
    order: 54,
    hits: ({ data, base }) => (data?.aiProviders ?? []).map((p) => ({ id: `p:${p.key}`, label: p.label, sub: p.key, href: `${base}/ai/providers/${p.key}`, icon: Server })),
  },
];
