import { NextRequest } from "next/server";

export const BASE = "http://localhost:3000";
export const noParams = { params: Promise.resolve({}) };
export const params = <P>(p: P) => ({ params: Promise.resolve(p) });

export interface ReqInit {
  method?: string;
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  cookie?: string;
  requestId?: string;
  xff?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

/** Build a NextRequest the way a browser behind one trusted proxy would send it. */
export function req(path: string, init: ReqInit = {}) {
  const headers = new Headers({ host: "localhost:3000", "content-type": "application/json", ...init.headers });
  if (init.origin !== null) headers.set("origin", init.origin ?? BASE);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.requestId) headers.set("x-request-id", init.requestId);
  if (init.xff) headers.set("x-forwarded-for", init.xff);
  if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  return new NextRequest(`${BASE}${path}`, { method: init.method ?? (body === undefined ? "GET" : "POST"), headers, body });
}

export function sessionCookie(res: Response): string {
  const set = res.headers.get("set-cookie");
  if (!set) throw new Error("no session cookie");
  return set.split(";")[0]!;
}
