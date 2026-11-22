import { Bot, BrainCircuit, Sparkles, Workflow } from "lucide-react";
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
      { id: "aiRequests", href: "/ai/requests", label: "admin.aiRequests.nav", perms: AI },
      { id: "aiModels", href: "/ai/models", label: "admin.nav.aiModels", perms: AI },
      { id: "aiBudgets", href: "/ai/budgets", label: "admin.aiBudgets.nav", perms: AI },
      { id: "aiWorkforce", href: "/ai/workforce", label: "admin.nav.aiWorkforce", perms: AI },
      { id: "aiTasks", href: "/ai/tasks", label: "admin.nav.aiTasks", perms: AI },
      { id: "aiErrors", href: "/ai/errors", label: "admin.nav.aiErrors", perms: AI },
      { id: "aiUsage", href: "/ai/usage", label: "admin.nav.aiUsage", perms: AI },
    ],
  },
  { id: "workflows", group: "ai", href: "/workflows", label: "admin.workflows.nav", icon: Workflow, order: 42, perms: AI },
  { id: "knowledge", group: "ai", href: "/knowledge", label: "admin.knowledge.nav", icon: BrainCircuit, order: 44, perms: AI },
  { id: "copilot", group: "ai", href: "/copilot", label: "admin.copilot.nav", icon: Sparkles, order: 46, perms: ["platform.copilot.use"] },
];
