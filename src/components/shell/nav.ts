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
  Contact,
  Building2,
  Network,
} from "lucide-react";

/** Modules outside the current product scope; reachable only by URL, they render the roadmap placeholder. */
export const MODULE_PHASE = {
  studio: 6,
  deployments: 6,
  environments: 6,
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

const item = (label: string, href: string, icon: LucideIcon): NavItem => ({ label, href, icon });

export const NAV: NavSection[] = [
  { label: null, items: [item("nav.commandCenter", "", LayoutDashboard)] },
  {
    label: "nav.sections.intelligence",
    items: [
      item("modules.builder.title", "/builder", Rocket),
      item("modules.intelligence.title", "/intelligence", Sparkles),
      item("modules.analytics.title", "/analytics", BarChart3),
      item("modules.objectives.title", "/objectives", Target),
      item("modules.tasks.title", "/tasks", CheckSquare),
      item("modules.workforce.title", "/workforce", Users),
      item("modules.plans.title", "/plans", ListTree),
      item("modules.activity.title", "/activity", Activity),
      item("modules.approvals.title", "/approvals", ClipboardCheck),
    ],
  },
  {
    label: "nav.sections.company",
    items: [
      item("modules.overview.title", "/company", Building2),
      item("modules.organization.title", "/organization", Network),
      item("graph.title", "/graph", Network),
      item("modules.brain.title", "/brain", Brain),
      item("modules.documents.title", "/documents", FolderKanban),
      item("modules.products.title", "/products", Boxes),
      item("modules.customers.title", "/customers", Contact),
    ],
  },
  {
    label: "nav.sections.growth",
    items: [
      item("modules.marketing.title", "/marketing", Megaphone),
      item("modules.sales.title", "/sales", Handshake),
      item("modules.crm.title", "/crm", Layers),
      item("modules.support.title", "/support", Headphones),
    ],
  },
  {
    label: "nav.sections.build",
    items: [
      item("modules.projects.title", "/projects", FolderKanban),
      item("modules.product.title", "/product", Rocket),
      item("modules.operations.title", "/operations", Gauge),
    ],
  },
  {
    label: "nav.sections.operations",
    items: [
      item("modules.finance.title", "/finance", CircleDollarSign),
      item("modules.hr.title", "/hr", UserRound),
      item("modules.communication.title", "/communication", Megaphone),
      item("modules.workflows.title", "/workflows", Workflow),
    ],
  },
  {
    label: "nav.sections.platform",
    items: [
      item("nav.integrations", "/integrations", Blocks),
      item("nav.marketplace", "/marketplace", Store),
      item("nav.settings", "/settings", Settings),
    ],
  },
];

export const ADMIN_NAV: NavItem = { label: "nav.admin", href: "/admin", icon: ShieldCheck };
