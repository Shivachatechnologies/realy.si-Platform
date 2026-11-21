import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { MemberPicker, RemoveMember, SegmentForm } from "@/components/marketing/audience-forms";
import { Kpi, MarketingShell, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { contactTags, getSegment } from "@/server/modules/marketing/segments";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.audience") };
}

export default async function SegmentPage({ params, searchParams }: PageProps<"/[locale]/marketing/audience/[segmentId]">) {
  const { segmentId } = await params;
  const qRaw = (await searchParams).q;
  const q = typeof qRaw === "string" ? qRaw.trim().slice(0, 200) || undefined : undefined;
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/audience`, label: t("marketing.audience.title") };
  if (m.blocked) return <MarketingShell locale={locale} t={t} tab="audience" title={t("marketing.audience.title")} back={back} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage } = m;
  const d = await getSegment(viewer.ctx, org.id, company.id, segmentId, q).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const s = d.segment;
  const manage = canManage && !s.archivedAt;
  const tags = manage ? await contactTags(viewer.ctx, org.id, company.id) : [];

  return (
    <MarketingShell
      locale={locale}
      t={t}
      tab="audience"
      back={back}
      title={s.name}
      subtitle={`${t(`marketing.audience.kinds.${s.kind}`)}${s.description ? ` · ${s.description}` : ""}`}
      actions={manage ? <ActionButton path={`${base}/segments/${s.id}`} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} redirectTo={back.href} /> : null}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi label={t("marketing.audience.contacts")} value={d.count} />
        <Kpi label={t("marketing.audience.emailable")} value={d.emailable} hint={t("marketing.audience.emailableHint")} />
      </div>
      {manage && s.kind === "STATIC" ? (
        <Card>
          <CardHeader title={t("marketing.audience.addContacts")} />
          <MemberPicker base={base} segmentId={s.id} />
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("marketing.audience.members")} description={t("marketing.audience.previewHint")} />
        <form className="flex gap-2 border-b p-3" action={`/${locale}/marketing/audience/${s.id}`}>
          <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} aria-label={t("marketing.common.search")} placeholder={t("marketing.audience.searchContacts")} />
          <Button type="submit" variant="secondary">
            {t("marketing.common.search")}
          </Button>
        </form>
        {d.contacts.length === 0 ? (
          <p className="p-4 text-muted-foreground">{q ? t("common.noResults") : t("marketing.audience.noMembers")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.audience.contact")}</Th>
                <Th>{t("marketing.audience.account")}</Th>
                <Th>{t("marketing.audience.tags")}</Th>
                <Th>{t("marketing.audience.consent")}</Th>
                {manage && s.kind === "STATIC" ? <Th className="w-0" /> : null}
              </Tr>
            </THead>
            <TBody>
              {d.contacts.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <p className="font-medium">
                      {c.firstName} {c.lastName ?? ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{c.email ?? "—"}</p>
                  </Td>
                  <Td className="text-xs">{c.account ? `${c.account.name} (${t(`marketing.audience.accountType.${c.account.type}`)})` : "—"}</Td>
                  <Td className="text-xs text-muted-foreground">{c.tags.join(", ") || "—"}</Td>
                  <Td className="text-xs">{c.unsubscribedAt ? <span className="text-warning">{t("marketing.audience.unsubscribed")}</span> : c.marketingConsent ? <span className="text-success">{t("marketing.audience.optedIn")}</span> : t("marketing.audience.noConsent")}</Td>
                  {manage && s.kind === "STATIC" ? (
                    <Td>
                      <RemoveMember base={base} segmentId={s.id} contactId={c.id} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {t("marketing.audience.crmNote")}{" "}
          <Link href={`/${locale}/crm`} className="underline">
            {t("modules.crm.title")}
          </Link>
        </p>
      </Card>
      {manage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.audience.edit")}</summary>
            <SegmentForm base={base} locale={locale} knownTags={tags} initial={{ id: s.id, name: s.name, description: s.description ?? "", kind: s.kind, tags: s.tags.join(", "), accountTypes: s.accountTypes, consentOnly: s.consentOnly }} />
          </details>
        </Card>
      ) : null}
    </MarketingShell>
  );
}
