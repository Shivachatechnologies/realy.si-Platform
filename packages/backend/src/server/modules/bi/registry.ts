import type { MetricDefinition } from "@/server/core/metrics";
import { MARKETING_METRICS } from "@/server/modules/marketing/metrics";
import { FINANCE_METRICS } from "@/server/modules/finance/metrics";
import { HR_METRICS } from "@/server/modules/hr/metrics";
import { WORK_METRICS } from "@/server/modules/work/metrics";
import { COMMS_METRICS } from "@/server/modules/comms/metrics";
import { SUPPORT_METRICS } from "@/server/modules/support/metrics";
import { AUTOMATION_METRICS } from "@/server/modules/automation/metrics";
import { INTEGRATIONS_METRICS } from "@/server/modules/integrations/metrics";
import { WORKFORCE_METRICS } from "@/server/modules/workforce/metrics";
import { BI_METRICS } from "@/server/modules/bi/metrics";
import { MARKETPLACE_METRICS } from "@/server/modules/marketplace/metrics";
import { ENTERPRISE_METRICS } from "@/server/modules/enterprise/metrics";
import { CRM_METRICS } from "@/server/modules/crm/metrics";
import { LIVECHAT_METRICS } from "@/server/modules/livechat/metrics";
import { VOICE_METRICS } from "@/server/modules/voice/metrics";

/** Every module's KPIs. */
export const ALL_METRICS = (): MetricDefinition[] => [...MARKETING_METRICS, ...FINANCE_METRICS, ...HR_METRICS, ...WORK_METRICS, ...COMMS_METRICS, ...SUPPORT_METRICS, ...AUTOMATION_METRICS, ...INTEGRATIONS_METRICS, ...WORKFORCE_METRICS, ...BI_METRICS, ...MARKETPLACE_METRICS, ...ENTERPRISE_METRICS, ...CRM_METRICS, ...LIVECHAT_METRICS, ...VOICE_METRICS];
export const metricByKey = (key: string) => ALL_METRICS().find((m) => m.key === key);
