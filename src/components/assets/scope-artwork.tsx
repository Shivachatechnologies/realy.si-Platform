import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { getLocale } from "@/i18n/server";
import { requireOrgContext } from "@/server/workspace";
import { scopeArtwork } from "@/server/modules/assets/service";
import { assetFileUrl, type AssetScope } from "@/server/modules/assets/presets";
import { AssetThumb } from "./asset-thumb";

/**
 * Server component: the scope's generated artwork (its pinned asset, else the newest), or `fallback` — usually the
 * module's SVG illustration — when there is none or the viewer may not read assets.
 *
 *   <ScopeArtwork scopeType="DEPARTMENT" scopeId={dept.id} fallback={<WorldIllustration world="people" />} />
 */
export async function ScopeArtwork({ scopeType, scopeId = null, fallback, className, ratio }: { scopeType: AssetScope; scopeId?: string | null; fallback: ReactNode; className?: string; ratio?: "1:1" | "3:2" | "2:3" }) {
  const { viewer, org, company } = await requireOrgContext(await getLocale());
  const art = company ? await scopeArtwork(viewer.ctx, org.id, company.id, scopeType, scopeId).catch(() => null) : null;
  if (!art || !company) return <div className={className}>{fallback}</div>;
  return <AssetThumb src={assetFileUrl(org.id, company.id, art.id)} alt={art.title ?? art.prompt ?? ""} ratio={ratio ?? art.aspectRatio} className={cn("shadow-float", className)} />;
}
