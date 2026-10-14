import { body, route } from "@/server/core/http";
import { getMe, preferencesInput, updatePreferences } from "@/server/modules/auth/service";
import { listMyOrganizations } from "@/server/modules/organizations/service";
import { directionOf } from "@/i18n/config";

export const GET = route({ auth: "mfa-pending" }, async ({ ctx, session }) => {
  const user = await getMe(session!.userId);
  return {
    user,
    direction: directionOf(user.locale),
    mfaPending: session!.mfaPending,
    organizations: session!.mfaPending ? [] : await listMyOrganizations(ctx),
  };
});

export const PATCH = route({ auth: "required" }, async ({ req, ctx }) => updatePreferences(ctx, await body(req, preferencesInput)));
