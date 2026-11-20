import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubjectActivity } from "@/components/crm/activity-cards";
import { EmailHistoryPanel } from "@/components/crm/record-panels";
import { ActionButton } from "@/components/crm/kit";
import { MergeRecordButton } from "@/components/crm/merge-button";
import { ContactForm } from "@/components/crm/record-forms";
import { CrmFrame, Facts, TagList, crmContext } from "@/components/crm/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { accountOptions } from "@/server/modules/crm/accounts";
import { contactName, getContact } from "@/server/modules/crm/contacts";
import { customDisplay, listFieldDefs } from "@/server/modules/crm/custom-fields";
import { listOwners } from "@/server/modules/crm/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.contacts") };
}

export default async function ContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="contacts">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer, tz } = c;
  const contact = await getContact(viewer.ctx, org.id, company.id, contactId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const [owners, accounts, fields] = await Promise.all([
    listOwners(viewer.ctx, org.id, company.id),
    c.canManage ? accountOptions(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    listFieldDefs(viewer.ctx, org.id, company.id, "CONTACT"),
  ]);
  const active = !contact.archivedAt;
  const name = contactName(contact);
  const custom = (contact.customFields ?? {}) as Record<string, string | number | null>;
  return (
    <CrmFrame active="contacts" title={name} subtitle={[contact.title, contact.account?.name].filter(Boolean).join(" · ") || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/${locale}/crm/contacts`} className="text-sm text-muted-foreground hover:underline">
          ← {t("crm.contacts.back")}
        </Link>
        {c.canManage && active ? (
          <ActionButton url={`${base}/crm/contacts/${contact.id}`} method="DELETE" icon="archive" label={t("crm.archive")} confirm={t("crm.archiveRecordConfirm")} redirectTo={`/${locale}/crm/contacts`} />
        ) : null}
      </div>
      {!active ? (
        <Notice tone="warning">
          {contact.mergedIntoId ? (
            <Link href={`/${locale}/crm/contacts/${contact.mergedIntoId}`} className="hover:underline">
              {t("crm.mergedRecordNotice")}
            </Link>
          ) : (
            t("crm.archivedRecordNotice")
          )}
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader title={t("crm.details")} actions={<TagList tags={contact.tags} />} />
            <CardBody className="grid gap-4">
              <Facts
                items={[
                  [t("crm.email"), contact.email ? <a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a> : null],
                  [t("crm.phone"), contact.phone],
                  [t("crm.fields.account"), contact.account ? <Link href={`/${locale}/crm/accounts/${contact.account.id}`} className="hover:underline">{contact.account.name}</Link> : null],
                  [t("crm.owner"), contact.owner?.name ?? t("crm.unassigned")],
                  [t("crm.fields.marketingConsent"), contact.marketingConsent ? t("common.yes") : contact.unsubscribedAt ? t("crm.contacts.unsubscribedOn", { date: formatDate(contact.unsubscribedAt, locale, tz) }) : t("common.no")],
                  [t("crm.contacts.fromLead"), contact.lead ? <Link href={`/${locale}/crm/${contact.lead.id}`} className="hover:underline">{contact.lead.name}</Link> : null],
                  [t("crm.created"), formatDate(contact.createdAt, locale, tz)],
                  ...customDisplay(fields, contact.customFields).map((f) => [f.label, f.value] as [string, string]),
                ]}
              />
              {c.canManage && active ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">{t("crm.edit")}</summary>
                  <ContactForm
                    base={base}
                    locale={locale}
                    owners={owners}
                    accounts={accounts}
                    fields={fields}
                    contactId={contact.id}
                    initial={{
                      firstName: contact.firstName,
                      lastName: contact.lastName ?? "",
                      email: contact.email ?? "",
                      phone: contact.phone ?? "",
                      title: contact.title ?? "",
                      accountId: contact.accountId ?? "",
                      ownerId: contact.ownerId ?? "",
                      marketingConsent: contact.marketingConsent,
                      tags: contact.tags,
                      customFields: Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, v == null ? "" : String(v)])),
                    }}
                  />
                </details>
              ) : null}
            </CardBody>
          </Card>
          <SubjectActivity subjectType="contact" subjectId={contact.id} owners={owners} active={active} defaultAssignee={contact.ownerId} />
          <EmailHistoryPanel subjectType="contact" subjectId={contact.id} />
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader
              title={t("crm.tabs.deals")}
              actions={
                c.canManage && active ? (
                  <Link href={`/${locale}/crm/deals?new=1&contact=${contact.id}${contact.accountId ? `&account=${contact.accountId}` : ""}`} className="text-xs hover:underline">
                    {t("crm.deals.add")}
                  </Link>
                ) : null
              }
            />
            {contact.crmDeals.length ? (
              <ul className="grid divide-y text-sm">
                {contact.crmDeals.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <Link href={`/${locale}/crm/deals/${d.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {d.name}
                    </Link>
                    <Badge tone={d.status === "WON" ? "success" : d.status === "LOST" ? "danger" : "neutral"}>{d.stage.name}</Badge>
                    <span className="tabular-nums">{formatMoney({ amountMinor: d.amountMinor, currency: d.currency }, locale)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("crm.deals.none")}</p>
            )}
          </Card>
          {contact.duplicates.length ? (
            <Card>
              <CardHeader title={t("crm.duplicates")} description={t("crm.duplicatesRecordHint")} />
              <ul className="grid divide-y">
                {contact.duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                    <Link href={`/${locale}/crm/contacts/${d.id}`} className="font-medium hover:underline">
                      {contactName(d)}
                    </Link>
                    <span className="flex-1 text-xs text-muted-foreground">{[d.email, d.phone].filter(Boolean).join(" · ")}</span>
                    {c.canManage ? <MergeRecordButton url={`${base}/crm/contacts/${contact.id}/merge`} secondaryId={d.id} label={contactName(d)} /> : null}
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
