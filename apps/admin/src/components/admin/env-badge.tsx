import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";

export type DeployEnvironment = "production" | "preview" | "development";

/**
 * The deployment environment and release of this admin process (server only): `VERCEL_ENV` when deployed on
 * Vercel, else `NODE_ENV` (anything but production counts as development). The commit comes from
 * `VERCEL_GIT_COMMIT_SHA` (requires "Automatically expose System Environment Variables" on the Vercel project).
 */
export function environmentInfo(): { env: DeployEnvironment; sha: string | null; ref: string | null } {
  const vercel = process.env.VERCEL_ENV;
  const env: DeployEnvironment = vercel === "production" || vercel === "preview" || vercel === "development" ? vercel : process.env.NODE_ENV === "production" ? "production" : "development";
  return { env, sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null, ref: process.env.VERCEL_GIT_COMMIT_REF ?? null };
}

const TONE: Record<DeployEnvironment, string> = {
  production: "border-danger/40 bg-danger/10 text-danger",
  preview: "border-warning/40 bg-warning/10 text-warning",
  development: "border-info/40 bg-info/10 text-info",
};

/** Top-bar environment pill (stream A places it). `hideInProduction` renders nothing in production. */
export async function EnvBadge({ hideInProduction = false, className }: { hideInProduction?: boolean; className?: string }) {
  const info = environmentInfo();
  if (hideInProduction && info.env === "production") return null;
  const t = await getT();
  return (
    <span title={info.sha ? `${info.ref ?? ""} ${info.sha}`.trim() : undefined} className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE[info.env], className)}>
      {t(`admin.shell.env.${info.env}`)}
    </span>
  );
}
