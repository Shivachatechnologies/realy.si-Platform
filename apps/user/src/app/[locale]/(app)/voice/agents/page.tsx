import type { Metadata } from "next";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { EmptyState } from "@/components/comms/bits";
import { voicePage } from "@/components/voice/context";
import { AgentForm } from "@/components/voice/client";
import { getT } from "@/i18n/server";
import { employeeOptions, listAgents } from "@/server/modules/voice/agents";
import { voiceOverview } from "@/server/modules/voice/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.tabs.agents") };
}

export default async function VoiceAgentsPage() {
  const p = await voicePage("agents");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, base, perms, wrap } = p;
  const [agents, employees, o] = await Promise.all([listAgents(viewer.ctx, org.id, company.id), employeeOptions(viewer.ctx, org.id, company.id), voiceOverview(viewer.ctx, org.id, company.id)]);
  return wrap(
    <div className="grid gap-4">
      {agents.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Link key={a.id} href={`/${locale}/voice/agents/${a.id}`} className="block">
              <Card interactive className="h-full">
                <CardBody className="grid gap-3">
                  <div className="flex items-center gap-3">
                    <AiAvatar seed={a.employee?.id ?? a.id} department={a.goal === "SUPPORT_TRIAGE" || a.goal === "RECEPTIONIST" ? "support" : "sales"} size={40} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.employee ? a.employee.name : t("voice.agents.noEmployee")}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone="accent">{t(`voice.goals.${a.goal}.label`)}</Badge>
                    <Badge>{t(`voice.languages.${a.language}`)}</Badge>
                    <Badge tone={a.syncStatus === "SYNCED" ? "success" : a.syncStatus === "ERROR" ? "danger" : "warning"}>{t(`voice.sync.${a.syncStatus}`)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("voice.agents.stats", { calls: a._count.calls, numbers: a.numbers.length })}
                  </p>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState>{t("voice.agents.empty")}</EmptyState>
      )}
      {perms.manage ? (
        <Card>
          <CardHeader icon={<Bot />} title={t("voice.agents.new")} description={t("voice.agents.newHint")} />
          <CardBody>{o.settings.provider ? <AgentForm base={base} locale={locale} employees={employees} /> : <Notice tone="info">{t("voice.setup.pickProviderFirst")}</Notice>}</CardBody>
        </Card>
      ) : null}
    </div>,
  );
}
