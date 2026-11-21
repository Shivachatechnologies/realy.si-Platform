import type { NextRequest } from "next/server";
import { route } from "@/server/core/http";
import { LIMITS } from "@/server/core/limits";
import { env } from "@/server/core/env";
import { closestLocale } from "@/i18n/config";
import { unsubscribe, verifyUnsubscribeToken } from "@/server/modules/marketing/tracking";

/**
 * One-click unsubscribe from the link in every marketing email. GET performs the unsubscribe and redirects to the
 * confirmation page; POST supports RFC 8058 List-Unsubscribe-Post from mail clients (the signed token is the credential).
 */
export const GET = route({ auth: "none", rateLimits: LIMITS.publicRead }, async ({ req }) => {
  const token = req.nextUrl.searchParams.get("token");
  const payload = verifyUnsubscribeToken(token);
  const done = payload ? await unsubscribe(payload) : null;
  const target = new URL(`/${closestLocale(done?.locale)}/unsubscribe`, env().APP_URL);
  target.searchParams.set("status", done ? "done" : "invalid");
  if (done) target.searchParams.set("token", token!);
  return new Response(null, { status: 303, headers: { location: target.toString(), "cache-control": "no-store" } });
});

export async function POST(req: NextRequest): Promise<Response> {
  const payload = verifyUnsubscribeToken(req.nextUrl.searchParams.get("token"));
  if (!payload) return new Response(null, { status: 400 });
  await unsubscribe(payload);
  return new Response(null, { status: 204 });
}
