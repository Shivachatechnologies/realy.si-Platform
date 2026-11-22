import type { LucideIcon } from "lucide-react";

/**
 * Control Center navigation model (stream A renders it; each stream owns `./sections/<stream>.ts`).
 *
 * - `href` is relative to `/<locale>` ("" is the overview).
 * - `label` is a FULL message key (e.g. "admin.nav.users", or "admin.incidents.nav" for a new stream group), so a
 *   stream never has to edit another stream's i18n object. Keep it a plain string literal: the client-message
 *   manifest (`pnpm i18n:sync`) finds keys by scanning literals.
 * - `perms`: platform permissions of which ANY shows the entry (mirror of the console-gate SECTIONS entry). The
 *   sidebar does not filter yet (Step 0 keeps behaviour); stream A filters with `capabilitiesFor`.
 * - `badge`: id of a server-side badge counter (stream A resolves ids to counts; e.g. "jobs.dead").
 * - `order`: position in the sidebar; sections from all streams are sorted by it (ties keep stream order).
 */
export interface NavItem {
  /** Stable id (React key, palette id). */
  id: string;
  href: string;
  label: string;
  perms: readonly string[];
  badge?: string;
}

export interface NavSection extends NavItem {
  icon: LucideIcon;
  order: number;
  /** Optional grouping for the A sidebar v2 (e.g. "operate", "configure"). */
  group?: string;
  children?: readonly NavItem[];
}
