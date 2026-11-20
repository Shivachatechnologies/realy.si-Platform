/** Shared (client-safe) constants of the visual asset library. */
export const ASSET_SCOPES = ["BRAND", "DEPARTMENT", "CAMPAIGN", "PROJECT", "AI_EMPLOYEE", "PRODUCT"] as const;
export type AssetScope = (typeof ASSET_SCOPES)[number];

export const STYLE_PRESETS = ["cinematic", "editorial", "isometric", "abstract", "blueprint", "product", "illustration", "portrait"] as const;
export type StylePreset = (typeof STYLE_PRESETS)[number];

export const ASPECT_RATIOS = ["3:2", "1:1", "2:3"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Module world whose illustration stands in for a scope without artwork. */
export const SCOPE_WORLD: Record<AssetScope, "command" | "people" | "marketing" | "projects" | "automation" | "product"> = {
  BRAND: "command",
  DEPARTMENT: "people",
  CAMPAIGN: "marketing",
  PROJECT: "projects",
  AI_EMPLOYEE: "automation",
  PRODUCT: "product",
};

/** Same-origin URL of an asset's bytes (thumbnails, downloads). */
export const assetFileUrl = (organizationId: string, companyId: string, assetId: string, opts: { download?: boolean } = {}) =>
  `/api/v1/organizations/${organizationId}/companies/${companyId}/assets/${assetId}/file${opts.download ? "?download=1" : ""}`;
