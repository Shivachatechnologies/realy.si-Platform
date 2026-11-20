import type { Metadata } from "next";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { DecisionForm } from "@/components/finance/approval-forms";
import { txnOptions } from "@/components/finance/options";
import { financePage } from "@/components/finance/page-context";
import { ActionButton, FormDialog, ResourceForm, type FieldSpec } from "@/components/finance/ui";
import { APPROVAL_TONE, Empty, Kpi, Pager, StatusBadge, withParams } from "@/components/finance/widgets";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { APPROVAL_KINDS, APPROVER_MODES, listApprovalRules } from "@/server/modules/finance/approval-rules";
import { APPROVAL_STATUSES, listApprovalRequests, parseApprovalFilters } from "@/server/modules/finance/approvals";
import { fromMinor } from "@/server/modules/finance/common";
import { listFinanceAccounts } from "@/server/modules/finance/setup";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.tabs.approvals") };
}

export default async function ApprovalsPage({ searchParams }: PageProps<"/[locale]/finance/approvals">) {
  const p = await financePage("approvals");
  if (p.blocked) return p.blocked;
  const { t, locale, viewer, org, company, money, base, day } = p;
  const params = await searchParams;
  const f = parseApprovalFilters(params);
  const highlight = typeof params.request === "string" ? params.request : null;
  const [list, rules, options, accounts, members] = await Promise.all([
    listApprovalRequests(viewer.ctx, org.id, company.id, f),
    listApprovalRules(viewer.ctx, org.id, company.id),
    p.canManage ? txnOptions(viewer.ctx, org.id, company.id) : Promise.resolve(null),
    listFinanceAccounts(viewer.ctx, org.id, company.id),
    p.canManage ? db().membership.findMany({ where: { organizationId: org.id, status: "ACTIVE" }, select: { user: { select: { id: true, name: true, email: true } } }, take: 1000 }) : Promise.resolve([]),
  ]);
  const path = `/${locale}/finance/approvals`;
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const ruleFields: FieldSpec[] = options
    ? [
        { name: "name", label: t("finance.fields.name"), required: true, maxLength: 120 },
        { name: "kind", label: t("finance.approvals.appliesTo"), type: "select", emptyLabel: t("finance.approvals.kinds.ANY"), options: APPROVAL_KINDS.map((k) => ({ value: k, label: t(`finance.approvals.kinds.${k}`) })) },
        { name: "minAmount", label: t("finance.approvals.minAmount"), type: "amount", required: true, hint: t("finance.approvals.minAmountHint") },
        { name: "departmentId", label: t("finance.fields.costCenter"), type: "select", emptyLabel: t("finance.allCostCenters"), options: options.costCenters },
        { name: "categoryId", label: t("finance.fields.category"), type: "select", emptyLabel: t("finance.allCategories"), options: options.categories.filter((c) => c.kind === "EXPENSE") },
        { name: "approverMode", label: t("finance.approvals.approverMode"), type: "select", options: APPROVER_MODES.map((m) => ({ value: m, label: t(`finance.approvals.modes.${m}`) })) },
        { name: "approverUserId", label: t("finance.approvals.approverUser"), type: "select", emptyLabel: "—", hint: t("finance.approvals.approverUserHint"), options: members.map((m) => ({ value: m.user.id, label: `${m.user.name} (${m.user.email})` })) },
        { name: "active", label: t("finance.approvals.active"), type: "checkbox" },
      ]
    : [];
  const userName = new Map(members.map((m) => [m.user.id, m.user.name]));
  const scopes = ["mine", "requested", ...(list.manager ? ["all"] : [])] as const;

  return p.frame(
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label={t("finance.approvals.waitingForYou")} value={list.pendingForMe} tone={list.pendingForMe ? "warning" : undefined} />
        <Kpi label={t("finance.approvals.rulesActive")} value={rules.filter((r) => r.active).length} />
        <Kpi label={t("finance.tabs.claims")} value={<Link href={`/${locale}/finance/claims`} className="text-base hover:underline">{t("finance.claims.submitShort")}</Link>} />
      </div>
      <Card>
        <CardHeader title={t("finance.approvals.queue")} description={t("finance.count", { count: list.total })} />
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <nav className="flex flex-wrap gap-1 text-sm" aria-label={t("finance.approvals.queue")}>
            {scopes.map((s) => (
              <Link key={s} href={withParams(path, {}, { scope: s })} aria-current={list.scope === s ? "page" : undefined} className={cn("rounded-md px-3 py-1.5", list.scope === s ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
                {t(`finance.approvals.scopes.${s}`)}
              </Link>
            ))}
          </nav>
          <form action={path} className="ms-auto flex flex-wrap gap-2">
            <input type="hidden" name="scope" value={list.scope} />
            <Select name="status" defaultValue={f.status ?? "any"} aria-label={t("common.status")} className="h-8 w-40">
              <option value="any">{t("finance.allStatuses")}</option>
              {APPROVAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`finance.approvals.statuses.${s}`)}
                </option>
              ))}
            </Select>
            <Select name="kind" defaultValue={f.kind ?? ""} aria-label={t("finance.approvals.appliesTo")} className="h-8 w-40">
              <option value="">{t("finance.approvals.kinds.ANY")}</option>
              {APPROVAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`finance.approvals.kinds.${k}`)}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" variant="secondary">
              {t("finance.apply")}
            </Button>
          </form>
        </div>
        {!list.rows.length ? (
          <Empty>{list.scope === "mine" && f.status === "PENDING" ? t("finance.approvals.nothingPending") : t("common.noResults")}</Empty>
        ) : (
          <ul className="grid divide-y">
            {list.rows.map((r) => {
              const href = r.bill ? `/${locale}/finance/bills/${r.bill.id}` : r.expenseClaim ? `/${locale}/finance/claims/${r.expenseClaim.id}` : null;
              return (
                <li key={r.id} id={r.id} className={cn("grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]", highlight === r.id && "bg-muted/50")}>
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={APPROVAL_TONE[r.status]}>{t(`finance.approvals.statuses.${r.status}`)}</StatusBadge>
                      <StatusBadge tone="neutral">{t(`finance.approvals.kinds.${r.kind}`)}</StatusBadge>
                      {href ? (
                        <Link href={href} className="font-medium hover:underline">
                          {r.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.title}</span>
                      )}
                      {r.expenseClaim?.receipt ? <Paperclip className="size-3.5 text-muted-foreground" aria-label={t("finance.claims.receipt")} /> : null}
                      <span className="ms-auto font-semibold tabular-nums">{money(r.amountMinor, r.currency)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("finance.approvals.requestedBy", { name: r.requestedByName ?? "—" })} · {formatDateTime(r.createdAt, locale, p.tz)}
                      {r.rule ? ` · ${t("finance.approvals.byRule", { name: r.rule.name })}` : ""}
                      {r.bill ? ` · ${t("finance.bills.dueOn", { date: day(r.bill.dueDate) })}` : ""}
                      {r.expenseClaim ? ` · ${day(r.expenseClaim.date)}${r.expenseClaim.merchant ? ` · ${r.expenseClaim.merchant}` : ""}` : ""}
                    </p>
                    {r.decidedAt ? (
                      <p className="text-xs text-muted-foreground">
                        {t("finance.approvals.decidedBy", { name: r.decidedByName ?? "—", date: formatDateTime(r.decidedAt, locale, p.tz) })}
                        {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {r.canDecide ? (
                    <div className="flex items-start sm:justify-end">
                      <FormDialog trigger={t("finance.approvals.decide")} title={r.title} description={money(r.amountMinor, r.currency)} variant="default">
                        <DecisionForm endpoint={`${base}/approvals/${r.id}/decision`} accounts={r.kind === "EXPENSE" ? accountOptions : undefined} />
                      </FormDialog>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Pager path={path} params={params} page={f.page} pages={list.pages} labels={{ previous: t("common.previous"), next: t("common.next"), page: t("finance.pageOf", { page: f.page, pages: list.pages }) }} />
      </Card>

      <Card>
        <CardHeader title={t("finance.approvals.rulesTitle")} description={t("finance.approvals.rulesHint")} />
        {p.canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("finance.approvals.newRule")}</summary>
            <CardBody className="border-t">
              <ResourceForm endpoint={`${base}/approval-rules`} fields={ruleFields} initial={{ approverMode: "FINANCE_MANAGERS", active: true, minAmount: "0" }} submitLabel={t("finance.approvals.newRule")} />
            </CardBody>
          </details>
        ) : null}
        {!rules.length ? (
          <Empty>{t("finance.approvals.noRules")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("finance.fields.name")}</Th>
                <Th>{t("finance.approvals.appliesTo")}</Th>
                <Th className="text-end">{t("finance.approvals.minAmount")}</Th>
                <Th>{t("finance.budgets.scope")}</Th>
                <Th>{t("finance.approvals.approverMode")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {rules.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>{t(`finance.approvals.kinds.${r.kind ?? "ANY"}`)}</Td>
                  <Td className="text-end tabular-nums">{money(r.minAmountMinor)}</Td>
                  <Td className="text-muted-foreground">{[r.department?.name ?? t("finance.allCostCenters"), r.category?.name].filter(Boolean).join(" · ")}</Td>
                  <Td>
                    {t(`finance.approvals.modes.${r.approverMode}`)}
                    {r.approverMode === "USER" && r.approverUserId ? <span className="block text-xs text-muted-foreground">{userName.get(r.approverUserId) ?? "—"}</span> : null}
                  </Td>
                  <Td>
                    <StatusBadge tone={r.active ? "success" : "neutral"}>{r.active ? t("common.enabled") : t("common.disabled")}</StatusBadge>
                  </Td>
                  <Td>
                    {p.canManage ? (
                      <div className="flex justify-end gap-1">
                        <FormDialog trigger={t("finance.edit")} title={r.name}>
                          <ResourceForm
                            endpoint={`${base}/approval-rules/${r.id}`}
                            method="PATCH"
                            fields={ruleFields}
                            initial={{ name: r.name, kind: r.kind ?? "", minAmount: fromMinor(r.minAmountMinor, company.baseCurrency), departmentId: r.departmentId ?? "", categoryId: r.categoryId ?? "", approverMode: r.approverMode, approverUserId: r.approverUserId ?? "", active: r.active }}
                            submitLabel={t("common.save")}
                          />
                        </FormDialog>
                        <ActionButton endpoint={`${base}/approval-rules/${r.id}`} method="DELETE" variant="ghost" label={t("finance.delete")} confirm={t("finance.approvals.confirmDeleteRule")} />
                      </div>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>,
  );
}
