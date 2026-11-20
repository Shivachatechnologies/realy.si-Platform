import type { Metadata } from "next";
import Link from "next/link";
import { Crown } from "lucide-react";
import { CommandConsole } from "@/components/command/command-console";
import { Card } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("guide.command.title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** AI Command: the company's central operating console (⌘J from anywhere; ?q=…&run=1 starts a command). */
export default async function CommandPage({ searchParams }: PageProps<"/[locale]/command">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { org, company } = await requireOrgContext(locale);
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
  const sp = await searchParams;
  const s = typeof sp.s === "string" && UUID.test(sp.s) ? sp.s : null;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 2000) : null;
  return (
    <div className="mx-auto grid max-w-[1440px] gap-3">
      <div className="flex justify-end">
        <Link href={`/${locale}/command/ceo`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-surface px-3 text-xs font-medium hover:border-primary/40 hover:text-primary">
          <Crown className="size-3.5" aria-hidden />
          {t("command.ceo.open")}
        </Link>
      </div>
      <CommandConsole base={`/api/v1/organizations/${org.id}/companies/${company.id}`} initialSessionId={s} initialQuery={q} autoRun={sp.run === "1"} />
    </div>
  );
}
