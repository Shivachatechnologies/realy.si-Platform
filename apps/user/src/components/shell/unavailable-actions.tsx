"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/shell/switchers";
import { useI18n } from "@/i18n/client";
import { setCookie } from "@/lib/api-client";

/** Way out of an unavailable state: switch to another organization (clears the selection) or sign out. */
export function UnavailableActions({ reason }: { reason: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {reason === "organization_suspended" ? (
        <Button
          variant="secondary"
          onClick={() => {
            setCookie("realy_org", "", 0);
            router.replace(`/${locale}`);
            router.refresh();
          }}
        >
          {t("unavailable.switchOrg")}
        </Button>
      ) : null}
      {reason === "module_disabled" ? (
        <Button variant="secondary" onClick={() => router.replace(`/${locale}`)}>
          {t("unavailable.home")}
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => router.refresh()}>
          {t("unavailable.retry")}
        </Button>
      )}
      <SignOutButton />
    </div>
  );
}
