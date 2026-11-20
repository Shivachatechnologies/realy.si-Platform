"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { NetworkGraph, type GraphGroup, type GraphLink, type GraphNode } from "./network-graph";

export type UniverseGroup = "company" | "department" | "ai" | "product" | "customer" | "revenue";

const GROUPS: Omit<GraphGroup, "label">[] = [
  { key: "company", tone: "fg", ring: 0, shape: "circle" },
  { key: "department", tone: "a", ring: 0.34, shape: "hex" },
  { key: "revenue", tone: "warning", ring: 0.55, shape: "ring" },
  { key: "ai", tone: "b", ring: 0.7, shape: "circle" },
  { key: "product", tone: "info", ring: 0.86, shape: "diamond" },
  { key: "customer", tone: "success", ring: 1, shape: "circle" },
];

/**
 * The Company Universe: the whole company as one living network — departments, AI employees, products, customers and
 * revenue streams — built from real records passed in by the server (nothing is invented; missing areas simply have
 * no nodes). Click a node for its detail panel; the panel links to the record.
 */
export function CompanyUniverse({ nodes, links, height = 520, className }: { nodes: (GraphNode & { group: UniverseGroup })[]; links: GraphLink[]; height?: number; className?: string }) {
  const t = useT();
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const groups: GraphGroup[] = GROUPS.map((g) => ({ ...g, label: t(`dna.universe.groups.${g.key}`) }));
  const degree = selected ? links.filter((l) => l.source === selected.id || l.target === selected.id).length : 0;
  return (
    <div className={cn("relative", className)}>
      <NetworkGraph nodes={nodes} links={links} groups={groups} height={height} ariaLabel={t("dna.universe.aria")} selectedId={selected?.id ?? null} onSelect={(n) => setSelected(n && n.id === selected?.id ? null : n)} />
      {selected ? (
        <aside className="panel-float absolute end-3 top-3 w-64 max-w-[calc(100%-1.5rem)] p-4 animate-scale-in" aria-live="polite">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-micro text-muted-foreground uppercase">{groups.find((g) => g.key === selected.group)?.label}</div>
              <div className="mt-1 truncate font-display text-xl">{selected.label}</div>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label={t("common.close")}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {selected.meta ? <p className="mt-2 text-sm text-muted-foreground">{selected.meta}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">{t("dna.universe.connections", { count: degree })}</p>
          {selected.href ? (
            <Link href={selected.href} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {t("dna.universe.open")}
              <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
