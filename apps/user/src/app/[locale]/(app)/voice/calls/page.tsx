import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, hrefWith, Pager } from "@/components/comms/bits";
import { voicePage } from "@/components/voice/context";
import { CallsTable } from "@/components/voice/calls-table";
import { OUTCOMES } from "@/components/voice/bits";
import { getT } from "@/i18n/server";
import { CALL_VIEWS, listCalls, parseCallFilters } from "@/server/modules/voice/calls";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.tabs.calls") };
}

export default async function VoiceCallsPage({ searchParams }: PageProps<"/[locale]/voice/calls">) {
  const p = await voicePage("calls");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, wrap } = p;
  const sp = await searchParams;
  const f = parseCallFilters(sp);
  const list = await listCalls(viewer.ctx, org.id, company.id, f);
  const path = `/${locale}/voice/calls`;
  const current = { view: f.view === "all" ? undefined : f.view, outcome: f.outcome };
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  return wrap(
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 overflow-x-auto" aria-label={t("voice.calls.views")}>
          {CALL_VIEWS.map((v) => (
            <Link key={v} href={hrefWith(path, current, { view: v === "all" ? undefined : v, page: undefined })} aria-current={f.view === v ? "page" : undefined} className={cn("shrink-0 rounded-md px-3 py-1.5 text-sm", f.view === v ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
              {t(`voice.calls.view.${v}`)}
            </Link>
          ))}
        </nav>
        <form action={path} className="flex items-center gap-2">
          {f.view !== "all" ? <input type="hidden" name="view" value={f.view} /> : null}
          <Select name="outcome" defaultValue={f.outcome ?? ""} aria-label={t("voice.calls.outcome")}>
            <option value="">{t("voice.calls.anyOutcome")}</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {t(`voice.outcomes.${o}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="secondary">
            {t("voice.calls.filter")}
          </Button>
        </form>
      </div>
      <Card>
        <CardBody className="p-0">
          {list.rows.length ? <CallsTable rows={list.rows} t={t} locale={locale} tz={tz} /> : <div className="p-4"><EmptyState>{t("voice.calls.empty")}</EmptyState></div>}
        </CardBody>
      </Card>
      <Pager
        prevHref={list.page > 1 ? hrefWith(path, current, { page: String(list.page - 1) }) : null}
        nextHref={list.page < pages ? hrefWith(path, current, { page: String(list.page + 1) }) : null}
        labels={{ prev: t("common.previous"), next: t("common.next") }}
        info={t("voice.calls.pageInfo", { page: list.page, pages, total: list.total })}
      />
    </div>,
  );
}
