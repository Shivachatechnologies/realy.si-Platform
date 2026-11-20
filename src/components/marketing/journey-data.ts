import "server-only";
import type { MarketingContext } from "./shell";
import type { JourneyProps } from "./journey-wizard";
import { getJourney } from "@/server/modules/marketing/journey";
import { listAccounts } from "@/server/modules/marketing/social";
import { assetPublicUrl, creativeStatus } from "@/server/modules/marketing/assets";
import { loadBrandKit } from "@/server/modules/marketing/brand";
import { db } from "@/server/core/db";

/** Server data for the guided journey (save & resume). */
export async function journeyProps(m: Exclude<MarketingContext, { blocked: "no_company" }>): Promise<JourneyProps> {
  const { org, company, viewer, base, locale } = m;
  const [j, { accounts }, creative, kit] = await Promise.all([getJourney(viewer.ctx, org.id, company.id), listAccounts(viewer.ctx, org.id, company.id), creativeStatus(org.id, company.id), loadBrandKit(db(), company.id)]);
  return {
    base,
    locale,
    brand: kit?.brandName ?? company.name,
    step: j.journey?.step ?? 1,
    answers: j.journey?.answers ?? {},
    products: j.products,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider, connected: a.connected })),
    strategy: j.strategy ? { id: j.strategy.id, status: j.strategy.status, output: j.strategy.output } : null,
    pack: j.pack ? { id: j.pack.id, status: j.pack.status, output: j.pack.output } : null,
    drafts: j.drafts.map((d) => ({ id: d.id, type: d.type, title: d.title, body: d.body, brief: d.brief, imageUrl: d.featuredAsset ? assetPublicUrl(d.featuredAsset) : null })),
    autopilotId: j.journey?.autopilotId ?? null,
    imageProvider: creative.image,
    canManage: m.canManage,
  };
}
