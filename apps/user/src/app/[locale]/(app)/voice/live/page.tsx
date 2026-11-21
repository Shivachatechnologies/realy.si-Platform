import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { voicePage } from "@/components/voice/context";
import { LiveCallCenter, type LiveBoardData } from "@/components/voice/live";
import { getT } from "@/i18n/server";
import { liveBoard } from "@/server/modules/voice/live";
import { voiceOverview } from "@/server/modules/voice/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("voice.tabs.live") };
}

/** Live call center: active / incoming / outgoing calls with streaming transcripts and provider-backed controls. */
export default async function VoiceLivePage() {
  const p = await voicePage("live", { title: undefined });
  if (p.gate) return p.gate;
  const { t, locale, viewer, org, company, tz, base, perms, wrap } = p;
  const [board, overview] = await Promise.all([liveBoard(viewer.ctx, org.id, company.id), voiceOverview(viewer.ctx, org.id, company.id)]);
  const initial = JSON.parse(JSON.stringify(board, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as LiveBoardData;
  return wrap(
    <div className="grid gap-4">
      {!overview.providerConnected && board.rules.telephony !== "TWILIO" ? (
        <Notice tone="warning" title={t("voice.live2.setupTitle")} action={<Link href={`/${locale}/voice/setup`} className="text-sm font-medium text-primary hover:underline">{t("voice.live2.setupAction")}</Link>}>
          {t("voice.live2.setupBody")}
        </Notice>
      ) : null}
      <LiveCallCenter base={base} locale={locale} tz={tz} initial={initial} canPost={perms.post} />
    </div>,
  );
}
