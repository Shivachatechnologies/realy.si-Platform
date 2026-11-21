import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { sitesPage } from "@/components/sites/context";
import { DeletePageButton, GenerateWebsite, NewPageDialog } from "@/components/sites/site-actions";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { redirect } from "next/navigation";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { listPages } from "@/server/modules/sites/service";
import { sitePath } from "@/server/modules/sites/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("sites.tabs.pages")} · ${t("sites.title")}` };
}

/** /website/pages — every page and landing page with its status; create, edit, delete. */
export default async function SitePagesPage() {
  const p = await sitesPage("pages");
  if (p.gate) return p.gate;
  const { org, company, viewer, locale, t, perms, base, site, tz, wrap } = p;
  if (!site) redirect(`/${locale}/website`);
  const { data: pages } = await listPages(viewer.ctx, org.id, company.id);
  const aiDisabled = !aiConfigured() ? t("sites.setup.aiMissing") : !perms.runAi || !perms.manage ? t("sites.setup.aiNoPermission") : null;
  const groups = [
    { kind: "PAGE" as const, rows: pages.filter((x) => x.kind === "PAGE") },
    { kind: "LANDING" as const, rows: pages.filter((x) => x.kind === "LANDING") },
  ];
  return wrap(
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <GenerateWebsite base={base} disabledReason={aiDisabled} compact />
        <NewPageDialog base={base} pages={pages.map((x) => ({ id: x.id, title: x.title }))} canManage={perms.manage} />
      </div>
      {groups.map((g) => (
        <Card key={g.kind}>
          <CardHeader title={t(`sites.pages.group.${g.kind}`)} description={t(`sites.kindHints.${g.kind}`)} />
          {g.rows.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("sites.pages.colPage")}</Th>
                  <Th>{t("sites.pages.colStatus")}</Th>
                  <Th className="hidden md:table-cell">{t("sites.pages.colUpdated")}</Th>
                  <Th>
                    <span className="sr-only">{t("sites.pages.colActions")}</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {g.rows.map((pg) => (
                  <Tr key={pg.id}>
                    <Td>
                      <Link href={`/${locale}/website/pages/${pg.id}`} className="grid min-w-0 hover:underline">
                        <span className="truncate font-medium">{pg.title}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">/{pg.slug}</span>
                      </Link>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={pg.status === "PUBLISHED" ? "success" : pg.status === "SCHEDULED" ? "info" : "neutral"}>{t(`sites.pageStatus.${pg.status}`)}</Badge>
                        {pg.hasUnpublished ? <Badge tone="warning">{t("sites.pages.unpublishedChanges")}</Badge> : null}
                        {pg.aiDrafted ? <Badge tone="brand">{t("sites.pages.aiDraft")}</Badge> : null}
                        {pg.status === "SCHEDULED" && pg.publishAt ? <span className="text-xs text-muted-foreground">{formatDateTime(pg.publishAt, locale, tz)}</span> : null}
                      </div>
                    </Td>
                    <Td className="hidden text-xs text-muted-foreground md:table-cell">{formatDateTime(pg.updatedAt, locale, tz)}</Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        {pg.status === "PUBLISHED" && site.online ? (
                          <Link href={sitePath(site.slug, pg.slug)} target="_blank" rel="noreferrer" aria-label={t("sites.pages.view", { title: pg.title })} className={buttonVariants({ size: "icon", variant: "ghost" })}>
                            <ExternalLink aria-hidden />
                          </Link>
                        ) : null}
                        <Link href={`/${locale}/website/pages/${pg.id}`} aria-label={t("sites.pages.edit", { title: pg.title })} className={buttonVariants({ size: "icon", variant: "ghost" })}>
                          <Pencil aria-hidden />
                        </Link>
                        <DeletePageButton base={base} pageId={pg.id} title={pg.title} canManage={perms.manage} />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t(`sites.pages.emptyGroup.${g.kind}`)}</p>
          )}
        </Card>
      ))}
    </>,
  );
}
