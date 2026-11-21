import "server-only";
import { z } from "zod";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { AppError, forbidden, notFound } from "@/server/core/errors";
import { assertModuleEnabled } from "@/server/core/platform-controls";
import { requirePermission } from "@/server/modules/rbac/service";
import { companyChain, type ScopeChain } from "@/server/modules/rbac/scope";
import { isVoiceLanguage, personalityOf, STT_CHOICES, TTS_CHOICES, type VoiceLanguage } from "./catalog";

export interface VoiceScope {
  organizationId: string;
  companyId: string;
}

const uuid = z.string().uuid();
export const isUuid = (v: string) => uuid.safeParse(v).success;

/**
 * Voice OS is a personal console on top of AI Command: the viewer must read the company, be a signed-in person, and
 * the AI workforce module must not be switched off by the platform (Admin → Platform Controls).
 */
export async function authorizeVoice(ctx: RequestContext, organizationId: string, companyId: string): Promise<{ chain: ScopeChain; userId: string }> {
  if (!isUuid(organizationId) || !isUuid(companyId)) throw notFound("Company");
  const chain = await companyChain(db(), organizationId, companyId);
  await requirePermission(ctx, "companies.read", chain);
  if (ctx.actor.type !== "USER" || !ctx.actor.id) throw forbidden("Voice OS is available to signed-in people only");
  await assertModuleEnabled(organizationId, "workforce");
  return { chain, userId: ctx.actor.id };
}

// ───────────── Settings ─────────────

export const settingsInput = z.object({
  historyEnabled: z.boolean().optional(),
  wakeWordEnabled: z.boolean().optional(),
  speakReplies: z.boolean().optional(),
  personality: z.string().max(32).optional(),
  language: z.string().max(10).optional(),
  sttProvider: z.enum(STT_CHOICES).optional(),
  ttsProvider: z.enum(TTS_CHOICES).optional(),
});

export interface VoiceSettingsView {
  historyEnabled: boolean;
  wakeWordEnabled: boolean;
  speakReplies: boolean;
  personality: string;
  language: VoiceLanguage;
  sttProvider: (typeof STT_CHOICES)[number];
  ttsProvider: (typeof TTS_CHOICES)[number];
}

function view(row: { historyEnabled: boolean; wakeWordEnabled: boolean; speakReplies: boolean; personality: string; language: string; sttProvider: string; ttsProvider: string } | null, fallbackLanguage: string): VoiceSettingsView {
  const lang = row?.language ?? fallbackLanguage;
  return {
    historyEnabled: row?.historyEnabled ?? false,
    wakeWordEnabled: row?.wakeWordEnabled ?? false,
    speakReplies: row?.speakReplies ?? true,
    personality: personalityOf(row?.personality).key,
    language: isVoiceLanguage(lang) ? lang : "en-US",
    sttProvider: ((STT_CHOICES as readonly string[]).includes(row?.sttProvider ?? "") ? row!.sttProvider : "auto") as VoiceSettingsView["sttProvider"],
    ttsProvider: ((TTS_CHOICES as readonly string[]).includes(row?.ttsProvider ?? "") ? row!.ttsProvider : "auto") as VoiceSettingsView["ttsProvider"],
  };
}

export async function readSettings(scope: VoiceScope, userId: string, fallbackLanguage = "en-US"): Promise<VoiceSettingsView> {
  const row = await db().voiceosSettings.findFirst({ where: { ...scope, userId } });
  return view(row, fallbackLanguage);
}

export async function getVoiceSettings(ctx: RequestContext, organizationId: string, companyId: string, locale?: string) {
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  return readSettings({ organizationId, companyId }, userId, locale);
}

/** Update the viewer's own Voice OS preferences (personal; no audit trail needed beyond the row). */
export async function updateVoiceSettings(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof settingsInput>) {
  const input = settingsInput.parse(raw);
  const { userId } = await authorizeVoice(ctx, organizationId, companyId);
  if (input.language !== undefined && !isVoiceLanguage(input.language)) throw new AppError("validation_error", "Unsupported language");
  const data = {
    ...input,
    ...(input.personality !== undefined ? { personality: personalityOf(input.personality).key } : {}),
  };
  const row = await db().voiceosSettings.upsert({
    where: { companyId_userId: { companyId, userId } },
    create: { organizationId, companyId, userId, ...data },
    update: data,
  });
  return view(row, row.language);
}
