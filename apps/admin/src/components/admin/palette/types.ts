import type { LucideIcon } from "lucide-react";
import type { Translate } from "@/i18n/translate-core";
import type { AdminSearchResult } from "@/server/modules/admin/search";

/**
 * ⌘K command palette model (stream A renders it; each stream owns `./sources/<stream>.ts`).
 * A source turns the live `/api/v1/admin/search` result (its provider's groups) and/or static commands into hits.
 * Sources are sorted by `order`; hits keep that order, and groups appear in the order of their first hit.
 */
export interface PaletteContext {
  t: Translate;
  /** "/<locale>" */
  base: string;
  /** The trimmed query as typed. */
  needle: string;
  /** Lower-cased query ("" when empty). */
  low: string;
  /** Live search result for `needle` (null while loading, on error, or below 2 characters). */
  data: AdminSearchResult | null;
  /** Switches the admin may see (from the console layout). */
  controls: { key: string; group: string }[];
}

export interface PaletteHit {
  id: string;
  label: string;
  sub?: string;
  href: string;
  icon: LucideIcon;
}

export interface PaletteSource {
  /** Group id (unique across sources). */
  group: string;
  /** Message key of the group heading. Keep it a string literal (client-message manifest). */
  label: string;
  order: number;
  hits(ctx: PaletteContext): PaletteHit[];
}

/** A static palette action ("Suspend user…", "Open DLQ"), usually a deep link such as `?action=`. */
export interface PaletteCommand {
  id: string;
  /** Message key. */
  label: string;
  /** Locale-relative href. */
  href: string;
  icon: LucideIcon;
  /** Platform permissions of which ANY shows the command (stream A filters once capabilities reach the client). */
  perms: readonly string[];
  /** Extra lower-case match words. */
  keywords?: readonly string[];
}

/** A source made of static commands, matched on their translated label and keywords. */
export function commandSource(def: { group: string; label: string; order: number; commands: readonly PaletteCommand[] }): PaletteSource {
  return {
    group: def.group,
    label: def.label,
    order: def.order,
    hits: ({ t, base, low }) =>
      def.commands
        .filter((c) => !low || t(c.label).toLowerCase().includes(low) || c.keywords?.some((k) => k.includes(low)))
        .map((c) => ({ id: `cmd:${c.id}`, label: t(c.label), href: `${base}${c.href}`, icon: c.icon })),
  };
}
