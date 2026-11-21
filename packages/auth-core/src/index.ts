/**
 * Session primitives shared by both apps' proxies and the backend (docs/architecture/apps.md §Auth).
 *
 * Each app is built with `env.REALY_APP` set in its next.config ("user" | "admin"), which Next inlines at build
 * time, so the backend code compiled into an app reads and writes that app's own cookie. The worker and tests
 * run as "user". Cookies are host-only (no Domain): app.realy.si and admin.realy.si never share a session.
 */
export type AppId = "user" | "admin";

export const CURRENT_APP: AppId = process.env.REALY_APP === "admin" ? "admin" : "user";

const production = process.env.NODE_ENV === "production";

/** The admin cookie uses the `__Host-` prefix in production (Secure, Path=/, no Domain — enforced by browsers). */
export const SESSION_COOKIES: Record<AppId, string> = {
  user: "realy_session",
  admin: production ? "__Host-realy_admin_session" : "realy_admin_session",
};

/** Session cookie of the app this code is compiled into. */
export const SESSION_COOKIE = SESSION_COOKIES[CURRENT_APP];

/** The admin session is SameSite=Strict: it is never sent on requests initiated by another site. */
export const sessionCookieOptions = (expires: Date, app: AppId = CURRENT_APP) => ({
  httpOnly: true,
  secure: production,
  sameSite: app === "admin" ? ("strict" as const) : ("lax" as const),
  path: "/",
  expires,
});
