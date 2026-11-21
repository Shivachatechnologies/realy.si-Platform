import { route } from "@/server/core/http";
import { assetBytes } from "@/server/modules/assets/service";

type P = { orgId: string; companyId: string; assetId: string };

/** GET [?download=1] — the asset's bytes, same-origin (the page CSP only allows images from 'self'). */
export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId, companyId, assetId }) => {
  const file = await assetBytes(ctx, orgId, companyId, assetId);
  const ext = file.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
  const name = `${(file.title ?? "artwork").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "artwork"}.${ext}`;
  return new Response(new Blob([file.body as BlobPart], { type: file.contentType }), {
    headers: {
      "content-type": file.contentType,
      "cache-control": "private, max-age=3600, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      ...(req.nextUrl.searchParams.get("download") ? { "content-disposition": `attachment; filename="${name}"` } : {}),
    },
  });
});
