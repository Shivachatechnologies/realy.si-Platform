"use client";

import { useT } from "@/i18n/client";
import { NetworkGraph, type GraphGroup, type GraphLink, type GraphNode } from "./network-graph";

export interface ConstellationProvider {
  key: string;
  name: string;
  category: string;
  categoryLabel: string;
  status: "CONNECTED" | "ERROR" | null;
  href: string;
}

/**
 * Integrations as a constellation: the company at the centre, provider categories on the inner ring, every provider
 * orbiting its category — connected ones lit (success), failing ones red, available ones quiet. Real catalog +
 * connection state.
 */
export function ProviderConstellation({ providers, companyName, height = 460 }: { providers: ConstellationProvider[]; companyName: string; height?: number }) {
  const t = useT();
  const groups: GraphGroup[] = [
    { key: "hub", label: companyName, tone: "fg", ring: 0 },
    { key: "category", label: t("dna.integrations.groups.category"), tone: "a", ring: 0.38, shape: "hex" },
    { key: "connected", label: t("dna.integrations.groups.connected"), tone: "success", ring: 0.82, shape: "circle" },
    { key: "error", label: t("dna.integrations.groups.error"), tone: "danger", ring: 0.82, shape: "circle" },
    { key: "available", label: t("dna.integrations.groups.available"), tone: "b", ring: 1, shape: "ring" },
  ];
  const cats = [...new Map(providers.map((p) => [p.category, p.categoryLabel])).entries()];
  const nodes: GraphNode[] = [
    { id: "hub", label: companyName, group: "hub", center: true },
    ...cats.map(([k, label]) => {
      const n = providers.filter((p) => p.category === k && p.status).length;
      return { id: `cat:${k}`, label, group: "category", weight: 1.5 + n * 0.4, meta: t("dna.integrations.connectedCount", { count: n }) };
    }),
    ...providers.map((p) => ({
      id: p.key,
      label: p.name,
      group: p.status === "CONNECTED" ? "connected" : p.status === "ERROR" ? "error" : "available",
      weight: p.status ? 1.6 : 0.6,
      href: p.href,
      meta: p.categoryLabel,
    })),
  ];
  const links: GraphLink[] = [...cats.map(([k]) => ({ source: "hub", target: `cat:${k}` })), ...providers.map((p) => ({ source: `cat:${p.category}`, target: p.key }))];
  return <NetworkGraph nodes={nodes} links={links} groups={groups} height={height} ariaLabel={t("dna.integrations.aria")} labelThreshold={1.5} />;
}
