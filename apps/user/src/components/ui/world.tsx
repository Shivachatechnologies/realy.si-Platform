import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WORLD_NAMES } from "@realy/shared-types/ui/world";
import type { WorldName } from "@realy/shared-types/ui/world";

/**
 * Module worlds (Design DNA v2). Every department lives in its own "world": a token set with two accent hues,
 * ambient light colours and a background texture (globals.css → "Design DNA v2"). Wrapping a page in <World> makes
 * every component inside (buttons, badges, cards, focus rings, glows, charts) take on the world's identity.
 *
 * Usage (server or client component):
 *   import { World } from "@/components/ui/world";
 *   export default function FinancePage() {
 *     return <World name="finance"> …page… </World>;
 *   }
 *
 * - `ambient` (default true) paints the world's scene light + texture behind the top of the page.
 * - Inside a world, use `text-world`, `bg-world`, `border-world`, `eyebrow-rule`, `panel-float`, and the CSS variables
 *   --world-accent / --world-accent-2 / --world-ambient-1 / --world-ambient-2 / --world-soft / --world-line.
 * - Pair with <PageHeader world="finance" variant="editorial" /> and <WorldIllustration world="finance" />
 *   (src/components/graphics/illustrations.tsx) for the world's own hand-drawn illustration.
 */

export const isWorldName = (v: string): v is WorldName => (WORLD_NAMES as readonly string[]).includes(v);

/** Route prefix (after /{locale}) → world, for automatic theming of shared chrome. */
const PATH_WORLD: [string, WorldName][] = [
  ["/brain", "brain"],
  ["/documents", "brain"],
  ["/graph", "brain"],
  ["/assets", "brain"],
  ["/crm", "sales"],
  ["/sales", "sales"],
  ["/customers", "sales"],
  ["/marketing", "marketing"],
  ["/finance", "finance"],
  ["/hr", "people"],
  ["/organization", "people"],
  ["/people", "people"],
  ["/projects", "projects"],
  ["/objectives", "projects"],
  ["/product", "product"],
  ["/products", "product"],
  ["/support", "support"],
  ["/workflows", "automation"],
  ["/operations", "automation"],
  ["/workforce", "automation"],
  ["/integrations", "integrations"],
  ["/communication", "people"],
  ["/marketplace", "marketplace"],
  ["/settings", "settings"],
  ["/company", "command"],
  ["/briefing", "command"],
];

/** World for a path after the locale ("/finance/invoices" → "finance"); the Command Center world otherwise. */
export function worldOfPath(path: string): WorldName {
  for (const [prefix, w] of PATH_WORLD) if (path === prefix || path.startsWith(`${prefix}/`)) return w;
  return "command";
}

/** BI department key → world (metrics, AI employees). */
export function worldOfDepartment(department: string | null | undefined): WorldName {
  const d = (department ?? "").toLowerCase();
  if (/sales|crm|customer/.test(d)) return "sales";
  if (/market|growth|brand/.test(d)) return "marketing";
  if (/financ|account|billing/.test(d)) return "finance";
  if (/hr|people|talent|recruit/.test(d)) return "people";
  if (/project|delivery/.test(d)) return "projects";
  if (/product|engineer|develop/.test(d)) return "product";
  if (/support|success|service/.test(d)) return "support";
  if (/operat|automation|workflow/.test(d)) return "automation";
  if (/integrat/.test(d)) return "integrations";
  if (/knowledge|brain|research/.test(d)) return "brain";
  return "command";
}

export function World({
  name,
  ambient = true,
  className,
  children,
  as: Tag = "div",
}: {
  name: WorldName;
  ambient?: boolean;
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "main";
}) {
  return (
    <Tag data-world={name} className={cn("relative isolate min-w-0", className)}>
      {ambient ? <div aria-hidden className="world-ambient" /> : null}
      {children}
    </Tag>
  );
}
export { WORLD_NAMES };
export type { WorldName };
