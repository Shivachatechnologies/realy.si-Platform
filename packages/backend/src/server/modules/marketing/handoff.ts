import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { createTask } from "@/server/modules/agents/service";
import { delegationLimitReason, receiverUnavailableReason } from "@/server/modules/workforce/delegation";
import { listAccounts, mediaProblems, resolvePostMedia } from "./social";
import { MEDIA_REQUIRED } from "./social-providers";

/**
 * Creative → publishing chain (creative_designer / graphic_designer → social_media_manager). A finished visual is handed
 * to the social media manager as a new AI task that writes the platform copy and proposes `schedule_social_post` with
 * the asset attached. Nothing is scheduled or published here: scheduling stays behind the tool gateway's approval and
 * autonomy rules, and a post counts as published only when the platform confirmed it (social.ts#processPost).
 */

export const SOCIAL_HANDOFF_PROFILE = "social_media_manager";
const MAX_ASSETS = 4;

export interface SocialHandoffInput {
  assetIds: string[];
  brief: string;
  accountIds?: string[];
  scheduledAt?: string;
  campaignId?: string;
  /** The AI task doing the hand-off (rolled up to it when finished, counted against its delegation limits). */
  parentTaskId?: string | null;
}

/** The company's active social media manager AI employee who can take work now, else null (the role profile is used). */
async function socialManager(organizationId: string, companyId: string): Promise<string | null> {
  const e = await db().aiEmployee.findFirst({ where: { organizationId, companyId, profileKey: SOCIAL_HANDOFF_PROFILE, status: "ACTIVE", archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!e) return null;
  return (await receiverUnavailableReason(organizationId, companyId, e.id)) ? null : e.id;
}

export async function startSocialHandoff(ctx: RequestContext, organizationId: string, companyId: string, input: SocialHandoffInput) {
  const ids = [...new Set(input.assetIds)].slice(0, MAX_ASSETS);
  if (!ids.length) throw invalid("Choose at least one asset", { reason: "marketing_handoff_no_assets" });
  const assets = [];
  for (const id of ids) {
    const a = await resolvePostMedia(organizationId, companyId, id);
    if (!a) throw notFound("Asset");
    if (a.status !== "READY") throw conflict(`The asset "${a.name}" is not ready yet (${a.status})`, { reason: "marketing_asset_not_ready" });
    if (a.kind !== "IMAGE" && a.kind !== "VIDEO") throw invalid(`The asset "${a.name}" is not an image or video`, { reason: "marketing_asset_not_visual" });
    assets.push(a);
  }
  const { accounts } = await listAccounts(ctx, organizationId, companyId);
  const chosen = input.accountIds?.length ? accounts.filter((a) => input.accountIds!.includes(a.id)) : accounts;
  if (input.accountIds?.length && chosen.length !== new Set(input.accountIds).size) throw notFound("Account");
  if (input.campaignId && !(await db().marketingCampaign.findFirst({ where: { id: input.campaignId, organizationId, companyId }, select: { id: true } }))) throw notFound("Campaign");
  if (input.parentTaskId) {
    const limit = await delegationLimitReason(organizationId, companyId, input.parentTaskId);
    if (limit) throw conflict(limit, { reason: "marketing_handoff_limit" });
  }
  const aiEmployeeId = await socialManager(organizationId, companyId);
  const assetLines = assets.map((a) => {
    const fits = chosen.filter((acc) => !mediaProblems([acc], { kind: a.kind, fromLibrary: true, url: false }).length).map((acc) => acc.name);
    return `- ${a.kind} "${a.name}" assetId=${a.id}${chosen.length ? ` — fits: ${fits.join(", ") || "none of the chosen accounts"}` : ""}`;
  });
  const accountLines = chosen.map((a) => `- ${a.name} (${a.provider}) id=${a.id}${a.connected ? "" : " — platform NOT connected: the post will fail until someone connects it in Integrations"}${MEDIA_REQUIRED[a.provider] ? ` — needs ${MEDIA_REQUIRED[a.provider] === "any" ? "an image or video" : `a ${MEDIA_REQUIRED[a.provider]}`}` : ""}`);
  const instructions = `The creative team handed you finished visuals to publish.
Brief: ${input.brief}

Assets (attach them with schedule_social_post "assetIds": [assetId] — one asset per post):
${assetLines.join("\n")}

${chosen.length ? `Target accounts:\n${accountLines.join("\n")}` : "No social accounts are set up in marketing yet: write the copy per platform as your deliverable and say that accounts must be added and connected before anything can be scheduled."}
${input.scheduledAt ? `Requested time: ${input.scheduledAt} (ISO 8601).` : "Choose a sensible time per platform (use read_marketing_learnings for the best posting times when available)."}
${input.campaignId ? `Campaign id: ${input.campaignId} (pass it as campaignId).` : ""}

Steps: call read_brand_kit; write copy that fits each platform's length and style; then propose schedule_social_post per post with the matching assetIds. Instagram and TikTok need an image or video, Pinterest an image, YouTube a video — never schedule a post to them without the right asset. Scheduling needs a person's approval; report what you proposed and never claim that anything was published.`;
  const task = await createTask(
    ctx,
    organizationId,
    companyId,
    {
      ...(aiEmployeeId ? { aiEmployeeId } : { profile: SOCIAL_HANDOFF_PROFILE as never }),
      title: `Publish creatives: ${input.brief}`.slice(0, 200),
      instructions: instructions.slice(0, 8000),
      ...(input.campaignId ? { subject: { type: "marketing_campaign", id: input.campaignId } } : {}),
    },
    input.parentTaskId ? { parentTaskId: input.parentTaskId } : {},
  );
  return { task, assets, accounts: chosen.length, aiEmployeeId };
}
