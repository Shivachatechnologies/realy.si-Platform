import { Blocks, Bot, Building2, Cpu, Factory, Layers, Plug, Sparkles, Workflow } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { formatMoney } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import type { ListingType } from "@/server/modules/marketplace/manifest";

export const TYPE_ICON: Record<ListingType, ComponentType<SVGProps<SVGSVGElement>>> = {
  AI_EMPLOYEE: Bot,
  AI_AGENT: Cpu,
  SKILL: Sparkles,
  WORKFLOW: Workflow,
  INTEGRATION: Plug,
  COMPANY_TEMPLATE: Building2,
  DEPARTMENT_TEMPLATE: Layers,
  INDUSTRY_BLUEPRINT: Factory,
};
export const FallbackIcon = Blocks;

export function priceLabel(
  t: Translate,
  locale: string,
  l: {
    pricingModel: string;
    priceMinor: bigint | string | null;
    currency: string | null;
  },
) {
  if (l.pricingModel === "FREE" || l.priceMinor === null || !l.currency) return t("marketplace.pricing.free");
  const amount = formatMoney({ amountMinor: l.priceMinor, currency: l.currency }, locale);
  return l.pricingModel === "MONTHLY" ? t("marketplace.pricing.monthlyAmount", { amount }) : t("marketplace.pricing.oneTimeAmount", { amount });
}

/** Localized built-in names/summaries (marketplace.catalog.<slug>.*); published listings keep their own text. */
export const catalogText = (t: Translate) => (slug: string) => ({
  name: t(`marketplace.catalog.${slug}.name`),
  summary: t(`marketplace.catalog.${slug}.summary`),
});

export function Stars({ value, label }: { value: number; label: string }) {
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5 text-warning" aria-label={label} title={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden className={i <= full ? "" : "opacity-25"}>
          ★
        </span>
      ))}
    </span>
  );
}

/** Ordered sections of an install summary / manifest. */
export const SECTION_KEYS = [
  "departments",
  "teams",
  "roles",
  "projects",
  "tasks",
  "objectives",
  "milestones",
  "workflows",
  "aiEmployees",
  "pipelines",
  "skills",
  "integrations",
  "_settings",
] as const;

export const STATUS_TONE = {
  DRAFT: "neutral",
  IN_REVIEW: "warning",
  PUBLISHED: "success",
  REJECTED: "danger",
  ARCHIVED: "neutral",
} as const;
