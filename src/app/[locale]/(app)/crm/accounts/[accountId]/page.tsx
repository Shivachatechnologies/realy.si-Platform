import { aiConfigured } from "@/server/modules/agents/runtime";
import { HelpMeButton } from "@/components/crm/guided-kit";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TYPE_TONE } from "@/components/crm/accounts-list";
import { SubjectActivity } from "@/components/crm/activity-cards";
import { EmailHistoryPanel, SalesTasksPanel } from "@/components/crm/record-panels";
import { ActionButton, AiActions } from "@/components/crm/kit";
import { MergeRecordButton } from "@/components/crm/merge-button";
import { AccountForm } from "@/components/crm/record-forms";
import { CrmFrame, Facts, Stat, SubjectTasks, TagList, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { getAccount } from "@/server/modules/crm/accounts";
import { sourceNames } from "@/server/modules/crm/config";
import { contactName } from "@/server/modules/crm/contacts";
import { customDisplay, listFieldDefs } from "@/server/modules/crm/custom-fields";
import { dealWeighted } from "@/server/modules/crm/deals";
import { listOwners } from "@/server/modules/crm/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.accounts") };
}

export default async function AccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="accounts">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer, tz } = c;
  const a = await getAccount(viewer.ctx, org.id, company.id, accountId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const [owners, sources, fields] = await Promise.all([listOwners(viewer.ctx, org.id, company.id), sourceNames(viewer.ctx, org.id, company.id), listFieldDefs(viewer.ctx, org.id, company.id, "ACCOUNT")]);
  const active = !a.archivedAt;
  const cur = company.baseCurrency;
  const money = (m: bigint, currency = cur) => formatMoney({ amountMinor: m, currency }, locale);
  const base$ = a.crmDeals.filter((d) => d.currency === cur);
  const open = base$.filter((d) => d.status === "OPEN");
  const won = base$.filter((d) => d.status === "WON");
  const custom = (a.customFields ?? {}) as Record<string, string | number | null>;
  return (
    <CrmFrame active="accounts" intro={false} actions={c.canRunAgents && aiConfigured() ? <HelpMeButton base={base} url={`${base}/crm/help`} body={{ kind: "account", id: a.id, page: "crm.account" }} locale={locale} /> : undefined} title={a.name} subtitle={[t(`crm.accountTypes.${a.type}`), a.industry].filter(Boolean).join(" · ")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/${locale}/crm/accounts`} className="text-sm text-muted-foreground hover:underline">
          ← {t("crm.accounts.back")}
        </Link>
        {c.canManage && active ? (
          <ActionButton url={`${base}/crm/accounts/${a.id}`} method="DELETE" icon="archive" label={t("crm.archive")} confirm={t("crm.archiveRecordConfirm")} redirectTo={`/${locale}/crm/accounts`} />
        ) : null}
      </div>
      {!active ? (
        <Notice tone="warning">
          {a.mergedIntoId ? (
            <Link href={`/${locale}/crm/accounts/${a.mergedIntoId}`} className="hover:underline">
              {t("crm.mergedRecordNotice")}
            </Link>
          ) : (
            t("crm.archivedRecordNotice")
          )}
        </Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t("crm.accounts.openDeals")} value={open.length} />
        <Stat label={t("crm.pipelineValue")} value={money(open.reduce((s, d) => s + d.amountMinor, 0n))} />
        <Stat label={t("crm.weightedPipeline")} value={money(open.reduce((s, d) => s + dealWeighted(d), 0n))} />
        <Stat label={t("crm.wonValue")} value={money(won.reduce((s, d) => s + d.amountMinor, 0n))} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {t("crm.details")}
                  <Badge tone={TYPE_TONE[a.type]}>{t(`crm.accountTypes.${a.type}`)}</Badge>
                </span>
              }
              actions={<TagList tags={a.tags} />}
            />
            <CardBody className="grid gap-4">
              <Facts
                items={[
                  [t("crm.fields.website"), a.website ? <a href={a.website.startsWith("http") ? a.website : `https://${a.website}`} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.website}</a> : a.domain],
                  [t("crm.email"), a.email],
                  [t("crm.phone"), a.phone],
                  [t("crm.owner"), a.owner?.name ?? t("crm.unassigned")],
                  [t("crm.fields.country"), a.countryCode],
                  [t("crm.fields.territory"), a.territory],
                  [t("crm.source"), a.source],
                  [t("crm.created"), formatDate(a.createdAt, locale, tz)],
                  ...customDisplay(fields, a.customFields).map((f) => [f.label, f.value] as [string, string]),
                ]}
              />
              {a.notes ? <p className="whitespace-pre-wrap text-sm">{a.notes}</p> : null}
              {c.canManage && active ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">{t("crm.edit")}</summary>
                  <AccountForm
                    base={base}
                    locale={locale}
                    owners={owners}
                    sources={sources}
                    fields={fields}
                    accountId={a.id}
                    initial={{
                      name: a.name,
                      type: a.type,
                      domain: a.domain ?? "",
                      website: a.website ?? "",
                      industry: a.industry ?? "",
                      email: a.email ?? "",
                      phone: a.phone ?? "",
                      countryCode: a.countryCode ?? "",
                      territory: a.territory ?? "",
                      source: a.source ?? "",
                      ownerId: a.ownerId ?? "",
                      notes: a.notes ?? "",
                      tags: a.tags,
                      customFields: Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, v == null ? "" : String(v)])),
                    }}
                  />
                </details>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title={t("crm.tabs.deals")}
              actions={
                c.canManage && active ? (
                  <Link href={`/${locale}/crm/deals?new=1&account=${a.id}`} className="text-xs hover:underline">
                    {t("crm.deals.add")}
                  </Link>
                ) : null
              }
            />
            {a.crmDeals.length ? (
              <ul className="grid divide-y text-sm">
                {a.crmDeals.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <Link href={`/${locale}/crm/deals/${d.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {d.name}
                    </Link>
                    <Badge tone={d.status === "WON" ? "success" : d.status === "LOST" ? "danger" : "neutral"}>{d.stage.name}</Badge>
                    <span className="text-xs text-muted-foreground">{d.ownerName ?? t("crm.unassigned")}</span>
                    {d.expectedCloseDate ? <span className="text-xs text-muted-foreground">{formatDate(d.expectedCloseDate, locale, "UTC")}</span> : null}
                    <span className="tabular-nums">{money(d.amountMinor, d.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("crm.deals.none")}</p>
            )}
          </Card>
          <SubjectActivity subjectType="account" subjectId={a.id} owners={owners} active={active} defaultAssignee={a.ownerId} />
          <EmailHistoryPanel subjectType="account" subjectId={a.id} />
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <SalesTasksPanel subjectType="account" subjectId={a.id} active={active} defaultAssignee={a.ownerId} />
          <SubjectTasks
            subjectType="account"
            subjectId={a.id}
            actions={
              active ? (
                <AiActions
                  url={`${base}/crm/accounts/${a.id}/ai`}
                  locale={locale}
                  actions={[
                    { mode: "analyze", label: t("crm.ai.analyzeAccount") },
                    { mode: "next_action", label: t("crm.ai.nextAction") },
                    { mode: "draft_follow_up", label: t("crm.ai.draftFollowUp") },
                  ]}
                />
              ) : null
            }
          />
          <Card>
            <CardHeader
              title={t("crm.tabs.contacts")}
              actions={
                c.canManage && active ? (
                  <Link href={`/${locale}/crm/contacts?account=${a.id}`} className="text-xs hover:underline">
                    {t("crm.accounts.manageContacts")}
                  </Link>
                ) : null
              }
            />
            {a.contacts.length ? (
              <ul className="grid divide-y text-sm">
                {a.contacts.map((p) => (
                  <li key={p.id} className="grid gap-0.5 px-4 py-2">
                    <Link href={`/${locale}/crm/contacts/${p.id}`} className="font-medium hover:underline">
                      {contactName(p)}
                    </Link>
                    <span className="text-xs text-muted-foreground">{[p.title, p.email, p.phone].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("crm.contacts.none")}</p>
            )}
          </Card>
          {a.duplicates.length ? (
            <Card>
              <CardHeader title={t("crm.duplicates")} description={t("crm.duplicatesRecordHint")} />
              <ul className="grid divide-y">
                {a.duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                    <Link href={`/${locale}/crm/accounts/${d.id}`} className="font-medium hover:underline">
                      {d.name}
                    </Link>
                    <span className="flex-1 text-xs text-muted-foreground">{d.domain}</span>
                    {c.canManage ? <MergeRecordButton url={`${base}/crm/accounts/${a.id}/merge`} secondaryId={d.id} label={d.name} /> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </CrmFrame>
  );
}
