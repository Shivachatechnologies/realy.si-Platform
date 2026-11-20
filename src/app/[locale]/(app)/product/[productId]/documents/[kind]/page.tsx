import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton } from "@/components/work/actions";
import { AiPanel } from "@/components/work/ai-panel";
import { DocEditor, DocStatusSelect, GenerateAi } from "@/components/work/product-client";
import { DOC_STATUS_TONE, productWorkspace } from "@/components/work/product-ui";
import { formatDateTime } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { DOC_PROFILE, docSubject, getDoc, kindParam } from "@/server/modules/work/product-docs";

export async function generateMetadata({ params }: PageProps<"/[locale]/product/[productId]/documents/[kind]">): Promise<Metadata> {
  const { kind } = await params;
  const t = await getT();
  try {
    return { title: t(`product.docKinds.${kindParam(kind)}`) };
  } catch {
    return { title: t("product.workspace.tabs.documents") };
  }
}

export default async function DocumentPage({ params, searchParams }: PageProps<"/[locale]/product/[productId]/documents/[kind]">) {
  const { productId, kind: rawKind } = await params;
  let kind;
  try {
    kind = kindParam(rawKind);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const w = await productWorkspace(productId, "documents");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company, base, tz, canEdit, canRunAgents } = w;
  const sp = await searchParams;
  const vRaw = Number(Array.isArray(sp.version) ? sp.version[0] : sp.version);
  const version = Number.isInteger(vRaw) && vRaw > 0 ? vRaw : undefined;
  const [doc, aiTasks] = await Promise.all([
    getDoc(viewer.ctx, org.id, company.id, productId, kind, version),
    canRunAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, docSubject(kind), productId) : [],
  ]);
  const docUrl = `${base}/product/products/${productId}/docs/${rawKind.toLowerCase()}`;
  const page = `/${locale}/product/${productId}/documents/${rawKind.toLowerCase()}`;
  const viewingOld = !!doc?.shown && doc.shown.version !== doc.currentVersion;
  const used = new Set(doc?.versions.map((v) => v.agentTaskId).filter(Boolean));
  const drafts = aiTasks.filter((x) => x.status === "COMPLETED" && x.output?.trim());
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <Link href={`/${locale}/product/${productId}/documents`} className="text-sm text-muted-foreground hover:underline">
        ← {t("product.workspace.tabs.documents")}
      </Link>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {t(`product.docKinds.${kind}`)}
                {doc ? <Badge>v{doc.shown?.version ?? doc.currentVersion}</Badge> : null}
                {doc ? <Badge tone={DOC_STATUS_TONE[doc.status]}>{t(`product.docStatus.${doc.status}`)}</Badge> : null}
              </span>
            }
            description={t(`product.docHints.${kind}`)}
            actions={
              <span className="flex flex-wrap items-center gap-2">
                {doc && canEdit ? <DocStatusSelect url={`${docUrl}/status`} value={doc.status} /> : null}
                {doc?.brainDocumentId ? (
                  <Link href={`/${locale}/brain/${doc.brainDocumentId}`} className="text-xs text-primary hover:underline">
                    {t("product.docs.openInBrain")}
                  </Link>
                ) : null}
              </span>
            }
          />
          <CardBody className="grid gap-3">
            {viewingOld ? (
              <Notice tone="info">
                <span className="flex flex-wrap items-center gap-2">
                  {t("product.docs.viewingVersion", { version: doc!.shown!.version, current: doc!.currentVersion })}
                  {canEdit ? (
                    <ActionButton url={`${docUrl}/restore`} body={{ version: doc!.shown!.version }} redirectTo={page}>
                      {t("product.docs.restore")}
                    </ActionButton>
                  ) : null}
                  <Link href={page} className="text-xs hover:underline">
                    {t("product.docs.backToCurrent")}
                  </Link>
                </span>
              </Notice>
            ) : null}
            <DocEditor key={`${doc?.shown?.version ?? 0}`} url={docUrl} initial={doc?.shown?.content ?? ""} canEdit={canEdit && !viewingOld} disabledHint={viewingOld ? undefined : t("product.docs.readOnly")} />
          </CardBody>
        </Card>
        <div className="grid content-start gap-4">
          <AiPanel
            t={t}
            locale={locale}
            tz={tz}
            title={t("product.docs.aiTitle")}
            description={t("product.docs.aiHint", { role: t(`profiles.${DOC_PROFILE[kind]}.name`) })}
            configured={aiConfigured()}
            tasks={aiTasks}
            actions={
              canRunAgents && canEdit ? (
                <div className="grid w-full gap-3">
                  <GenerateAi url={`${docUrl}/ai`} label={t("product.docs.generate")} placeholder={t("product.docs.guidance")} />
                  {drafts.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">{formatDateTime(d.createdAt, locale, tz)}</span>
                      {used.has(d.id) ? (
                        <Badge tone="success">{t("product.docs.draftUsed")}</Badge>
                      ) : (
                        <ActionButton url={`${docUrl}/draft`} body={{ taskId: d.id }} confirm={doc ? t("product.docs.confirmUseDraft") : undefined}>
                          {t("product.docs.useDraft")}
                        </ActionButton>
                      )}
                    </div>
                  ))}
                </div>
              ) : null
            }
          />
          <Card>
            <CardHeader title={t("product.docs.versions")} />
            {doc?.versions.length ? (
              <ul className="grid divide-y text-sm">
                {doc.versions.map((v) => (
                  <li key={v.id}>
                    <Link href={v.version === doc.currentVersion ? page : `${page}?version=${v.version}`} aria-current={doc.shown?.version === v.version ? "true" : undefined} className="grid gap-0.5 px-4 py-2 hover:bg-muted aria-[current=true]:bg-accent/40">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">v{v.version}</span>
                        {v.agentTaskId ? <Badge tone="brand">AI</Badge> : null}
                        <span className="text-xs text-muted-foreground">{formatDateTime(v.createdAt, locale, tz)}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {v.createdByName ?? ""}
                        {v.changeNote ? ` · ${v.changeNote}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("product.docs.noVersions")}</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

