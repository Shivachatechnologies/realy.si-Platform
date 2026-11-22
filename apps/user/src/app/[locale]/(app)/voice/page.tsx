import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleCheck, Circle, PhoneCall } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/comms/bits";
import { voicePage } from "@/components/voice/context";
import { CallsTable } from "@/components/voice/calls-table";
import { ManualCallForm } from "@/components/voice/client";
import { getT } from "@/i18n/server";
import { voiceOverview } from "@/server/modules/voice/service";
import { voiceAnalytics } from "@/server/modules/voice/analytics";
import { listCalls } from "@/server/modules/voice/calls";
import { listAgents } from "@/server/modules/voice/agents";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.title") };
}

export default async function VoiceOverviewPage() {
  const p = await voicePage("overview");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  const [overview, stats, live, recent, agents] = await Promise.all([
    voiceOverview(viewer.ctx, org.id, company.id),
    voiceAnalytics(viewer.ctx, org.id, company.id, 30),
    listCalls(viewer.ctx, org.id, company.id, { view: "live" }),
    listCalls(viewer.ctx, org.id, company.id, { view: "all" }),
    listAgents(viewer.ctx, org.id, company.id),
  ]);
  const steps = (["provider", "rules", "agent", "number", "inbound"] as const).map((k) => ({ key: k, done: overview.steps[k] }));
  const done = steps.filter((s) => s.done).length;
  const outbound = agents.filter((a) => a.syncStatus === "SYNCED" && a.goal !== "RECEPTIONIST");
  const meetings = stats.outcomes.find((o) => o.key === "MEETING_BOOKED")?.count ?? 0;
  return wrap(
    <>
      {done < steps.length ? (
        <Card variant="default">
          <CardHeader title={t("voice.setup.cardTitle")} description={t("voice.setup.cardBody", { done, total: steps.length })} actions={<Link href={`/${locale}/voice/setup`} className={buttonVariants({ size: "sm" })}>{t("voice.setup.continue")} <ArrowRight aria-hidden className="rtl:rotate-180" /></Link>} />
          <CardBody>
            <ol className="grid gap-2 sm:grid-cols-5">
              {steps.map((s, i) => (
                <li key={s.key} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", s.done ? "border-success/30" : "")}>
                  {s.done ? <CircleCheck aria-hidden className="size-4 text-success" /> : <Circle aria-hidden className="size-4 text-muted-foreground" />}
                  <span className={s.done ? "" : "text-muted-foreground"}>
                    {i + 1}. {t(`voice.setup.steps.${s.key}.title`)}
                  </span>
                  <span className="sr-only">{s.done ? t("voice.setup.done") : t("voice.setup.todo")}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}
      {overview.settings.provider && !overview.providerConnected ? (
        <Notice tone="warning">
          {t("voice.credentialRequired", { provider: t(`voice.providers.${overview.settings.provider === "VAPI" ? "vapi" : "retell"}.name`) })}
        </Notice>
      ) : null}
      <StatGrid>
        <StatTile index={0} label={t("voice.stats.calls")} value={stats.total - stats.awaitingApproval} hint={t("voice.stats.last30")} />
        <StatTile index={1} label={t("voice.stats.connected")} value={stats.connected} hint={stats.connectRate !== null ? t("voice.stats.connectRate", { rate: stats.connectRate }) : t("voice.stats.noOutbound")} />
        <StatTile index={2} label={t("voice.stats.meetings")} value={meetings} href={`/${locale}/voice/calls?outcome=MEETING_BOOKED`} />
        <StatTile index={3} label={t("voice.stats.awaiting")} value={stats.awaitingApproval} href={`/${locale}/approvals`} highlight={stats.awaitingApproval > 0} />
      </StatGrid>
      <Card>
        <CardHeader icon={<PhoneCall />} title={t("voice.live.title")} description={t("voice.live.description")} />
        <CardBody className="p-0">
          {live.rows.length ? <CallsTable rows={live.rows} t={t} locale={locale} tz={tz} /> : <div className="p-4"><EmptyState>{t("voice.live.empty")}</EmptyState></div>}
        </CardBody>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title={t("voice.recent.title")} actions={<Link href={`/${locale}/voice/calls`} className="text-sm font-medium text-primary hover:underline">{t("voice.recent.all")}</Link>} />
          <CardBody className="p-0">
            {recent.rows.length ? <CallsTable rows={recent.rows.slice(0, 8)} t={t} locale={locale} tz={tz} /> : <div className="p-4"><EmptyState>{t("voice.recent.empty")}</EmptyState></div>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("voice.manual.title")} description={t("voice.manual.description")} />
          <CardBody>
            {!perms.post ? (
              <Notice tone="info">{t("voice.manual.forbidden")}</Notice>
            ) : outbound.length ? (
              <ManualCallForm base={base} locale={locale} agents={outbound.map((a) => ({ id: a.id, name: a.name }))} canApprove={perms.approve} />
            ) : (
              <Notice tone="info" action={<Link href={`/${locale}/voice/setup`} className="text-sm font-medium text-primary hover:underline">{t("voice.setup.continue")}</Link>}>
                {t("voice.manual.noAgent")}
              </Notice>
            )}
          </CardBody>
        </Card>
      </div>
    </>,
  );
}
