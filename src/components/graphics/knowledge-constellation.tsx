"use client";

import { useT } from "@/i18n/client";
import { NetworkGraph, type GraphGroup, type GraphLink, type GraphNode } from "./network-graph";

/** Knowledge constellation: documents ↔ departments, linked records and shared tags (real Brain data). Click opens. */
export function KnowledgeConstellation({ nodes, links, height = 440 }: { nodes: GraphNode[]; links: GraphLink[]; height?: number }) {
  const t = useT();
  const groups: GraphGroup[] = [
    { key: "department", label: t("dna.brain.groups.department"), tone: "a", ring: 0.3, shape: "hex" },
    { key: "tag", label: t("dna.brain.groups.tag"), tone: "warning", ring: 0.5, shape: "ring" },
    { key: "document", label: t("dna.brain.groups.document"), tone: "b", ring: 0.75, shape: "square" },
    { key: "subject", label: t("dna.brain.groups.subject"), tone: "success", ring: 1, shape: "diamond" },
  ];
  return <NetworkGraph nodes={nodes} links={links} groups={groups} height={height} ariaLabel={t("dna.brain.aria")} labelThreshold={1.5} />;
}
