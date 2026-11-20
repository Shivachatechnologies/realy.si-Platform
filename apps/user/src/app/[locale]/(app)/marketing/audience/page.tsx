import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SegmentForm } from "@/components/marketing/audience-forms";
import { MarketingShell, loadMarketing } from "@/components/marketing/shell";
import { getT } from "@/i18n/server";
import { contactTags, listSegments } from "@/server/modules/marketing/segments";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.audience") };
}

export default async function AudiencePage() {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "audience" as const, title: t("marketing.audience.title"), subtitle: t("marketing.audience.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage } = m;
  const [segments, tags] = await Promise.all([listSegments(viewer.ctx, org.id, company.id), canManage ? contactTags(viewer.ctx, org.id, company.id) : Promise.resolve([])]);
  return (
    <MarketingShell {...shell}>
      {canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.audience.create")}</summary>
            <SegmentForm base={base} locale={locale} knownTags={tags} />
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("marketing.audience.segments")} description={t("marketing.audience.consentNote")} />
        {segments.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("marketing.audience.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.audience.name")}</Th>
                <Th>{t("marketing.audience.kind")}</Th>
                <Th>{t("marketing.audience.rules")}</Th>
                <Th className="text-end">{t("marketing.audience.contacts")}</Th>
                <Th className="text-end">{t("marketing.audience.emailable")}</Th>
              </Tr>
            </THead>
            <TBody>
              {segments.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/${locale}/marketing/audience/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                    {s.description ? <p className="text-xs text-muted-foreground">{s.description}</p> : null}
                  </Td>
                  <Td className="text-xs">{t(`marketing.audience.kinds.${s.kind}`)}</Td>
                  <Td className="text-xs text-muted-foreground">
                    {s.kind === "STATIC"
                      ? t("marketing.audience.staticRule")
                      : [s.tags.length ? `${t("marketing.audience.tags")}: ${s.tags.join(", ")}` : null, s.accountTypes.length ? `${t("marketing.audience.accountTypes")}: ${s.accountTypes.map((a) => t(`marketing.audience.accountType.${a}`)).join(", ")}` : null]
                          .filter(Boolean)
                          .join(" · ") || t("marketing.audience.allContacts")}
                  </Td>
                  <Td className="text-end tabular-nums">{s.contactCount}</Td>
                  <Td className="text-end tabular-nums">{s.emailableCount}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </MarketingShell>
  );
}
