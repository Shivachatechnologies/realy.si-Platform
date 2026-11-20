import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DecisionForm } from "@/components/finance/approval-forms";
import { financePage } from "@/components/finance/page-context";
import { AttachmentControl } from "@/components/finance/transaction-form";
import { ActionButton } from "@/components/finance/ui";
import { APPROVAL_TONE, CLAIM_TONE, StatusBadge } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { getExpenseClaim } from "@/server/modules/finance/expense-claims";
import { listFinanceAccounts } from "@/server/modules/finance/setup";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.claims") };
}

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await financePage("claims");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const c = await getExpenseClaim(viewer.ctx, org.id, company.id, id).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const me = viewer.ctx.actor.id;
  const pending = c.approvals.find((a) => a.status === "PENDING");
  const canDecide = !!pending && !!me && pending.approverIds.includes(me);
  const accounts = canDecide ? await listFinanceAccounts(viewer.ctx, org.id, company.id) : [];
  const approverIds = pending?.approverIds ?? [];
  const approvers = approverIds.length ? await db().user.findMany({ where: { id: { in: approverIds } }, select: { name: true } }) : [];
  return p.frame(
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/${locale}/finance/claims`} className="w-full text-xs text-muted-foreground hover:underline">
          ← {t("finance.tabs.claims")}
        </Link>
        <h2 className="text-base font-semibold">{c.description}</h2>
        <StatusBadge tone={CLAIM_TONE[c.status]}>{t(`finance.claims.statuses.${c.status}`)}</StatusBadge>
        <span className="ms-auto font-semibold tabular-nums">{money(c.amountMinor, c.currency)}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("finance.details")} />
            <CardBody>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {[
                  [t("finance.claims.requester"), c.requesterName ?? "—"],
                  [t("finance.fields.date"), day(c.date)],
                  [t("finance.claims.merchant"), c.merchant ?? "—"],
                  [t("finance.fields.category"), c.category?.name ?? t("finance.fields.uncategorized")],
                  [t("finance.fields.costCenter"), c.department?.name ?? "—"],
                  [t("finance.fields.project"), c.project?.name ?? "—"],
                ].map(([k, v]) => (
                  <div key={k} className="grid gap-0.5">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {c.notes ? <p className="mt-3 text-sm whitespace-pre-line text-muted-foreground">{c.notes}</p> : null}
            </CardBody>
          </Card>
          {pending ? (
            <Card>
              <CardHeader title={t("finance.approvals.pendingTitle")} description={t("finance.approvals.waitingFor", { names: approvers.map((u) => u.name).join(", ") || "—" })} />
              <CardBody className="grid gap-3">
                {canDecide ? <DecisionForm endpoint={`${base}/approvals/${pending.id}/decision`} accounts={accounts.map((a) => ({ value: a.id, label: a.name }))} /> : <p className="text-sm text-muted-foreground">{t("finance.approvals.notYourDecision")}</p>}
                {c.isRequester && c.status === "PENDING" ? <ActionButton endpoint={`${base}/expense-claims/${c.id}`} method="DELETE" variant="ghost" label={t("finance.claims.withdraw")} confirm={t("finance.claims.confirmWithdraw")} redirectTo={`/${locale}/finance/claims`} /> : null}
              </CardBody>
            </Card>
          ) : null}
          {c.status !== "PENDING" ? (
            <Card>
              <CardHeader title={t(`finance.claims.decided.${c.status}`)} />
              <CardBody className="grid gap-1 text-sm">
                {c.decidedAt ? <p className="text-muted-foreground">{t("finance.approvals.decidedBy", { name: c.decidedByName ?? "—", date: formatDateTime(c.decidedAt, locale, p.tz) })}</p> : null}
                {c.decisionNote ? <p className="whitespace-pre-line">{c.decisionNote}</p> : null}
                {c.transactionId && p.canManage ? (
                  <Link href={`/${locale}/finance/transactions/${c.transactionId}`} className="hover:underline">
                    {t("finance.claims.viewTransaction")}
                  </Link>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("finance.claims.receipt")} />
            <CardBody>
              <AttachmentControl base={base} id={c.id} href={`${base}/expense-claims/${c.id}/receipt`} attachment={c.receipt} canManage={c.status === "PENDING" && (c.isRequester || p.canManage)} canDelete={false} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("finance.approvals.history")} />
            <ul className="grid divide-y text-sm">
              {c.approvals.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <StatusBadge tone={APPROVAL_TONE[a.status]}>{t(`finance.approvals.statuses.${a.status}`)}</StatusBadge>
                  <span className="ms-auto text-xs text-muted-foreground">{formatDateTime(a.createdAt, locale, p.tz)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>,
  );
}
