import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Brain, Briefcase, ExternalLink, Network, Pin, Search } from "lucide-react";
import { AskBrain } from "@/components/brain/ask-brain";
import { BrainTabs } from "@/components/brain/brain-tabs";
import { EntityOrbit } from "@/components/brain/entity-orbit";
import { Snippet } from "@/components/brain/snippet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/scene";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { knowledgeContext, searchKnowledge } from "@/server/modules/brain/knowledge";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("brain.knowledge.title") };
}

/**
 * Knowledge search: one query across documents, company memory, the company graph (with a relationship view) and
 * core records; then "Ask the Brain" answers from the same sources with citations.
 */
export default async function KnowledgePage({ searchParams }: PageProps<"/[locale]/brain/knowledge">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  const header = (
    <>
      <PageHeader variant="editorial" world="brain" eyebrow={t("dna.brain.eyebrow")} title={t("brain.knowledge.title")} description={t("brain.knowledge.subtitle")} />
      <BrainTabs locale={locale} active="knowledge" />
    </>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-6">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "brain.read", chain))) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-6">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const canRun = await can(viewer.ctx, "agents.run", chain);
  const results = q ? await searchKnowledge(viewer.ctx, org.id, company.id, q, 10) : null;
  const total = results ? (results.passages?.length ?? 0) + (results.memories?.length ?? 0) + (results.entities?.length ?? 0) + results.records.length : 0;
  const context = results ? knowledgeContext(results, 8).text.slice(0, 1900) : "";

  return (
    <div className="mx-auto grid max-w-[1400px] gap-8">
      {header}

      <form method="get" role="search" className="flex flex-col gap-2 rounded-2xl border bg-surface/80 p-3 shadow-elev-1 backdrop-blur sm:flex-row sm:items-center">
        <label htmlFor="knowledge-q" className="sr-only">
          {t("brain.knowledge.searchLabel")}
        </label>
        <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-world/10 text-world sm:grid" aria-hidden>
          <Search className="size-4" />
        </span>
        <input id="knowledge-q" name="q" defaultValue={q} maxLength={200} placeholder={t("brain.knowledge.placeholder")} className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground" />
        <Button type="submit">{t("brain.search")}</Button>
      </form>

      {!results ? (
        <div className="grid gap-4 rounded-3xl border border-dashed p-6 sm:grid-cols-3">
          {(["what", "why", "ai"] as const).map((k) => (
            <div key={k} className="grid gap-1">
              <p className="text-sm font-semibold">{t(`brain.knowledge.intro.${k}Title`)}</p>
              <p className="text-sm text-muted-foreground">{t(`brain.knowledge.intro.${k}`)}</p>
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-2xl border border-dashed p-6">
          <p className="text-sm text-muted-foreground">{t("brain.knowledge.none", { q })}</p>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}/documents`}>{t("brain.knowledge.addDocs")}</Link>
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("brain.knowledge.found", { count: total, q })}</p>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-8">
              {results.passages?.length ? (
                <Section eyebrow={<BookOpen className="size-3.5" aria-hidden />} title={t("brain.knowledge.passages")}>
                  <ol className="grid gap-3">
                    {results.passages.map((p, i) => (
                      <li key={`${p.documentId}-${p.passage}`} className="grid gap-1.5 rounded-xl border bg-surface/80 p-3">
                        <span className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono text-muted-foreground">[S{i + 1}]</span>
                          <Link href={`/${locale}${p.href}`} className="font-medium hover:underline">
                            {p.title}
                          </Link>
                          <span className="text-muted-foreground">{t("brain.passage", { n: p.passage })}</span>
                          {p.sourceHref ? (
                            <Link href={`/${locale}${p.sourceHref}`} className="ms-auto inline-flex items-center gap-1 text-primary hover:underline">
                              {t("brain.openSource")} <ExternalLink className="size-3" aria-hidden />
                            </Link>
                          ) : null}
                        </span>
                        <Snippet segments={p.snippet} />
                      </li>
                    ))}
                  </ol>
                </Section>
              ) : null}
              {results.memories?.length ? (
                <Section eyebrow={<Brain className="size-3.5" aria-hidden />} title={t("brain.knowledge.memories")}>
                  <ul className="grid gap-2">
                    {results.memories.map((m) => (
                      <li key={m.id} className="rounded-xl border bg-surface/80 p-3 text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          {m.pinned ? <Pin className="size-3.5 text-world" aria-label={t("brain.knowledge.pinned")} /> : null}
                          {m.title}
                        </span>
                        <p className="mt-1 text-muted-foreground">{m.fact}</p>
                        {m.source ? <p className="mt-1 text-xs text-muted-foreground">{t("brain.knowledge.source", { source: m.source })}</p> : null}
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              {results.records.length ? (
                <Section eyebrow={<Briefcase className="size-3.5" aria-hidden />} title={t("brain.knowledge.records")}>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {results.records.map((r) => (
                      <li key={`${r.type}-${r.id}`}>
                        <Link href={`/${locale}${r.href}`} className="flex min-h-11 items-center gap-2 rounded-xl border bg-surface/80 px-3 py-2 text-sm hover:border-primary/40">
                          <Badge tone="neutral">{t(`brain.knowledge.recordType.${r.type}`)}</Badge>
                          <span className="min-w-0 flex-1 truncate">{r.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </div>

            <div className="grid content-start gap-8">
              {results.entities?.length ? (
                <Section eyebrow={<Network className="size-3.5" aria-hidden />} title={t("brain.knowledge.relationships")} description={t("brain.knowledge.relationshipsHint")}>
                  <ul className="grid gap-4">
                    {results.entities.map((e) => (
                      <li key={e.id} className="grid gap-2 rounded-2xl border bg-surface/80 p-3">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone="accent">{t(`graph.kinds.${e.kind}`)}</Badge>
                          <Link href={`/${locale}${e.href}`} className="font-medium hover:underline">
                            {e.name}
                          </Link>
                        </span>
                        {e.description ? <p className="text-xs text-muted-foreground">{e.description}</p> : null}
                        {e.relations.length ? (
                          <EntityOrbit
                            entity={e}
                            locale={locale}
                            relationLabel={(r) => t(`graph.relationLabels.${r}`)}
                            kindLabel={(k) => t(`graph.kinds.${k}`)}
                            ariaLabel={t("brain.knowledge.orbitAria", { name: e.name, count: e.relations.length })}
                          />
                        ) : (
                          <p className="text-xs text-muted-foreground">{t("graph.noRelations")}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              <Section title={t("brain.knowledge.askTitle")} description={t("brain.knowledge.askHint")}>
                {aiConfigured() && canRun ? (
                  <AskBrain organizationId={org.id} companyId={company.id} context={context ? `${t("brain.knowledge.contextLead", { q })}\n${context}` : undefined} placeholder={q} />
                ) : (
                  <Notice tone="warning">{t(aiConfigured() ? "guide.ai.forbidden" : "guide.ai.notConfigured")}</Notice>
                )}
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
