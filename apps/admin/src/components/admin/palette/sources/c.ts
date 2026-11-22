import { Bot } from "lucide-react";
import type { PaletteSource } from "../types";

/** Stream C — AI tasks from the `ai` search provider. */
export const paletteC: PaletteSource[] = [
  {
    group: "tasks",
    label: "admin.nav.aiTasks",
    order: 50,
    hits: ({ data, base, t }) =>
      (data?.tasks ?? []).map((task) => ({ id: `t:${task.id}`, label: task.title, sub: `${task.id.slice(0, 8)} · ${t(`admin.ai.status.${task.status}`)}`, href: `${base}/ai/tasks?q=${task.id}`, icon: Bot })),
  },
];
