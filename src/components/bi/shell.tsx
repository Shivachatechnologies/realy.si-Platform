import type { ReactNode } from "react";
import type { Translate } from "@/i18n/translate";
import { PageHeader } from "@/components/workforce/page-header";
import { AnalyticsTabs, type AnalyticsTab } from "./analytics-tabs";

export function AnalyticsHeader({ t, locale, active, title, subtitle, actions }: { t: Translate; locale: string; active: AnalyticsTab; title?: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <>
      <PageHeader title={title ?? t("modules.analytics.title")} subtitle={subtitle ?? t("analytics.subtitle")} actions={actions} />
      <AnalyticsTabs
        locale={locale}
        active={active}
        labels={{ overview: t("analytics.tabs.overview"), health: t("analytics.tabs.health"), ceo: t("analytics.tabs.ceo"), departments: t("analytics.tabs.departments"), dashboards: t("analytics.tabs.dashboards"), reports: t("analytics.tabs.reports"), ai: t("analytics.tabs.ai") }}
      />
    </>
  );
}
