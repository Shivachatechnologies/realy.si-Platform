import Link from "next/link";
import { getLocale, getT } from "@/i18n/server";

export default async function NotFound() {
  const locale = await getLocale();
  const t = await getT(locale);
  return (
    <div className="mx-auto grid max-w-md gap-2 px-4 py-24 text-center">
      <h1 className="text-base font-semibold">{t("errors.notFoundTitle")}</h1>
      <p className="text-muted-foreground">{t("errors.notFoundBody")}</p>
      <Link href={`/${locale}`} className="mt-2 text-xs text-primary hover:underline">
        {t("authHero.adminTitle")}
      </Link>
    </div>
  );
}
