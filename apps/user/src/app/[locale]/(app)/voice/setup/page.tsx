import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { voicePage } from "@/components/voice/context";
import { AgentForm, GetNumber, ProviderPicker, SettingsForm } from "@/components/voice/client";
import { getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { voiceOverview } from "@/server/modules/voice/service";
import { employeeOptions } from "@/server/modules/voice/agents";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.setup.title") };
}

function Step({ n, title, body, done, children, doneLabel }: { n: number; title: string; body: string; done: boolean; children: React.ReactNode; doneLabel: string }) {
  return (
    <Card className={cn(done ? "border-success/30" : "")}>
      <CardHeader
        icon={done ? <CircleCheck /> : <span className="text-[11px] font-semibold">{n}</span>}
        title={title}
        description={body}
        actions={done ? <span className="text-xs font-medium text-success">{doneLabel}</span> : undefined}
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** Guided setup for non-technical founders: platform → calling rules → first agent → number → AI receptionist. */
export default async function VoiceSetupPage() {
  const p = await voicePage("setup", { title: undefined });
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, base, perms, wrap } = p;
  const o = await voiceOverview(viewer.ctx, org.id, company.id);
  const [employees, members, agents] = await Promise.all([
    employeeOptions(viewer.ctx, org.id, company.id),
    db().membership.findMany({ where: { organizationId: org.id, status: "ACTIVE" }, select: { user: { select: { id: true, name: true } } }, take: 200 }),
    db().voiceAgent.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null }, select: { id: true, name: true, syncStatus: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const s = o.settings;
  const providerKey = s.provider === "VAPI" ? "vapi" : s.provider === "RETELL" ? "retell" : null;
  const doneLabel = t("voice.setup.done");
  return wrap(
    <div className="grid gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("voice.setup.intro")}</p>
      {!perms.manage ? <Notice tone="info">{t("voice.setup.readOnly")}</Notice> : null}
      <Step n={1} title={t("voice.setup.steps.provider.title")} body={t("voice.setup.steps.provider.body")} done={o.steps.provider} doneLabel={doneLabel}>
        <ProviderPicker base={base} current={s.provider} states={{ vapi: o.connections.vapi, retell: o.connections.retell }} canManage={perms.manage} />
      </Step>
      <Step n={2} title={t("voice.setup.steps.rules.title")} body={t("voice.setup.steps.rules.body")} done={o.steps.rules} doneLabel={doneLabel}>
        <SettingsForm base={base} value={s} members={members.map((m) => ({ id: m.user.id, name: m.user.name }))} completeSetup canManage={perms.manage} />
      </Step>
      <Step n={3} title={t("voice.setup.steps.agent.title")} body={t("voice.setup.steps.agent.body")} done={o.steps.agent} doneLabel={doneLabel}>
        {!s.provider ? (
          <Notice tone="info">{t("voice.setup.pickProviderFirst")}</Notice>
        ) : agents.length ? (
          <ul className="grid gap-2">
            {agents.map((a) => (
              <li key={a.id}>
                <Link href={`/${locale}/voice/agents/${a.id}`} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                  <span className="font-medium">{a.name}</span>
                  <span className={a.syncStatus === "SYNCED" ? "text-xs text-success" : "text-xs text-warning"}>{t(`voice.sync.${a.syncStatus}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : perms.manage ? (
          <AgentForm base={base} locale={locale} employees={employees} />
        ) : null}
      </Step>
      <Step n={4} title={t("voice.setup.steps.number.title")} body={t("voice.setup.steps.number.body")} done={o.steps.number} doneLabel={doneLabel}>
        {!s.provider || !o.providerConnected ? (
          <Notice tone="info">{t("voice.setup.connectFirst")}</Notice>
        ) : o.counts.numbers ? (
          <Link href={`/${locale}/voice/numbers`} className="text-sm font-medium text-primary hover:underline">{t("voice.setup.manageNumbers", { count: o.counts.numbers })}</Link>
        ) : perms.manage ? (
          <GetNumber base={base} locale={locale} provider={s.provider} twilioConnected={o.connections.twilio === "connected"} />
        ) : null}
      </Step>
      <Step n={5} title={t("voice.setup.steps.inbound.title")} body={t("voice.setup.steps.inbound.body")} done={o.steps.inbound} doneLabel={doneLabel}>
        <Link href={`/${locale}/voice/numbers`} className="text-sm font-medium text-primary hover:underline">{t("voice.setup.routeInbound")}</Link>
        {providerKey && s.webhookUrl ? <p className="mt-3 text-xs text-muted-foreground">{t("voice.setup.webhookNote")}</p> : null}
      </Step>
    </div>,
  );
}
