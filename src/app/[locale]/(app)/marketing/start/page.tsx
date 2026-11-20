import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell, loadMarketing } from "@/components/marketing/shell";
import { JourneyWizard } from "@/components/marketing/journey-wizard";
import { journeyProps } from "@/components/marketing/journey-data";
import { HelpPanel } from "@/components/marketing/studio";
import { getT } from "@/i18n/server";
import { listHelpTasks } from "@/server/modules/marketing/intelligence";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.start") };
}

export default async function StartHerePage() {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "start" as const, title: t("marketing.studio.journey.title"), subtitle: t("marketing.studio.journey.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const [props, help] = await Promise.all([journeyProps(m), listHelpTasks(m.org.id, m.company.id, "start")]);
  return (
    <MarketingShell {...shell} actions={<Link href={`/${locale}/marketing?view=studio`} className="text-sm text-muted-foreground hover:underline">{t("marketing.studio.journey.skip")}</Link>}>
      <JourneyWizard {...props} />
      <HelpPanel t={t} base={m.base} page="start" tasks={help} locale={locale} tz={m.tz} aiReady={m.aiReady} canRun={m.canRunAgents} context={`Journey step ${props.step}`} />
    </MarketingShell>
  );
}
