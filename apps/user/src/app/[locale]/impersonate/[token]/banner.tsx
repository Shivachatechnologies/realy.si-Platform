import { getSession, requestTime } from "@/server/session";
import { impersonationForSession } from "@/server/modules/admin/impersonation";
import { bannerText } from "./messages";

/**
 * Persistent impersonation banner for the user-app shell (stream B). Renders nothing for normal sessions. Mount it
 * at the top of `apps/user/src/app/[locale]/(app)/layout.tsx` (shell owner):
 *   import { ImpersonationBanner } from "../impersonate/[token]/banner";
 *   <ImpersonationBanner locale={locale} />
 */
export async function ImpersonationBanner({ locale }: { locale: string }) {
  const session = await getSession();
  const imp = session ? await impersonationForSession(session.id) : null;
  if (!imp) return null;
  const t = bannerText(locale);
  const minutes = Math.max(0, Math.ceil((imp.expiresAt.getTime() - requestTime()) / 60_000));
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(imp.expiresAt);
  const full = imp.mode === "FULL";
  return (
    <div role="alert" aria-live="polite" className={`sticky top-0 z-50 flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-sm ${full ? "border-danger/40 bg-danger text-white" : "border-warning/40 bg-warning text-black"}`}>
      <strong className="font-semibold">{t("title")}</strong>
      <span>{t("body", { admin: imp.admin?.email ?? "—", user: imp.target?.email ?? "—" })}</span>
      <span className="font-medium">{full ? t("full") : t("readOnly")}</span>
      <span className="tabular-nums">{imp.live ? t("endsAt", { time, minutes }) : t("ended")}</span>
      {imp.ticketRef ? <span className="font-mono text-xs">{t("ticket", { ref: imp.ticketRef })}</span> : null}
      <form method="post" action={`/${locale}/impersonate/${imp.id}/end`} className="ms-auto">
        <button type="submit" className="rounded-md border border-current px-3 py-1 text-xs font-semibold hover:opacity-80 focus-visible:outline-2">
          {t("end")}
        </button>
      </form>
    </div>
  );
}
