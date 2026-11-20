import type { Metadata } from "next";
import { ChannelView } from "@/components/comms/channel-view";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.messages.title") };
}

export default async function DirectMessagePage({ params, searchParams }: PageProps<"/[locale]/communication/messages/[channelId]">) {
  const { channelId } = await params;
  const p = await areaPage("communication", "messages");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  return wrap(
    <ChannelView ctx={viewer.ctx} t={t} locale={locale} tz={tz} base={base} organizationId={org.id} companyId={company.id} channelId={channelId} me={viewer.user.id} canManage={perms.manage} kind="messages" sp={await searchParams} />,
  );
}
