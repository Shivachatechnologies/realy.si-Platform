import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="mx-auto grid max-w-md gap-2 px-4 py-24 text-center">
      <h1 className="text-lg font-semibold">{t("errors.notFoundTitle")}</h1>
      <p className="text-muted-foreground">{t("errors.notFoundBody")}</p>
    </div>
  );
}
