import { Plug, ToggleRight } from "lucide-react";
import type { PaletteSource } from "../types";

const CONTROL_PAGE: Record<string, string> = { ai: "/ai", kill: "/controls", settings: "/settings" };

/** Stream F — platform switches (matched on key and translated label) and integration providers. */
export const paletteF: PaletteSource[] = [
  {
    group: "controls",
    label: "admin.search.controls",
    order: 10,
    hits: ({ low, data, controls, base, t }) =>
      low.length < 2
        ? []
        : controls
            .filter((c) => data?.controls.includes(c.key) || t(`admin.controls.keys.${c.key}.label`).toLowerCase().includes(low))
            .slice(0, 6)
            .map((c) => ({ id: `ctl:${c.key}`, label: t(`admin.controls.keys.${c.key}.label`), sub: c.key, href: `${base}${CONTROL_PAGE[c.group] ?? "/controls"}`, icon: ToggleRight })),
  },
  {
    group: "integrations",
    label: "admin.nav.integrations",
    order: 60,
    hits: ({ data, base, t }) =>
      (data?.integrations ?? []).map((i) => ({ id: `i:${i.provider}`, label: i.provider, sub: t("admin.search.connections", { count: i.connections }), href: `${base}/integrations?provider=${i.provider}`, icon: Plug })),
  },
];
