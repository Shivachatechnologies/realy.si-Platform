import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { CopyLink } from "@/components/finance/billing-actions";
import { ActionButton } from "@/components/crm/kit";
import { ProposalDocument } from "@/components/crm/proposal-document";
import { DraftWithAiButton, ProposalEditor, SendProposalForm, UseAiDraftButton } from "@/components/crm/proposals";
import { CrmFrame, Facts, PROPOSAL_TONE, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { emailConfigured } from "@/server/modules/email/service";
import { contactName, contactOptions } from "@/server/modules/crm/contacts";
import { getProposal, lineToInput, publicProposalUrl } from "@/server/modules/crm/proposals";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.proposals") };
}

const TASK_TONE = { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral", WAITING_APPROVAL: "warning" } as const;

export default async function ProposalPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await params;
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="proposals">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer, tz } = c;
  const p = await getProposal(viewer.ctx, org.id, company.id, proposalId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const chain = await companyChain(db(), org.id, company.id);
  const [contacts, canFinance, tasks] = await Promise.all([
    c.canManage ? contactOptions(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    can(viewer.ctx, "finance.manage", chain),
    c.canReadAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, "crm_proposal", p.id, 5) : Promise.resolve([]),
  ]);
  const active = !p.archivedAt;
  const locked = p.status === "ACCEPTED" || p.status === "DECLINED";
  const editable = c.canManage && active && !locked;
  const link = publicProposalUrl(p.shareToken, locale);
  const doc = {
    ...p,
    companyName: company.name,
    customerName: p.account?.name ?? null,
    customerAddress: p.account?.address ?? null,
    contactName: p.contact ? contactName(p.contact) : null,
  };
  return (
    <CrmFrame active="proposals" intro={false} title={`${p.number} · ${p.title}`} subtitle={`${p.deal.name} · ${t("crm.proposals.versionN", { version: p.version })}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/${locale}/crm/proposals`} className="text-sm text-muted-foreground hover:underline">
          ← {t("crm.proposals.back")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}/crm/proposals/${p.id}/print`}>
              <Printer aria-hidden />
              {t("crm.proposals.printable")}
            </Link>
          </Button>
          {c.canManage && active ? (
            <ActionButton url={`${base}/crm/proposals/${p.id}`} method="DELETE" icon="archive" label={t("crm.archive")} confirm={t("crm.archiveRecordConfirm")} redirectTo={`/${locale}/crm/proposals`} />
          ) : null}
        </div>
      </div>
      {!active ? <Notice tone="warning">{t("crm.archivedRecordNotice")}</Notice> : null}
      {p.status === "ACCEPTED" ? <Notice tone="success">{t("crm.proposals.acceptedNotice", { name: p.decisionName ?? "—", date: p.decidedAt ? formatDateTime(p.decidedAt, locale, tz) : "—" })}</Notice> : null}
      {p.status === "DECLINED" ? <Notice tone="warning">{t("crm.proposals.declinedNotice", { name: p.decisionName ?? "—", date: p.decidedAt ? formatDateTime(p.decidedAt, locale, tz) : "—" })}</Notice> : null}
      {p.status === "EXPIRED" ? <Notice tone="warning">{t("crm.proposals.expiredNotice")}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          {editable ? (
            <Card>
              <CardHeader title={t("crm.proposals.editor")} description={t("crm.proposals.editorHint", { currency: p.currency })} />
              <CardBody>
                <ProposalEditor
                  base={base}
                  proposalId={p.id}
                  currency={p.currency}
                  contacts={contacts}
                  locked={locked}
                  revisedNotice={p.status !== "DRAFT"}
                  initial={{
                    title: p.title,
                    contactId: p.contactId ?? "",
                    validUntil: p.validUntil ? p.validUntil.toISOString().slice(0, 10) : "",
                    intro: p.intro,
                    scope: p.scope,
                    timeline: p.timeline,
                    terms: p.terms,
                    createEstimateOnAccept: p.createEstimateOnAccept,
                    lines: p.lines.map((l) => lineToInput(l, p.currency)),
                  }}
                />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("crm.proposals.preview")} description={t("crm.proposals.previewHint")} />
            <CardBody className="bg-muted/40">
              <ProposalDocument doc={doc} t={t} locale={locale} printable={false} />
            </CardBody>
          </Card>
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader title={<Badge tone={PROPOSAL_TONE[p.status]}>{t(`crm.proposals.status.${p.status}`)}</Badge>} />
            <CardBody className="grid gap-3">
              <Facts
                cols={2}
                items={[
                  [t("crm.proposals.deal"), <Link key="d" href={`/${locale}/crm/deals/${p.deal.id}`} className="hover:underline">{p.deal.name}</Link>],
                  [t("crm.stage"), p.deal.stage.name],
                  [t("crm.fields.account"), p.account ? <Link key="a" href={`/${locale}/crm/accounts/${p.account.id}`} className="hover:underline">{p.account.name}</Link> : null],
                  [t("crm.fields.contact"), p.contact ? <Link key="c" href={`/${locale}/crm/contacts/${p.contact.id}`} className="hover:underline">{contactName(p.contact)}</Link> : null],
                  [t("crm.owner"), p.ownerName ?? t("crm.unassigned")],
                  [t("crm.proposals.validUntil"), p.validUntil ? formatDate(p.validUntil, locale, "UTC") : null],
                  [t("crm.proposals.sentAt"), p.sentAt ? `${formatDateTime(p.sentAt, locale, tz)}${p.sentTo ? ` · ${p.sentTo}` : ""}` : null],
                  [t("crm.proposals.views"), p.viewedAt ? t("crm.proposals.viewsValue", { count: p.viewCount, date: formatDateTime(p.viewedAt, locale, tz) }) : String(p.viewCount)],
                  ...(p.decidedAt
                    ? ([
                        [t("crm.proposals.decision"), `${p.decisionName ?? "—"} · ${formatDateTime(p.decidedAt, locale, tz)}`],
                        [t("crm.proposals.decisionIp"), p.decisionIp],
                        [t("crm.proposals.decisionNote"), p.decisionNote],
                      ] as [string, string | null][])
                    : []),
                ]}
              />
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">{t("crm.proposals.shareLink")}</p>
                <CopyLink url={link} />
                <p className="text-xs text-muted-foreground">{p.status === "DRAFT" ? t("crm.proposals.shareDraftHint") : t("crm.proposals.shareHint")}</p>
              </div>
              {p.estimateId ? (
                <p className="text-sm">
                  <Link href={`/${locale}/finance/estimates/${p.estimateId}`} className="font-medium hover:underline">
                    {t("crm.proposals.viewEstimate")} →
                  </Link>
                </p>
              ) : p.status === "ACCEPTED" && canFinance && c.canManage ? (
                <ActionButton url={`${base}/crm/proposals/${p.id}/estimate`} variant="secondary" label={t("crm.proposals.createEstimate")} />
              ) : null}
            </CardBody>
          </Card>
          {c.canManage && active && !locked ? (
            <Card>
              <CardHeader title={t("crm.proposals.sendTitle")} description={t("crm.proposals.sendHint")} />
              <CardBody>
                <SendProposalForm base={base} proposalId={p.id} defaultTo={p.contact?.email ?? ""} defaultSubject={`${p.title} (${p.number})`} emailReady={emailConfigured()} />
              </CardBody>
            </Card>
          ) : null}
          {c.canReadAgents || c.canRunAgents ? (
            <Card>
              <CardHeader title={t("crm.ai.title")} description={t("crm.proposals.aiDescription")} />
              <CardBody className="grid gap-3">
                {c.canRunAgents && editable ? aiConfigured() ? <DraftWithAiButton base={base} locale={locale} proposalId={p.id} /> : <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice> : null}
                {tasks.length ? (
                  <ul className="grid gap-3 text-sm">
                    {tasks.map((task) => (
                      <li key={task.id} className="grid gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={TASK_TONE[task.status]}>{t(`agentTasks.status.${task.status}`)}</Badge>
                          <Link href={`/${locale}/tasks/${task.id}`} className="font-medium hover:underline">
                            {task.title}
                          </Link>
                          <span className="text-xs text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</span>
                        </span>
                        {task.output ? <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{task.output.slice(0, 600)}</p> : null}
                        {task.status === "COMPLETED" && task.output && editable ? (
                          <div>
                            <UseAiDraftButton base={base} proposalId={p.id} taskId={task.id} />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("crm.ai.none")}</p>
                )}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("crm.proposals.sends")} />
            {p.sends.length ? (
              <ul className="grid gap-2 p-4 text-sm">
                {p.sends.map((s) => (
                  <li key={s.id} className="grid gap-0.5">
                    <span>
                      {s.toEmail} · v{s.version}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(s.sentAt, locale, tz)}
                      {s.sentByName ? ` · ${s.sentByName}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("crm.proposals.notSent")}</p>
            )}
          </Card>
          <Card>
            <CardHeader title={t("crm.proposals.revisions")} description={t("crm.proposals.revisionsHint")} />
            {p.revisions.length ? (
              <ul className="grid gap-2 p-4 text-sm">
                {p.revisions.map((r) => {
                  const snap = r.snapshot as { title?: string };
                  return (
                    <li key={r.id}>
                      <details>
                        <summary className="cursor-pointer">
                          v{r.version} · {snap.title ?? "—"} · {formatDateTime(r.createdAt, locale, tz)}
                          {r.createdByName ? ` · ${r.createdByName}` : ""}
                        </summary>
                        <RevisionView snapshot={r.snapshot} currency={p.currency} locale={locale} t={t} />
                      </details>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("crm.proposals.noRevisions")}</p>
            )}
          </Card>
        </div>
      </div>
    </CrmFrame>
  );
}

type Snapshot = {
  title?: string;
  intro?: string;
  scope?: string;
  timeline?: string;
  terms?: string;
  validUntil?: string | null;
  status?: string;
  totals?: { subtotalMinor?: string; discountMinor?: string; taxMinor?: string; totalMinor?: string };
  lines?: { description: string; quantityMilli: number; unitPriceMinor: string; discountBps: number; taxBps: number; totalMinor: string }[];
};

function RevisionView({ snapshot, currency, locale, t }: { snapshot: unknown; currency: string; locale: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  const s = (snapshot ?? {}) as Snapshot;
  return (
    <ProposalDocument
      t={t}
      locale={locale}
      printable={false}
      doc={{
        number: "",
        title: s.title ?? "",
        version: 0,
        currency,
        intro: s.intro ?? "",
        scope: s.scope ?? "",
        timeline: s.timeline ?? "",
        terms: s.terms ?? "",
        validUntil: s.validUntil ? new Date(`${s.validUntil}T00:00:00Z`) : null,
        createdAt: new Date(),
        subtotalMinor: BigInt(s.totals?.subtotalMinor ?? "0"),
        discountMinor: BigInt(s.totals?.discountMinor ?? "0"),
        taxMinor: BigInt(s.totals?.taxMinor ?? "0"),
        totalMinor: BigInt(s.totals?.totalMinor ?? "0"),
        lines: (s.lines ?? []).map((l, i) => ({ id: String(i), description: l.description, quantityMilli: l.quantityMilli, unitPriceMinor: BigInt(l.unitPriceMinor), discountBps: l.discountBps, taxBps: l.taxBps, totalMinor: BigInt(l.totalMinor) })),
        companyName: "",
        customerName: null,
        customerAddress: null,
        contactName: null,
      }}
    />
  );
}
