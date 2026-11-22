import { Bot } from "lucide-react";
import type { NavSection } from "../types";

const AI = ["platform.ai.read", "platform.ai.manage"];

/** Stream C — AI platform, workforce, tasks, workflows, knowledge, copilot. */
export const sectionsC: NavSection[] = [
  {
    id: "ai",
    href: "/ai",
    label: "admin.nav.ai",
    icon: Bot,
    order: 40,
    perms: AI,
    children: [
      { id: "aiOverview", href: "/ai", label: "admin.nav.aiOverview", perms: AI },
      { id: "aiModels", href: "/ai/models", label: "admin.nav.aiModels", perms: AI },
      { id: "aiWorkforce", href: "/ai/workforce", label: "admin.nav.aiWorkforce", perms: AI },
      { id: "aiTasks", href: "/ai/tasks", label: "admin.nav.aiTasks", perms: AI },
      { id: "aiErrors", href: "/ai/errors", label: "admin.nav.aiErrors", perms: AI },
      { id: "aiUsage", href: "/ai/usage", label: "admin.nav.aiUsage", perms: AI },
    ],
  },
];
