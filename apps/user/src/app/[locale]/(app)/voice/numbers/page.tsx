import type { Metadata } from "next";
import Link from "next/link";
import { Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/comms/bits";
import { voicePage } from "@/components/voice/context";
import { AssignNumber, GetNumber, VoiceAction } from "@/components/voice/client";
import { getT } from "@/i18n/server";
import { listPhoneNumbers } from "@/server/modules/voice/numbers";
import { listAgents } from "@/server/modules/voice/agents";
import { voiceOverview } from "@/server/modules/voice/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.tabs.numbers") };
}

export default async function VoiceNumbersPage() {
  const p = await voicePage("numbers");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, base, perms, wrap } = p;
  const [numbers, agents, o] = await Promise.all([listPhoneNumbers(viewer.ctx, org.id, company.id), listAgents(viewer.ctx, org.id, company.id), voiceOverview(viewer.ctx, org.id, company.id)]);
  const provider = o.settings.provider;
  const providerKey = provider === "VAPI" ? "vapi" : provider === "RETELL" ? "retell" : null;
  return wrap(
    <div className="grid gap-4">
      {provider && !o.providerConnected ? (
        <Notice tone="warning" action={perms.integrations && providerKey ? <Link href={`/${locale}/integrations/${providerKey}`} className="text-sm font-medium text-primary hover:underline">{t("voice.setup.connect")}</Link> : undefined}>
          {t("voice.credentialRequired", { provider: t(`voice.providers.${providerKey}.name`) })}
        </Notice>
      ) : null}
      <Card>
        <CardHeader
          icon={<Phone />}
          title={t("voice.numbers.title")}
          description={t("voice.numbers.description")}
          actions={perms.manage && provider && o.providerConnected ? <VoiceAction path={`${base}/voice/numbers/sync`} label={t("voice.numbers.sync")} icon="sync" done={t("voice.numbers.synced")} /> : undefined}
        />
        <CardBody className="p-0">
          {numbers.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("voice.numbers.number")}</Th>
                  <Th className="hidden sm:table-cell">{t("voice.numbers.source")}</Th>
                  <Th>{t("voice.numbers.inboundAgent")}</Th>
                  <Th className="hidden md:table-cell">{t("voice.numbers.calls")}</Th>
                </Tr>
              </THead>
              <TBody>
                {numbers.map((n) => (
                  <Tr key={n.id}>
                    <Td>
                      <span className="grid gap-0.5">
                        <span className="font-mono">{n.number}</span>
                        {n.label ? <span className="text-xs text-muted-foreground">{n.label}</span> : null}
                      </span>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <Badge>{t(`voice.numbers.sources.${n.source}`)}</Badge> <span className="text-xs text-muted-foreground">{t(`voice.providers.${n.provider === "VAPI" ? "vapi" : "retell"}.name`)}</span>
                    </Td>
                    <Td className="min-w-48">
                      {perms.manage ? (
                        <AssignNumber base={base} numberId={n.id} current={n.inboundAgentId} agents={agents.filter((a) => a.provider === n.provider && a.syncStatus === "SYNCED").map((a) => ({ id: a.id, name: a.name }))} />
                      ) : (
                        (n.inboundAgent?.name ?? t("voice.numbers.noInbound"))
                      )}
                    </Td>
                    <Td className="hidden tabular-nums md:table-cell">{n._count.calls}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState>{t("voice.numbers.empty")}</EmptyState>
            </div>
          )}
        </CardBody>
      </Card>
      {perms.manage && provider && o.providerConnected ? (
        <Card>
          <CardHeader title={t("voice.numbers.get")} description={t(provider === "VAPI" ? "voice.numbers.getHintVapi" : "voice.numbers.getHintRetell")} />
          <CardBody>
            <GetNumber base={base} locale={locale} provider={provider} twilioConnected={o.connections.twilio === "connected"} />
          </CardBody>
        </Card>
      ) : !provider ? (
        <Notice tone="info" action={<Link href={`/${locale}/voice/setup`} className="text-sm font-medium text-primary hover:underline">{t("voice.setup.continue")}</Link>}>{t("voice.setup.pickProviderFirst")}</Notice>
      ) : null}
    </div>,
  );
}
