import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/comms/bits";
import { voicePage } from "@/components/voice/context";
import { DncForm, ProviderPicker, SettingsForm, VoiceAction } from "@/components/voice/client";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listDoNotCall, voiceOverview } from "@/server/modules/voice/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.tabs.settings") };
}

export default async function VoiceSettingsPage() {
  const p = await voicePage("settings");
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  const [o, dnc, members] = await Promise.all([
    voiceOverview(viewer.ctx, org.id, company.id),
    listDoNotCall(viewer.ctx, org.id, company.id),
    db().membership.findMany({ where: { organizationId: org.id, status: "ACTIVE" }, select: { user: { select: { id: true, name: true } } }, take: 200 }),
  ]);
  return wrap(
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={t("voice.settings.platform")} description={t("voice.settings.platformHint")} />
          <CardBody>
            <ProviderPicker base={base} current={o.settings.provider} states={{ vapi: o.connections.vapi, retell: o.connections.retell }} locale={locale} canManage={perms.manage} canConnect={perms.integrations} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("voice.settings.rules")} description={t("voice.settings.rulesHint")} />
          <CardBody>
            <SettingsForm base={base} value={o.settings} members={members.map((m) => ({ id: m.user.id, name: m.user.name }))} canManage={perms.manage} />
          </CardBody>
        </Card>
      </div>
      <Card className="content-start">
        <CardHeader title={t("voice.dnc.title")} description={t("voice.dnc.description")} />
        <CardBody className="grid gap-4">
          {perms.manage ? <DncForm base={base} /> : null}
          {dnc.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>{t("voice.dnc.phone")}</Th>
                  <Th>{t("voice.dnc.source")}</Th>
                  <Th className="hidden sm:table-cell">{t("voice.dnc.added")}</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {dnc.map((d) => (
                  <Tr key={d.id}>
                    <Td>
                      <span className="grid">
                        <span className="font-mono">{d.phone}</span>
                        {d.reason ? <span className="text-xs text-muted-foreground">{d.reason}</span> : null}
                      </span>
                    </Td>
                    <Td><Badge tone={d.source === "CALLER_REQUEST" ? "warning" : "neutral"}>{t(`voice.dnc.sources.${d.source}`)}</Badge></Td>
                    <Td className="hidden text-xs text-muted-foreground sm:table-cell">{formatDateTime(d.createdAt, locale, tz)}</Td>
                    <Td className="text-end">{perms.manage ? <VoiceAction path={`${base}/voice/dnc/${d.id}`} method="DELETE" label={t("voice.dnc.remove")} confirm={t(d.source === "CALLER_REQUEST" ? "voice.dnc.removeCallerConfirm" : "voice.dnc.removeConfirm")} variant="ghost" /> : null}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState>{t("voice.dnc.empty")}</EmptyState>
          )}
        </CardBody>
      </Card>
    </div>,
  );
}
