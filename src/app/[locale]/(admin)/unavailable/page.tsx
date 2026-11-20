import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { UnavailableActions } from "@/components/admin/unavailable-actions";
import { getLocale, getT } from "@/i18n/server";
import { getControls, PLATFORM_MODULES } from "@/server/core/platform-controls";

const REASONS = ["maintenance", "organization_suspended", "module_disabled"] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.unavailable.title") };
}

/** Shown by the platform page gate (requireOrgContext): maintenance, a suspended organization or a disabled module. */
export default async function UnavailablePage({ searchParams }: PageProps<"/[locale]/unavailable">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const query = await searchParams;
  const reason = REASONS.find((r) => r === query.reason) ?? "maintenance";
  const mod = PLATFORM_MODULES.find((m) => m === query.module);
  const controls = await getControls();
  const supportEmail = controls.supportEmail;
  const message =
    reason === "maintenance"
      ? controls.maintenanceMessage || t("admin.unavailable.maintenance")
      : reason === "organization_suspended"
        ? t("admin.unavailable.suspended")
        : t("admin.unavailable.moduleDisabled", { module: mod ? t(`admin.modules.${mod}`) : "" });
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="grid max-w-md gap-4 text-center">
        <div className="flex items-center justify-center gap-2 font-semibold">
          <BrandMark />
          <span>{controls.platformName}</span>
        </div>
        <Wrench className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">{t(`admin.unavailable.titles.${reason}`)}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {supportEmail ? (
          <p className="text-xs text-muted-foreground">
            {t("admin.unavailable.contact")}{" "}
            <a className="underline" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
          </p>
        ) : null}
        <UnavailableActions reason={reason} />
      </div>
    </main>
  );
}
