import "server-only";
import { revalidateTag } from "next/cache";
import { siteCacheTag } from "@/server/modules/sites/public";

/** Expire the public site's cached data right away (after publish, unpublish, settings and page changes). */
export function refreshSite(...slugs: (string | null | undefined)[]) {
  for (const slug of new Set(slugs.filter((s): s is string => !!s))) revalidateTag(siteCacheTag(slug), { expire: 0 });
}
