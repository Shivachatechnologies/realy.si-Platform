import { foregroundFor, getBranding } from "@/server/modules/enterprise/branding";

/**
 * Server component: emits the organization's white-label CSS variables (primary color and its foreground), overriding
 * the theme in light and dark mode. Mount once in the app layout: `<BrandingStyle organizationId={org.id} />`.
 */
export async function BrandingStyle({ organizationId }: { organizationId: string | null | undefined }) {
  if (!organizationId) return null;
  const b = await getBranding(organizationId).catch(() => null);
  const color = b?.primaryColor;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  const fg = foregroundFor(color);
  // Triple :root out-specifies the theme selectors (:root:not([data-theme="light"]), :root[data-theme="dark"]).
  const css = `:root:root:root{--primary:${color};--primary-foreground:${fg};--ring:${color};}`;
  return <style data-realy-branding="">{css}</style>;
}
