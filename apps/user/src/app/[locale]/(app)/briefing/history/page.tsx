import type { Metadata } from "next";
import Link from "next/link";
import { History, Mail, MessageCircle, MonitorSmartphone } from "lucide-react";
import { BriefingTabs } from "@/components/briefing/briefing-tabs";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate, formatDateTime } from "@/i18n/format";
import { getLocale, getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { db } from "@/server/core/db";
import { listReports } from "@/server/modules/briefing/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("briefing.tabs.history") };
}

const KINDS = ["MORNING", "EVENING", "WEEKLY", "TEST"] as const;
const ICON = { IN_APP: MonitorSmartphone, EMAIL: Mail, WHATSAPP: MessageCircle } as const;

export default async function BriefingHistoryPage({ searchParams }: PageProps<"/[locale]/briefing/history">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = await searchParams;
  const header = (
    <PageHeader variant="editorial" world="command" eyebrow={t("briefing.eyebrow")} title={t("briefing.history.title")} description={t("briefing.history.subtitle")} illustration={false}>
      <BriefingTabs locale={locale} active="history" />
    </PageHeader>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1100px] gap-6">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "analytics.read", chain))) {
    return (
      <div className="mx-auto grid max-w-[1100px] gap-6">
        {header}
        <Notice tone="warning">{t("briefing.forbidden")}</Notice>
      </div>
    );
  }
  const kind = typeof sp.kind === "string" && (KINDS as readonly string[]).includes(sp.kind) ? sp.kind : undefined;
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const page = await listReports(viewer.ctx, org.id, company.id, { kind, cursor, limit: 25 });
  const tz = viewer.user.timezone;
  const path = `/${locale}/briefing/history`;
  const chip = (label: string, value: string | undefined) => (
    <Link key={label} href={value ? `${path}?kind=${value}` : path} aria-current={kind === value ? "true" : undefined} className={cn("rounded-full border px-3 py-1 text-xs", kind === value ? "border-primary bg-accent font-medium" : "hover:bg-muted")}>
      {label}
    </Link>
  );
  return (
    <div className="mx-auto grid max-w-[1100px] gap-6">
      {header}
      <div className="flex flex-wrap gap-1.5">
        {chip(t("common.all"), undefined)}
        {KINDS.map((k) => chip(t(`briefing.kinds.${k}`), k))}
      </div>
      {page.data.length ? (
        <ol className="grid gap-2">
          {page.data.map((r) => (
            <li key={r.id}>
              <Link href={`/${locale}/briefing/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3 hover-lift">
                <div className="min-w-0">
                  <p className="font-display text-lg">{t(`briefing.kinds.${r.kind}`)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(`${r.localDate}T12:00:00Z`, locale, "UTC", { dateStyle: "full" })} · {formatDateTime(r.createdAt, locale, tz)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.channels.map((c) => {
                    const Icon = ICON[c];
                    return (
                      <Badge key={c} tone="success" shape="pill">
                        <Icon className="size-3" aria-hidden />
                        {t(`briefing.channels.${c}`)}
                      </Badge>
                    );
                  })}
                  <Badge tone={r.status === "DELIVERED" ? "success" : r.status === "SUMMARIZING" ? "info" : "warning"}>{t(`briefing.status.${r.status}`)}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <Card>
          <SmartEmpty
            icon={<History />}
            title={t("briefing.history.empty")}
            body={t("briefing.history.emptyHint")}
            primary={
              <Button asChild size="sm">
                <Link href={`/${locale}/briefing`}>{t("briefing.history.goToday")}</Link>
              </Button>
            }
          />
        </Card>
      )}
      {page.nextCursor ? (
        <Link href={`${path}?${new URLSearchParams({ ...(kind ? { kind } : {}), cursor: page.nextCursor })}`} className="justify-self-center text-sm text-primary hover:underline">
          {t("briefing.history.older")}
        </Link>
      ) : null}
    </div>
  );
}
