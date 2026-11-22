import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { assertOutboundUrl, assertPublicTarget, checkingLookup, guardedFetch, isPrivateAddress, OutboundBlockedError } from "@/server/core/outbound";
import { resetEnvCache } from "@/server/core/env";

// SSRF guard (B2): address classification, URL policy, send-time DNS check and per-hop redirect checks.

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "127.10.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fd00::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // the WHATWG URL parser's spelling of ::ffff:127.0.0.1
    "::ffff:a9fe:a9fe", // ::ffff:169.254.169.254
    "64:ff9b::a9fe:a9fe", // NAT64 to metadata
    "2002:7f00:1::", // 6to4 of 127.0.0.1
    "[::1]",
    "not-an-ip",
  ])("blocks %s", (a) => expect(isPrivateAddress(a)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:808:808::"])("allows %s", (a) => expect(isPrivateAddress(a)).toBe(false));
});

describe("assertOutboundUrl (enforcing)", () => {
  const strict = { enforce: true, allowHttp: false };
  it.each([
    "http://example.com/",
    "https://user:pw@example.com/",
    "https://localhost/",
    "https://app.localhost/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://2130706433/", // decimal 127.0.0.1
    "https://0x7f.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://intranet/",
    "ftp://example.com/",
  ])("refuses %s", (u) => expect(() => assertOutboundUrl(u, strict)).toThrow(OutboundBlockedError));

  it("accepts a public https URL", () => expect(assertOutboundUrl("https://api.example.com/v1", strict).host).toBe("api.example.com"));
  it("refuses a literal private address at send time without DNS", async () => {
    await expect(assertPublicTarget("https://10.0.0.5/hook", strict)).rejects.toThrow(OutboundBlockedError);
  });
});

describe("checkingLookup (the connect-time DNS check)", () => {
  it("refuses a name that resolves to a blocked address", async () => {
    const lookup = checkingLookup({ enforce: true });
    const err = await new Promise<unknown>((resolve) => lookup("localhost", {}, (e: unknown) => resolve(e)));
    expect(err).toBeInstanceOf(OutboundBlockedError);
  });
  it("passes the addresses through when not enforcing", async () => {
    const lookup = checkingLookup({ enforce: false });
    const res = await new Promise<unknown[]>((resolve) => lookup("localhost", { all: true }, (...args: unknown[]) => resolve(args)));
    expect(res[0]).toBeNull();
    expect(Array.isArray(res[1])).toBe(true);
  });
});

describe("guardedFetch against a local server", () => {
  let server: http.Server;
  let port = 0;
  const seen: { host: string; path: string; method: string; auth?: string; apiKey?: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ host: req.headers.host ?? "", path: req.url ?? "", method: req.method ?? "", auth: req.headers.authorization, apiKey: req.headers["x-api-key"] as string | undefined });
      const u = new URL(req.url ?? "/", "http://x");
      if (u.pathname === "/to-blocked") return res.writeHead(302, { location: `http://127.0.0.2:${port}/secret` }).end();
      if (u.pathname === "/to-other-origin") return res.writeHead(307, { location: `http://127.0.0.3:${port}/landing` }).end();
      if (u.pathname === "/see-other") return res.writeHead(303, { location: "/landing" }).end();
      if (u.pathname === "/loop") return res.writeHead(302, { location: "/loop" }).end();
      if (u.pathname === "/gzip") {
        res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
        return res.end(zlib.gzipSync(JSON.stringify({ ok: true })));
      }
      if (u.pathname === "/big") return res.writeHead(200).end(Buffer.alloc(4096, 97));
      res.writeHead(200, { "content-type": "text/plain" }).end(`landed ${req.method}`);
    });
    await new Promise<void>((r) => server.listen(0, "0.0.0.0", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Only 127.0.0.2 counts as private here, so the local server (127.0.0.1) is reachable and the hop check is visible.
  const policy = { enforce: true, allowHttp: true, isBlocked: (a: string) => a === "127.0.0.2" };

  it("re-checks every redirect hop and refuses a blocked one", async () => {
    seen.length = 0;
    await expect(guardedFetch(`http://127.0.0.1:${port}/to-blocked`, {}, policy)).rejects.toThrow(OutboundBlockedError);
    expect(seen.map((s) => s.path)).toEqual(["/to-blocked"]); // the blocked hop was never sent
  });

  it("refuses the first hop with the default classifier", async () => {
    await expect(guardedFetch(`http://127.0.0.1:${port}/`, {}, { enforce: true, allowHttp: true })).rejects.toThrow(OutboundBlockedError);
  });

  it("drops credentials on a cross-origin hop and keeps the method for 307", async () => {
    seen.length = 0;
    const res = await guardedFetch(`http://127.0.0.1:${port}/to-other-origin`, { method: "POST", headers: { authorization: "Bearer s3cret", "x-api-key": "k", "content-type": "text/plain" }, body: "hi" }, policy);
    expect(await res.text()).toBe("landed POST");
    expect(seen[0]).toMatchObject({ auth: "Bearer s3cret", apiKey: "k" });
    expect(seen[1]).toMatchObject({ path: "/landing", auth: undefined, apiKey: undefined });
  });

  it("turns 303 into GET", async () => {
    const res = await guardedFetch(`http://127.0.0.1:${port}/see-other`, { method: "POST", body: "x" }, policy);
    expect(await res.text()).toBe("landed GET");
  });

  it("returns the 3xx untouched with redirect: manual, and refuses it with redirect: error", async () => {
    const res = await guardedFetch(`http://127.0.0.1:${port}/to-blocked`, { redirect: "manual" }, policy);
    expect(res.status).toBe(302);
    await expect(guardedFetch(`http://127.0.0.1:${port}/to-blocked`, { redirect: "error" }, policy)).rejects.toThrow(/redirects are not allowed/);
  });

  it("stops redirect loops", async () => {
    await expect(guardedFetch(`http://127.0.0.1:${port}/loop`, {}, { ...policy, maxRedirects: 3 })).rejects.toThrow(/too many redirects/);
  });

  it("decodes gzip and caps the body", async () => {
    const res = await guardedFetch(`http://127.0.0.1:${port}/gzip`, {}, policy);
    expect(await res.json()).toEqual({ ok: true });
    await expect(guardedFetch(`http://127.0.0.1:${port}/big`, {}, { ...policy, maxBytes: 1024 })).rejects.toThrow(/too large/);
  });
});

describe("workflow and provider call sites in production", () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS };
  beforeAll(() => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.TRUSTED_PROXY_HOPS = process.env.TRUSTED_PROXY_HOPS ?? "1";
    resetEnvCache();
  });
  afterAll(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = saved.NODE_ENV;
    process.env.TRUSTED_PROXY_HOPS = saved.TRUSTED_PROXY_HOPS;
    resetEnvCache();
  });

  it("validateTargetUrl refuses private targets", async () => {
    const { validateTargetUrl } = await import("@/server/modules/integrations/webhooks");
    for (const u of ["https://169.254.169.254/", "https://localhost/", "http://example.com/", "https://[::ffff:7f00:1]/"]) expect(() => validateTargetUrl(u)).toThrow();
    expect(validateTargetUrl("https://hooks.example.com/x").host).toBe("hooks.example.com");
  });

  it("guardedFetch enforces by default in production", async () => {
    await expect(guardedFetch("https://127.0.0.1:9/")).rejects.toThrow(OutboundBlockedError);
  });
});
