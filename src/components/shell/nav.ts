import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Blocks,
  Boxes,
  Brain,
  CheckSquare,
  CircleDollarSign,
  ClipboardCheck,
  Cloud,
  FileText,
  FolderKanban,
  Gauge,
  Handshake,
  Headphones,
  LayoutDashboard,
  Layers,
  ListTree,
  Megaphone,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  UserRound,
  Users,
  Workflow,
  Wrench,
  Contact,
  Building2,
  Network,
} from "lucide-react";

/** Roadmap phase in which each not-yet-built module ships (docs/roadmap.md). */
export const MODULE_PHASE = {
  intelligence: 3,
  objectives: 3,
  plans: 3,
  tasks: 3,
  activity: 3,
  approvals: 3,
  workforce: 4,
  brain: 2,
  products: 2,
  customers: 2,
  people: 2,
  documents: 2,
  projects: 2,
  studio: 6,
  deployments: 6,
  environments: 6,
  marketing: 6,
  sales: 6,
  crm: 6,
  analytics: 6,
  finance: 6,
  operations: 6,
  support: 6,
  workflows: 4,
  integrations: 5,
  marketplace: 7,
} as const;

export type ModuleKey = keyof typeof MODULE_PHASE;
export const isModuleKey = (v: string): v is ModuleKey => v in MODULE_PHASE;

export interface NavItem {
  /** i18n key */
  label: string;
  /** path after /{locale} */
  href: string;
  icon: LucideIcon;
  phase?: number;
}

export interface NavSection {
  label: string | null;
  items: NavItem[];
}

const mod = (key: ModuleKey, icon: LucideIcon): NavItem => ({
  label: `modules.${key}.title`,
  href: `/${key}`,
  icon,
  phase: MODULE_PHASE[key],
});

export const NAV: NavSection[] = [
  { label: null, items: [{ label: "nav.commandCenter", href: "", icon: LayoutDashboard }] },
  {
    label: "nav.sections.intelligence",
    items: [
      mod("intelligence", Sparkles),
      mod("objectives", Target),
      mod("plans", ListTree),
      mod("tasks", CheckSquare),
      mod("workforce", Users),
      mod("activity", Activity),
      mod("approvals", ClipboardCheck),
    ],
  },
  {
    label: "nav.sections.company",
    items: [
      { label: "modules.overview.title", href: "/company", icon: Building2 },
      { label: "graph.title", href: "/graph", icon: Network },
      mod("brain", Brain),
      mod("products", Boxes),
      mod("customers", Contact),
      mod("people", UserRound),
      mod("documents", FileText),
    ],
  },
  {
    label: "nav.sections.build",
    items: [mod("projects", FolderKanban), mod("studio", Wrench), mod("deployments", Rocket), mod("environments", Cloud)],
  },
  {
    label: "nav.sections.growth",
    items: [mod("marketing", Megaphone), mod("sales", Handshake), mod("crm", Layers), mod("analytics", BarChart3)],
  },
  {
    label: "nav.sections.operations",
    items: [mod("finance", CircleDollarSign), mod("operations", Gauge), mod("support", Headphones), mod("workflows", Workflow)],
  },
  {
    label: "nav.sections.platform",
    items: [
      { label: "nav.integrations", href: "/integrations", icon: Blocks, phase: MODULE_PHASE.integrations },
      { label: "nav.marketplace", href: "/marketplace", icon: Store, phase: MODULE_PHASE.marketplace },
      { label: "nav.settings", href: "/settings", icon: Settings },
    ],
  },
];

export const ADMIN_NAV: NavItem = { label: "nav.admin", href: "/admin", icon: ShieldCheck };
