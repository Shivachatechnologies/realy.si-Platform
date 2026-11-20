import Link from "next/link";
import { FileText, Globe2, Image as ImageIcon, LayoutTemplate, Newspaper, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, QuickFilters, SectionLink, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { NewEntryButton } from "@/components/admin/cms-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { listEntries } from "@/server/modules/cms/service";
import { requireViewer } from "@/server/session";

const KIND_ICON = { PAGE: <FileText className="size-3.5" />, POST: <Newspaper className="size-3.5" />, LANDING: <LayoutTemplate className="size-3.5" /> };
const STATUS_TONE = { DRAFT: "warning", SCHEDULED: "info", PUBLISHED: "success", ARCHIVED: "neutral" } as const;

/** Content: pages, blog posts and landing pages of the public website (locale variants, versions, scheduling). */
export default async function AdminCmsPage({ searchParams }: PageProps<"/[locale]/cms">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { kind: sp(q.kind), status: sp(q.status), q: sp(q.q) };
  const r = await guard(Promise.all([listEntries(viewer.ctx, params), canPlatform(viewer.ctx, "platform.content.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, canManage] = r.value;
  const base = `/${locale}/cms`;
  const count = (pred: (c: (typeof o.counts)[number]) => boolean) => o.counts.filter(pred).reduce((a, c) => a + c.count, 0);
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Globe2 />}
        title={t("admin.nav.cms")}
        description={t("admin.cms.subtitle")}
        why={t("admin.cms.why")}
        actions={
          <>
            <SectionLink href={`${base}/media`}>{t("admin.nav.media")}</SectionLink>
            {canManage ? <NewEntryButton defaultKind={(params.kind as "PAGE" | "POST" | "LANDING" | undefined) ?? "PAGE"} /> : null}
          </>
        }
      />
      <StatGrid>
        {(["PAGE", "POST", "LANDING"] as const).map((k) => (
          <StatTile key={k} icon={KIND_ICON[k]} label={t(`admin.cms.kindsPlural.${k}`)} value={count((c) => c.kind === k && c.status !== "ARCHIVED")} href={`${base}?kind=${k}`} />
        ))}
        <StatTile icon={<Rocket />} label={t("admin.cms.status.PUBLISHED")} value={count((c) => c.status === "PUBLISHED")} hint={t("admin.cms.scheduledCount", { count: count((c) => c.status === "SCHEDULED") })} href={`${base}?status=PUBLISHED`} tone="success" />
      </StatGrid>
      <Card>
        <QuickFilters
          base={base}
          name="kind"
          value={params.kind}
          params={params}
          label={t("admin.cms.kind")}
          options={[{ value: "", label: t("admin.common.all") }, ...(["PAGE", "POST", "LANDING"] as const).map((k) => ({ value: k, label: t(`admin.cms.kindsPlural.${k}`) }))]}
        />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.cms.searchSlug")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[{ name: "status", label: t("admin.users.filters.status"), options: (["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const).map((s) => ({ value: s, label: t(`admin.cms.status.${s}`) })) }]}
          extra={params.kind ? <input type="hidden" name="kind" value={params.kind} /> : undefined}
        />
        {o.entries.length === 0 ? (
          <EmptyState icon={<FileText />} title={t("admin.cms.empty")} body={t("admin.cms.emptyHint")} action={canManage ? <NewEntryButton /> : undefined} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.cms.fields.pageTitle")}</Th>
                <Th>{t("admin.cms.kind")}</Th>
                <Th>{t("admin.cms.locales")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th>{t("admin.cms.updated")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.entries.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <Link href={`${base}/${e.id}`} className="font-medium hover:underline">
                      {e.title || e.slug}
                    </Link>
                    <div className="font-mono text-[11px] text-muted-foreground">/pages/{e.slug}</div>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      {KIND_ICON[e.kind]}
                      {t(`admin.cms.kinds.${e.kind}`)}
                    </span>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {e.locales.map((l) => (
                        <span key={l} className="rounded-sm border px-1 font-mono text-[10px] text-muted-foreground">
                          {l.slice(0, 2)}
                        </span>
                      ))}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[e.status]}>{t(`admin.cms.status.${e.status}`)}</Badge>
                    {e.hasUnpublished ? <div className="text-[11px] text-warning">{t("admin.cms.unpublishedChanges")}</div> : null}
                  </Td>
                  <Td className="text-xs text-muted-foreground">{formatRelativeTime(e.updatedAt, locale)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ImageIcon className="size-3.5" aria-hidden />
        {t("admin.cms.footerHint")}
      </p>
    </div>
  );
}
