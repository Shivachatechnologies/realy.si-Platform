import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { JarvisConsole } from "@/components/jarvis/jarvis-console";
import { getLocale, getT } from "@/i18n/server";
import { requireOrgContext } from "@/server/workspace";
import { recentCompanyEvents } from "@/server/modules/voiceos/stream";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("jarvis.title") };
}

/**
 * Realy — the voice console: talk to your company. The AI Core, the live company event stream and the active
 * command runs; every utterance becomes a real AI Command run.
 */
export default async function RealyPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) {
    return (
      <Card className="mx-auto max-w-xl p-6 text-sm text-muted-foreground">
        {t("guide.noCompany")}{" "}
        <Link href={`/${locale}/onboarding`} className="font-medium text-primary hover:underline">
          {t("guide.noCompanyAction")}
        </Link>
      </Card>
    );
  }
  // The stream requires companies.read; a viewer without it gets the standard forbidden page from the service.
  const initialEvents = await recentCompanyEvents(viewer.ctx, org.id, company.id, 30);
  return (
    <div className="mx-auto max-w-[1600px]">
      <JarvisConsole base={`/api/v1/organizations/${org.id}/companies/${company.id}`} companyName={company.name} initialEvents={initialEvents} />
    </div>
  );
}
