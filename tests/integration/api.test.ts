import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as signUpRoute } from "@/app/api/v1/auth/sign-up/route";
import { POST as createOrgRoute, GET as listOrgsRoute } from "@/app/api/v1/organizations/route";
import { GET as pricingRoute } from "@/app/api/v1/catalog/pricing/route";
import { resetDb } from "../helpers";

beforeAll(resetDb);

const BASE = "http://localhost:3000";
const noParams = { params: Promise.resolve({}) };

function req(path: string, init: { method?: string; body?: unknown; origin?: string | null; cookie?: string; requestId?: string } = {}) {
  const headers = new Headers({ host: "localhost:3000", "content-type": "application/json" });
  if (init.origin !== null) headers.set("origin", init.origin ?? BASE);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.requestId) headers.set("x-request-id", init.requestId);
  return new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("HTTP API conventions (docs/api.md)", () => {
  it("refuses cross-origin and origin-less mutations (CSRF)", async () => {
    const evil = await signUpRoute(req("/api/v1/auth/sign-up", { method: "POST", origin: "https://evil.example", body: {} }), noParams);
    expect(evil.status).toBe(403);
    const none = await signUpRoute(req("/api/v1/auth/sign-up", { method: "POST", origin: null, body: {} }), noParams);
    expect(none.status).toBe(403);
  });

  it("returns the structured error envelope with field issues and echoes request ids", async () => {
    const res = await signUpRoute(req("/api/v1/auth/sign-up", { method: "POST", body: { email: "bad" }, requestId: "req_test-123456" }), noParams);
    expect(res.status).toBe(400);
    expect(res.headers.get("x-request-id")).toBe("req_test-123456");
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.requestId).toBe("req_test-123456");
    expect(body.error.details.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(["email", "password", "name"]));
  });

  it("sets an HttpOnly session cookie and authenticates later requests with it", async () => {
    const res = await signUpRoute(
      req("/api/v1/auth/sign-up", { method: "POST", body: { email: "api@example.test", password: "a-very-long-password", name: "Api" } }),
      noParams,
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/realy_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    const cookie = setCookie.split(";")[0]!;

    const created = await createOrgRoute(req("/api/v1/organizations", { method: "POST", cookie, body: { name: "API Co" } }), noParams);
    expect(created.status).toBe(200);
    const list = await (await listOrgsRoute(req("/api/v1/organizations", { cookie }), noParams)).json();
    expect(list.data.map((o: { name: string }) => o.name)).toEqual(["API Co"]);
  });

  it("rejects unauthenticated access to tenant endpoints", async () => {
    const res = await listOrgsRoute(req("/api/v1/organizations"), noParams);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
  });

  it("serves public pricing with money as string minor units", async () => {
    const res = await pricingRoute(req("/api/v1/catalog/pricing?country=IN&interval=MONTH"), noParams);
    const body = await res.json();
    const founder = body.plans.find((p: { key: string }) => p.key === "founder");
    expect(founder.resolution.price.money).toEqual({ amountMinor: "499900", currency: "INR" });
  });
});
