import type { Metadata } from "next";
import Link from "next/link";
import { integrationsPage } from "@/components/integrations/frame";
import { SyncTable } from "@/components/integrations/sync-table";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { getT } from "@/i18n/server";
import { PROVIDERS } from "@/server/modules/integrations/catalog";
import { listSyncRuns } from "@/server/modules/integrations/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("integrations.tabs.syncs") };
}

export default async function SyncsPage({ searchParams }: PageProps<"/[locale]/integrations/syncs">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
  const p = await integrationsPage("syncs");
  if (p.page) return p.page;
  const { locale, t, viewer, org, company, tz } = p.ctx;
  const filters = { provider: one(sp.provider), status: one(sp.status), cursor: one(sp.cursor) };
  const page = await listSyncRuns(viewer.ctx, org.id, company.id, filters);
  const syncable = PROVIDERS.filter((x) => x.syncKinds?.length);
  const qs = (cursor: string) => `?${new URLSearchParams({ ...(filters.provider ? { provider: filters.provider } : {}), ...(filters.status ? { status: filters.status } : {}), cursor })}`;
  return p.render(
    <Card>
      <CardHeader title={t("integrations.syncHistory")} description={t("integrations.syncs.help")} />
      <form className="grid gap-2 border-b p-3 sm:grid-cols-[12rem_12rem_auto]" action={`/${locale}/integrations/syncs`}>
        <Select name="provider" defaultValue={filters.provider ?? ""} aria-label={t("integrations.syncs.provider")}>
          <option value="">{t("integrations.syncs.allProviders")}</option>
          {syncable.map((x) => (
            <option key={x.key} value={x.key}>
              {x.name}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("common.status")}>
          <option value="">{t("common.all")}</option>
          {(["SUCCEEDED", "PARTIAL", "FAILED"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`integrations.syncStatus.${s}`)}
            </option>
          ))}
        </Select>
        <div>
          <Button type="submit" variant="secondary">
            {t("integrations.applyFilters")}
          </Button>
        </div>
      </form>
      {page.data.length ? <SyncTable rows={page.data} t={t} locale={locale} tz={tz} showProvider /> : <p className="p-4 text-muted-foreground">{t("integrations.syncs.empty")}</p>}
      {page.nextCursor || filters.cursor ? (
        <div className="flex justify-between gap-2 border-t p-3 text-sm">
          {filters.cursor ? <Link href={`/${locale}/integrations/syncs`} className="hover:underline">{t("integrations.firstPage")}</Link> : <span />}
          {page.nextCursor ? <Link href={`/${locale}/integrations/syncs${qs(page.nextCursor)}`} className="hover:underline">{t("common.next")} →</Link> : null}
        </div>
      ) : null}
    </Card>,
  );
}
