import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PublicShell } from "@/components/support/public-shell";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { publicHelpCenter } from "@/server/modules/support/kb";
import { db } from "@/server/core/db";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.help.title") };
}

export default async function HelpCenterPage({ params, searchParams }: PageProps<"/[locale]/help/[companyId]">) {
  const { companyId } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getT(locale);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
  const category = typeof sp.category === "string" ? sp.category : undefined;
  const hc = await publicHelpCenter(companyId, { q: q || undefined, categoryId: category }).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const path = `/${locale}/help/${companyId}`;
  const contact = await db().supportSettings.findUnique({ where: { companyId }, select: { emailChannelEnabled: true, supportEmail: true } });
  return (
    <PublicShell
      title={t("support.help.heading", { company: hc.company.name })}
      home={path}
      footer={
        contact?.emailChannelEnabled && contact.supportEmail ? (
          <>
            {t("support.public.emailUs")}{" "}
            <a href={`mailto:${contact.supportEmail}`} className="underline">
              {contact.supportEmail}
            </a>
          </>
        ) : undefined
      }
    >
      <div className="grid gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("support.help.howCanWeHelp")}</h1>
        <form className="mx-auto flex w-full max-w-xl gap-2" action={path}>
          <Input name="q" type="search" defaultValue={q} maxLength={200} placeholder={t("support.help.search")} aria-label={t("support.help.search")} />
          <Button type="submit">{t("support.help.searchButton")}</Button>
        </form>
      </div>
      {hc.categories.length ? (
        <div className="flex flex-wrap justify-center gap-2">
          <Link href={q ? `${path}?q=${encodeURIComponent(q)}` : path} className={cn("rounded-full border px-3 py-1 text-xs", !category ? "border-primary bg-accent" : "hover:bg-muted")}>
            {t("common.all")}
          </Link>
          {hc.categories.map((c) => (
            <Link key={c.id} href={`${path}?category=${c.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={cn("rounded-full border px-3 py-1 text-xs", category === c.id ? "border-primary bg-accent" : "hover:bg-muted")}>
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}
      <Card>
        {hc.articles.length ? (
          <ul className="grid divide-y">
            {hc.articles.map((a) => (
              <li key={a.id}>
                <Link href={`${path}/${a.slug}`} className="grid gap-0.5 px-4 py-3 hover:bg-muted/50">
                  <span className="font-medium">{a.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{a.excerpt}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{q ? t("support.help.noResults") : t("support.help.empty")}</p>
        )}
      </Card>
      {hc.company.supportFormEnabled ? (
        <p className="text-center text-sm">
          {t("support.help.stillNeedHelp")}{" "}
          <Link href={`/${locale}/support-form/${companyId}`} className="underline">
            {t("support.help.contactUs")}
          </Link>
        </p>
      ) : null}
    </PublicShell>
  );
}
