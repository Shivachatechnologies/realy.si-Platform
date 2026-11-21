import { NextResponse } from "next/server";
import { jsonStringify } from "@/server/core/json";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/modules/auth/session";

export function withSessionCookie(body: unknown, token: string, expires: Date): NextResponse {
  const res = new NextResponse(jsonStringify(body), { headers: { "content-type": "application/json; charset=utf-8" } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expires));
  return res;
}

export function clearSessionCookie(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
}
