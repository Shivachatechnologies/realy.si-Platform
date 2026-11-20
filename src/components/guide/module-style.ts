import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  Brain,
  Building2,
  CircleDollarSign,
  FolderKanban,
  Gauge,
  Handshake,
  Headphones,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Rocket,
  Settings,
  UserRound,
  Workflow,
} from "lucide-react";

/** Department identity for guide surfaces: icon + accent (design-system tokens only). */
export const MODULE_STYLE: Record<string, { icon: LucideIcon; tone: string; ring: string }> = {
  core: { icon: LayoutDashboard, tone: "text-primary", ring: "from-primary/40 to-primary-2/30" },
  ai: { icon: Bot, tone: "text-primary", ring: "from-primary/50 to-primary-2/40" },
  analytics: { icon: BarChart3, tone: "text-info", ring: "from-info/40 to-primary/25" },
  knowledge: { icon: Brain, tone: "text-primary-2", ring: "from-primary-2/40 to-info/25" },
  company: { icon: Building2, tone: "text-primary", ring: "from-primary/35 to-info/25" },
  sales: { icon: Handshake, tone: "text-success", ring: "from-success/40 to-info/25" },
  marketing: { icon: Megaphone, tone: "text-warning", ring: "from-warning/40 to-danger/25" },
  support: { icon: Headphones, tone: "text-info", ring: "from-info/40 to-success/25" },
  projects: { icon: FolderKanban, tone: "text-primary", ring: "from-primary/40 to-success/25" },
  product: { icon: Rocket, tone: "text-primary-2", ring: "from-primary-2/40 to-warning/25" },
  operations: { icon: Gauge, tone: "text-muted-foreground", ring: "from-muted-foreground/40 to-primary/25" },
  finance: { icon: CircleDollarSign, tone: "text-success", ring: "from-success/40 to-primary/25" },
  hr: { icon: UserRound, tone: "text-danger", ring: "from-danger/35 to-warning/25" },
  communication: { icon: MessagesSquare, tone: "text-info", ring: "from-info/40 to-primary-2/25" },
  automation: { icon: Workflow, tone: "text-warning", ring: "from-warning/40 to-primary/25" },
  platform: { icon: Settings, tone: "text-muted-foreground", ring: "from-muted-foreground/35 to-primary/25" },
};

export const moduleStyle = (module: string | undefined) => MODULE_STYLE[module ?? "core"] ?? MODULE_STYLE.core!;
