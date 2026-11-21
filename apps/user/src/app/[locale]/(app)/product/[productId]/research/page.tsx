import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { CompetitorForm, InlineEdit, PersonaForm, ValidationForm } from "@/components/work/product-client";
import { productWorkspace, VALIDATION_TONE } from "@/components/work/product-ui";
import { DeleteIconButton } from "@/components/work/task-forms";
import { Empty } from "@/components/work/ui";
import { formatDate } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { getResearch } from "@/server/modules/work/product-research";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("product.workspace.tabs.research") };
}

const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

export default async function ResearchPage({ params }: PageProps<"/[locale]/product/[productId]/research">) {
  const { productId } = await params;
  const w = await productWorkspace(productId, "research");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company, base, tz, canEdit } = w;
  const r = await getResearch(viewer.ctx, org.id, company.id, productId);
  const tally = (k: keyof typeof VALIDATION_TONE) => r.validations.filter((v) => v.result === k).length;
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <Card>
        <CardHeader title={t("product.research.competitors")} description={t("product.research.competitorsHint")} />
        {canEdit ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("product.research.addCompetitor")}</summary>
            <CompetitorForm base={base} productId={productId} />
          </details>
        ) : null}
        {r.competitors.length ? (
          <ul className="grid divide-y">
            {r.competitors.map((c) => (
              <li key={c.id} className="grid gap-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.website ? (
                    <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      {host(c.website)}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : null}
                  {canEdit ? (
                    <span className="ms-auto flex items-center gap-1">
                      <InlineEdit kind="competitor" base={base} productId={productId} id={c.id} initial={{ name: c.name, website: c.website ?? "", strengths: c.strengths ?? "", weaknesses: c.weaknesses ?? "", notes: c.notes ?? "", links: c.links.join("\n") }} />
                      <DeleteIconButton url={`${base}/product/competitors/${c.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} />
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {c.strengths ? (
                    <p className="whitespace-pre-wrap">
                      <span className="block text-xs text-muted-foreground">{t("product.research.strengths")}</span>
                      {c.strengths}
                    </p>
                  ) : null}
                  {c.weaknesses ? (
                    <p className="whitespace-pre-wrap">
                      <span className="block text-xs text-muted-foreground">{t("product.research.weaknesses")}</span>
                      {c.weaknesses}
                    </p>
                  ) : null}
                  {c.notes ? (
                    <p className="whitespace-pre-wrap">
                      <span className="block text-xs text-muted-foreground">{t("product.research.notes")}</span>
                      {c.notes}
                    </p>
                  ) : null}
                </div>
                {c.links.length ? (
                  <ul className="flex flex-wrap gap-2 text-xs">
                    {c.links.map((l) => (
                      <li key={l}>
                        <a href={l} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">
                          {host(l)}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("product.research.noCompetitors")}</Empty>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t("product.research.validations")}
          description={t("product.research.validationSummary", { validated: tally("VALIDATED"), invalidated: tally("INVALIDATED"), pending: tally("PENDING") + tally("INCONCLUSIVE") })}
        />
        {canEdit ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("product.research.addValidation")}</summary>
            <ValidationForm base={base} productId={productId} />
          </details>
        ) : null}
        {r.validations.length ? (
          <ul className="grid divide-y">
            {r.validations.map((v) => (
              <li key={v.id} className="grid gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={VALIDATION_TONE[v.result]}>{t(`product.validationResult.${v.result}`)}</Badge>
                  <Badge>{t(`product.validationKind.${v.kind}`)}</Badge>
                  <span className="min-w-0 flex-1 font-medium">{v.hypothesis}</span>
                  <span className="text-xs text-muted-foreground">
                    {v.sampleSize != null ? `n=${v.sampleSize} · ` : ""}
                    {formatDate(v.createdAt, locale, tz)}
                  </span>
                  {canEdit ? (
                    <span className="flex items-center gap-1">
                      <InlineEdit kind="validation" base={base} productId={productId} id={v.id} initial={{ kind: v.kind, hypothesis: v.hypothesis, evidence: v.evidence ?? "", result: v.result, sampleSize: v.sampleSize == null ? "" : String(v.sampleSize), sourceUrl: v.sourceUrl ?? "" }} />
                      <DeleteIconButton url={`${base}/product/validations/${v.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} />
                    </span>
                  ) : null}
                </div>
                {v.evidence ? <p className="whitespace-pre-wrap text-muted-foreground">{v.evidence}</p> : null}
                {v.sourceUrl ? (
                  <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-primary hover:underline">
                    {host(v.sourceUrl)}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("product.research.noValidations")}</Empty>
        )}
      </Card>

      <Card>
        <CardHeader title={t("product.research.personas")} />
        {canEdit ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("product.research.addPersona")}</summary>
            <PersonaForm base={base} productId={productId} />
          </details>
        ) : null}
        {r.personas.length ? (
          <ul className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {r.personas.map((p) => (
              <li key={p.id} className="flex flex-wrap content-start gap-1 rounded-md border p-3 text-sm">
                <div className="flex w-full items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.role ? <span className="text-xs text-muted-foreground">{p.role}</span> : null}
                  {canEdit ? (
                    <span className="ms-auto flex items-center gap-1">
                      <InlineEdit kind="persona" base={base} productId={productId} id={p.id} initial={{ name: p.name, role: p.role ?? "", description: p.description ?? "", goals: p.goals ?? "", painPoints: p.painPoints ?? "" }} />
                      <DeleteIconButton url={`${base}/product/personas/${p.id}`} label={t("work.delete")} confirm={t("work.confirmDelete")} />
                    </span>
                  ) : null}
                </div>
                {p.description ? <p className="w-full whitespace-pre-wrap">{p.description}</p> : null}
                {p.goals ? (
                  <p className="w-full whitespace-pre-wrap">
                    <span className="block text-xs text-muted-foreground">{t("product.research.goals")}</span>
                    {p.goals}
                  </p>
                ) : null}
                {p.painPoints ? (
                  <p className="w-full whitespace-pre-wrap">
                    <span className="block text-xs text-muted-foreground">{t("product.research.painPoints")}</span>
                    {p.painPoints}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("product.research.noPersonas")}</Empty>
        )}
      </Card>
    </div>
  );
}
