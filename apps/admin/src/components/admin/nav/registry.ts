import { sectionsA } from "./sections/a";
import { sectionsB } from "./sections/b";
import { sectionsC } from "./sections/c";
import { sectionsD } from "./sections/d";
import { sectionsE } from "./sections/e";
import { sectionsF } from "./sections/f";
import type { NavItem, NavSection } from "./types";

export type { NavItem, NavSection } from "./types";

/**
 * Control Center navigation registry (stream A): every stream's sections, sorted by `order`. Streams edit ONLY
 * `./sections/<stream>.ts`; this file and the sidebar rendering stay A's.
 */
export const ADMIN_NAV: readonly NavSection[] = [...sectionsA, ...sectionsB, ...sectionsC, ...sectionsD, ...sectionsE, ...sectionsF].sort((a, b) => a.order - b.order);

export interface Crumb {
  label: string;
  href: string;
}

/**
 * Breadcrumb trail for a locale-relative path ("/ai/models" → AI › Models), from the longest matching nav entries.
 * Returns [] for the overview and for paths outside the registry. Labels are message keys.
 */
export function navTrail(path: string): Crumb[] {
  const clean = path.replace(/\/+$/, "") || "";
  if (clean === "") return [];
  const matches = (href: string) => href !== "" && (clean === href || clean.startsWith(`${href}/`));
  let best: { section: NavSection; child?: NavItem; len: number } | null = null;
  for (const section of ADMIN_NAV) {
    for (const item of [section, ...(section.children ?? [])]) {
      if (!matches(item.href)) continue;
      if (!best || item.href.length > best.len) best = { section, child: item === section ? undefined : item, len: item.href.length };
    }
  }
  if (!best) return [];
  const trail: Crumb[] = [{ label: best.section.label, href: best.section.href }];
  if (best.child && best.child.label !== best.section.label) trail.push({ label: best.child.label, href: best.child.href });
  return trail;
}

/** Sidebar groups, in display order (message keys under admin.shell.groups). */
export const NAV_GROUPS = ["monitor", "customers", "ai", "revenue", "platform", "govern", "other"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

const DEFAULT_GROUP: Record<string, NavGroup> = {
  overview: "monitor",
  system: "monitor",
  users: "customers",
  companies: "customers",
  ai: "ai",
  billing: "revenue",
  content: "platform",
  marketplace: "platform",
  features: "platform",
  integrations: "platform",
  securityAudit: "govern",
  settings: "govern",
};

export function navGroup(section: NavSection): NavGroup {
  const g = (section.group ?? DEFAULT_GROUP[section.id]) as NavGroup | undefined;
  return g && (NAV_GROUPS as readonly string[]).includes(g) ? g : "other";
}

/** Does an admin holding `allowed` see this entry? Empty `perms` = every platform admin. */
export const navAllowed = (item: { perms: readonly string[] }, allowed: ReadonlySet<string>) => item.perms.length === 0 || item.perms.some((p) => allowed.has(p));

/** The registry filtered to what the admin may open (sections with no visible child keep only their own link). */
export function visibleNav(allowed: ReadonlySet<string>): NavSection[] {
  return ADMIN_NAV.filter((s) => navAllowed(s, allowed)).map((s) => (s.children ? { ...s, children: s.children.filter((c) => navAllowed(c, allowed)) } : s));
}

/** Every nav entry (sections and children) with its section, for lookups by href. */
export function navEntries(): { item: NavItem; section: NavSection }[] {
  return ADMIN_NAV.flatMap((section) => [{ item: section as NavItem, section }, ...(section.children ?? []).filter((c) => c.href !== section.href || c.label !== section.label).map((item) => ({ item, section }))]);
}

/** The nav entry whose href is exactly `href` (child entries win over their section). */
export function navEntryFor(href: string) {
  const all = navEntries();
  return all.filter((e) => e.item.href === href).pop() ?? null;
}
