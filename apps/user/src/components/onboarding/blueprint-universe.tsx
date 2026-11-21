"use client";

import { CompanyUniverse, type UniverseGroup } from "@/components/graphics/company-universe";
import type { GraphLink, GraphNode } from "@/components/graphics/network-graph";
import { useI18n } from "@/i18n/client";

export interface UniverseSource {
  companyName: string;
  departments: { name: string; teams?: { name: string }[] }[];
  products: { name: string; pricing?: string }[];
  goals: { title: string }[];
  employees?: { id: string; name: string; department: string }[];
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The Company Universe built from the blueprint the founder is shaping (or approved) plus the AI team actually hired:
 * departments around the company, products and goals further out, AI employees linked to the department they work in.
 * Only what exists in the blueprint or the database is drawn.
 */
export function BlueprintUniverse({ source, height = 380 }: { source: UniverseSource; height?: number }) {
  const { t, locale } = useI18n();
  const nodes: (GraphNode & { group: UniverseGroup })[] = [{ id: "company", label: source.companyName, group: "company", weight: 2 }];
  const links: GraphLink[] = [];
  const deptIds = new Map<string, string>();
  source.departments.slice(0, 15).forEach((d, i) => {
    const id = `d${i}`;
    deptIds.set(norm(d.name), id);
    nodes.push({ id, label: d.name, group: "department", weight: 1.3, meta: d.teams?.length ? t("onboarding.journey.universe.teams", { count: d.teams.length }) : undefined });
    links.push({ source: "company", target: id });
  });
  source.products.slice(0, 12).forEach((p, i) => {
    const id = `p${i}`;
    nodes.push({ id, label: p.name, group: "product", meta: p.pricing });
    links.push({ source: "company", target: id });
  });
  source.goals.slice(0, 5).forEach((g, i) => {
    const id = `g${i}`;
    nodes.push({ id, label: g.title, group: "revenue", weight: 0.9 });
    links.push({ source: "company", target: id });
  });
  (source.employees ?? []).slice(0, 15).forEach((e) => {
    const id = `ai:${e.id}`;
    const dept = deptIds.get(norm(e.department)) ?? [...deptIds.entries()].find(([n]) => n.includes(norm(e.department)) || norm(e.department).includes(n))?.[1];
    nodes.push({ id, label: e.name, group: "ai", href: `/${locale}/workforce/${e.id}`, meta: t(`workforce.departments.${e.department}`) });
    links.push({ source: dept ?? "company", target: id });
  });
  if (nodes.length < 2) return null;
  return (
    <section className="grid gap-2 overflow-hidden rounded-[1.75rem] border bg-surface/50 p-3 shadow-elev-2 backdrop-blur sm:p-4" aria-label={t("onboarding.journey.universe.title")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg">{t("onboarding.journey.universe.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("onboarding.journey.universe.hint")}</p>
      </div>
      <CompanyUniverse nodes={nodes} links={links} height={height} />
    </section>
  );
}
