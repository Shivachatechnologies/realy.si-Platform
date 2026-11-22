import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaProblems } from "@/server/modules/marketing/social";
import { imageProvidersMissingText, platformKeyOptions, platformKeysOf, socialMissingKeys } from "@/server/modules/marketing/provider-keys";

afterEach(() => vi.unstubAllEnvs());

describe("social media rules (MEDIA_REQUIRED as data)", () => {
  const accounts = [
    { provider: "INSTAGRAM" as const, name: "ig" },
    { provider: "TIKTOK" as const, name: "tt" },
    { provider: "YOUTUBE" as const, name: "yt" },
    { provider: "PINTEREST" as const, name: "pin" },
    { provider: "LINKEDIN" as const, name: "li" },
  ];
  it("text-only: every media platform is reported, text platforms are fine", () => {
    expect(mediaProblems(accounts, { kind: null, fromLibrary: false, url: false }).map((p) => [p.account, p.reason])).toEqual([
      ["ig", "media_required"],
      ["tt", "media_required"],
      ["yt", "media_required"],
      ["pin", "media_required"],
    ]);
  });
  it("an image satisfies Instagram, TikTok and Pinterest but not YouTube", () => {
    expect(mediaProblems(accounts, { kind: "IMAGE", fromLibrary: true, url: false }).map((p) => [p.account, p.reason])).toEqual([["yt", "video_required"]]);
  });
  it("a video satisfies everything but Pinterest; a URL never satisfies YouTube", () => {
    expect(mediaProblems(accounts, { kind: "VIDEO", fromLibrary: true, url: false }).map((p) => p.account)).toEqual(["pin"]);
    expect(mediaProblems(accounts, { kind: null, fromLibrary: false, url: true }).map((p) => p.account)).toEqual(["yt"]);
  });
});

describe("platform key names for missing providers", () => {
  it("names the exact keys, and nothing once one provider has its keys", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("STABILITY_API_KEY", "");
    vi.stubEnv("REPLICATE_API_KEY", "");
    expect(platformKeyOptions(["openai", "stability", "replicate"])).toEqual(["OPENAI_API_KEY", "STABILITY_API_KEY", "REPLICATE_API_KEY"]);
    expect(imageProvidersMissingText()).toMatch(/OPENAI_API_KEY or STABILITY_API_KEY or REPLICATE_API_KEY/);
    vi.stubEnv("STABILITY_API_KEY", "set-for-test");
    expect(platformKeyOptions(["openai", "stability", "replicate"])).toEqual([]);
  });
  it("multi-key providers and OAuth apps", () => {
    expect(platformKeysOf("kling")).toEqual(["KLING_ACCESS_KEY", "KLING_SECRET_KEY"]);
    vi.stubEnv("FACEBOOK_APP_ID", "");
    vi.stubEnv("FACEBOOK_APP_SECRET", "");
    expect(socialMissingKeys().INSTAGRAM).toEqual(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]);
  });
});
