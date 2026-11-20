import type { Metadata } from "next";
import Link from "next/link";
import { ListingForm, PublisherForm } from "@/components/marketplace/publish-forms";
import { STATUS_TONE } from "@/components/marketplace/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { getMyPublisher, listOwnListings } from "@/server/modules/marketplace/service";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketplace.tabs.publish") };
}

export default async function PublishPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  const chain = orgChain(org.id);
  if (!(await can(viewer.ctx, "marketplace.read", chain))) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
  const [canManage, publisher, listings] = await Promise.all([
    can(viewer.ctx, "organizations.manage", chain),
    getMyPublisher(viewer.ctx, org.id),
    listOwnListings(viewer.ctx, org.id),
  ]);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title={t("marketplace.publish.publisherTitle")}
          description={t("marketplace.publish.publisherHint")}
          actions={
            publisher ? (
              <Link className="text-sm text-primary hover:underline" href={`/${locale}/marketplace/publishers/${publisher.slug}`}>
                {t("marketplace.publish.viewProfile")}
              </Link>
            ) : null
          }
        />
        <CardBody>
          {canManage ? (
            <PublisherForm
              orgId={org.id}
              publisher={
                publisher
                  ? {
                      name: publisher.name,
                      slug: publisher.slug,
                      description: publisher.description,
                      website: publisher.website,
                      logoUrl: publisher.logoUrl,
                    }
                  : null
              }
            />
          ) : publisher ? (
            <p className="text-sm">{publisher.name}</p>
          ) : (
            <Notice tone="info">{t("marketplace.publish.adminsOnly")}</Notice>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("marketplace.publish.listingsTitle")} description={t("marketplace.publish.flow")} />
        {listings.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("marketplace.publish.noListings")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketplace.publish.name")}</Th>
                <Th>{t("marketplace.publish.type")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("marketplace.publish.latest")}</Th>
                <Th>{t("marketplace.publisher.installs")}</Th>
                <Th>{t("marketplace.publish.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {listings.map((l) => (
                <Tr key={l.key}>
                  <Td className="font-medium">
                    <Link href={`/${locale}/marketplace/publish/${l.id}`} className="hover:underline">
                      {l.name}
                    </Link>
                    <div className="font-mono text-xs font-normal text-muted-foreground">{l.key}</div>
                  </Td>
                  <Td>{t(`marketplace.types.${l.type}`)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[l.status]}>{t(`marketplace.statuses.${l.status}`)}</Badge>
                  </Td>
                  <Td className="font-mono text-xs">{l.latestVersion ?? "—"}</Td>
                  <Td className="tabular">{l.installCount}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDate(l.createdAt, locale, viewer.user.timezone)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        {canManage && publisher ? (
          <CardBody className="grid gap-3 border-t">
            <h3 className="font-medium">{t("marketplace.publish.newListing")}</h3>
            <ListingForm orgId={org.id} onCreatedHref="/marketplace/publish" />
          </CardBody>
        ) : null}
        {canManage && !publisher ? <CardBody className="border-t text-sm text-muted-foreground">{t("marketplace.publish.publisherFirst")}</CardBody> : null}
      </Card>
    </div>
  );
}
