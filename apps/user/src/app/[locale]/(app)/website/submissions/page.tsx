import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Pager } from "@/components/comms/bits";
import { sitesPage } from "@/components/sites/context";
import { SubmissionStatus } from "@/components/sites/site-actions";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { listSubmissions } from "@/server/modules/sites/forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("sites.tabs.submissions")} · ${t("sites.title")}` };
}

const FILTERS = ["inbox", "NEW", "READ", "ARCHIVED"] as const;

/** /website/submissions — contact form submissions (each with consent, linked to the CRM lead it created). */
export default async function SiteSubmissionsPage({ searchParams }: PageProps<"/[locale]/website/submissions">) {
  const sp = await searchParams;
  const p = await sitesPage("submissions");
  if (p.gate) return p.gate;
  const { org, company, viewer, locale, t, perms, base, site, tz, wrap } = p;
  if (!site) redirect(`/${locale}/website`);
  const list = await listSubmissions(viewer.ctx, org.id, company.id, { status: sp.status, page: sp.page });
  const path = `/${locale}/website/submissions`;
  const href = (o: { status?: string | null; page?: number }) => {
    const q = new URLSearchParams();
    const status = o.status === undefined ? list.status : o.status;
    if (status) q.set("status", status);
    if (o.page && o.page > 1) q.set("page", String(o.page));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  return wrap(
    <Card>
      <nav className="flex gap-1 overflow-x-auto border-b p-3" aria-label={t("sites.inbox.filters")}>
        {FILTERS.map((f) => {
          const status = f === "inbox" ? null : f;
          const active = (list.status ?? null) === status;
          return (
            <Link key={f} href={href({ status, page: 1 })} aria-current={active ? "page" : undefined} className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
              {t(`sites.inbox.filter.${f}`)}
              {status ? <span className="text-xs text-muted-foreground">{list.counts[status]}</span> : null}
            </Link>
          );
        })}
      </nav>
      {list.data.length ? (
        <ul className="divide-y">
          {list.data.map((s) => (
            <li key={s.id} className="grid gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name ?? s.email ?? t("sites.inbox.anonymous")}</span>
                {s.status === "NEW" ? <Badge tone="info">{t("sites.inbox.new")}</Badge> : null}
                {s.email ? (
                  <a href={`mailto:${s.email}`} className="text-sm text-primary hover:underline">
                    {s.email}
                  </a>
                ) : null}
                {s.phone ? <span className="text-sm text-muted-foreground">{s.phone}</span> : null}
                {s.account ? <span className="text-sm text-muted-foreground">· {s.account}</span> : null}
                <span className="ms-auto text-xs text-muted-foreground">{formatDateTime(s.createdAt, locale, tz)}</span>
              </div>
              {s.message ? <p className="whitespace-pre-wrap text-sm">{s.message}</p> : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="font-mono">/{s.pagePath}</span>
                <span>{t("sites.inbox.consented", { when: formatDateTime(s.consentAt, locale, tz) })}</span>
                {s.utmCampaign ? <span>utm: {s.utmCampaign}</span> : null}
                {s.leadId ? (
                  <Link href={`/${locale}/crm/${s.leadId}`} className="text-primary hover:underline">
                    {t("sites.inbox.openLead")}
                  </Link>
                ) : (
                  <span className="text-warning">{t("sites.inbox.noLead")}</span>
                )}
                <div className="ms-auto">
                  <SubmissionStatus base={base} id={s.id} status={s.status} canManage={perms.manage} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-6 text-sm text-muted-foreground">{t("sites.inbox.empty")}</p>
      )}
      {pages > 1 ? (
        <div className="border-t p-3">
          <Pager prevHref={list.page > 1 ? href({ page: list.page - 1 }) : null} nextHref={list.page < pages ? href({ page: list.page + 1 }) : null} labels={{ prev: t("common.previous"), next: t("common.next") }} info={`${list.page} / ${pages}`} />
        </div>
      ) : null}
    </Card>,
  );
}
