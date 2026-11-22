import { isAppLocale } from "@/i18n/config";
import { getNamespace } from "../../../../../i18n/catalog";

/**
 * One namespace of a message catalog, for the client i18n safety net (packages/shared-utils/src/i18n/client.tsx):
 * fetched only when a client component asks for a namespace its page did not deliver. Public UI strings only.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/i18n/[locale]/[namespace]">) {
  const { locale, namespace } = await ctx.params;
  const value = isAppLocale(locale) ? await getNamespace(locale, namespace) : undefined;
  if (value === undefined) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  return Response.json(value, { headers: { "cache-control": "public, max-age=3600" } });
}
