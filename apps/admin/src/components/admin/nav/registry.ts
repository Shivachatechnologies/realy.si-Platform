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
