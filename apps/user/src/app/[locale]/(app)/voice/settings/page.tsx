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
import { CAPABILITIES, CAPABILITY_KEYS, TELEPHONY_KEYS } from "@/server/modules/voice/telephony";
import { TelephonyForm } from "@/components/voice/telephony";

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
            <ProviderPicker base={base} current={o.settings.provider} states={{ vapi: o.connections.vapi, retell: o.connections.retell }} canManage={perms.manage} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("voice.settings.rules")} description={t("voice.settings.rulesHint")} />
          <CardBody>
            <SettingsForm base={base} value={o.settings} members={members.map((m) => ({ id: m.user.id, name: m.user.name }))} canManage={perms.manage} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("voice.telephony.title")} description={t("voice.telephony.description")} />
          <CardBody>
            <TelephonyForm base={base} value={o.settings} canManage={perms.manage} twilioConnected={o.connections.twilio === "connected"} retellSelected={o.settings.provider === "RETELL"} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("voice.telephony.matrix")} description={t("voice.telephony.matrixHint")} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">{t("voice.telephony.matrix")}</caption>
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t("voice.telephony.capability")}</th>
                  {TELEPHONY_KEYS.map((k) => <th key={k} scope="col" className="px-3 py-2 text-start font-medium">{t(`voice.live2.layers.${k}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {CAPABILITY_KEYS.map((c) => (
                  <tr key={c} className="border-b last:border-0">
                    <th scope="row" className="px-4 py-2 text-start font-normal">{t(`voice.telephony.caps.${c}`)}</th>
                    {TELEPHONY_KEYS.map((k) => {
                      const v = CAPABILITIES[k][c];
                      return <td key={k} className="px-3 py-2"><Badge tone={v === "yes" ? "success" : v === "partial" ? "warning" : "neutral"}>{t(`voice.telephony.support.${v}`)}</Badge></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">{t("voice.telephony.matrixNote")}</p>
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
