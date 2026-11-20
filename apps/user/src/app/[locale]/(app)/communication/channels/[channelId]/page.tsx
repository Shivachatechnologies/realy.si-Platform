import type { Metadata } from "next";
import { ChannelView } from "@/components/comms/channel-view";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.channels.title") };
}

export default async function ChannelPage({ params, searchParams }: PageProps<"/[locale]/communication/channels/[channelId]">) {
  const { channelId } = await params;
  const p = await areaPage("communication", "channels");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  return wrap(
    <ChannelView ctx={viewer.ctx} t={t} locale={locale} tz={tz} base={base} organizationId={org.id} companyId={company.id} channelId={channelId} me={viewer.user.id} canManage={perms.manage} kind="channels" sp={await searchParams} />,
  );
}
