import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { verifyUnsubscribeToken } from "@/server/modules/marketing/tracking";
import { db } from "@/server/core/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.unsubscribe.title"), robots: { index: false } };
}

/** Public confirmation page after a one-click unsubscribe (/api/public/unsubscribe redirects here). */
export default async function UnsubscribePage({ searchParams }: PageProps<"/[locale]/unsubscribe">) {
  const t = await getT();
  const sp = await searchParams;
  const status = sp.status === "done" ? "done" : "invalid";
  const payload = status === "done" ? verifyUnsubscribeToken(typeof sp.token === "string" ? sp.token : null) : null;
  const company = payload ? await db().company.findFirst({ where: { id: payload.c, organizationId: payload.o }, select: { name: true } }) : null;
  const ok = status === "done" && !!payload;
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-md content-center gap-3 px-4 py-10 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{ok ? t("marketing.unsubscribe.doneTitle") : t("marketing.unsubscribe.invalidTitle")}</h1>
      <p className="text-muted-foreground">{ok ? t("marketing.unsubscribe.doneBody", { email: payload!.e, company: company?.name ?? "" }) : t("marketing.unsubscribe.invalidBody")}</p>
    </main>
  );
}
