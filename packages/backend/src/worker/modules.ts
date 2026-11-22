import type { ModuleJobs } from "@/server/core/module-jobs";
import { BUILDER_JOBS } from "@/server/modules/builder/jobs";
import { BRAIN_JOBS } from "@/server/modules/brain/jobs";
import { MARKETING_JOBS } from "@/server/modules/marketing/jobs";
import { FINANCE_JOBS } from "@/server/modules/finance/jobs";
import { HR_JOBS } from "@/server/modules/hr/jobs";
import { WORK_JOBS } from "@/server/modules/work/jobs";
import { COMMS_JOBS } from "@/server/modules/comms/jobs";
import { SUPPORT_JOBS } from "@/server/modules/support/jobs";
import { AUTOMATION_JOBS } from "@/server/modules/automation/jobs";
import { INTEGRATIONS_JOBS } from "@/server/modules/integrations/jobs";
import { WORKFORCE_JOBS } from "@/server/modules/workforce/jobs";
import { BI_JOBS } from "@/server/modules/bi/jobs";
import { MARKETPLACE_JOBS } from "@/server/modules/marketplace/jobs";
import { ENTERPRISE_JOBS } from "@/server/modules/enterprise/jobs";
import { CRM_JOBS } from "@/server/modules/crm/jobs";
import { LIVECHAT_JOBS } from "@/server/modules/livechat/jobs";
import { BRIEFING_JOBS } from "@/server/modules/briefing/jobs";
import { VOICE_JOBS } from "@/server/modules/voice/jobs";
import { COSTS_JOBS } from "@/server/modules/costs/jobs";
import { CREATIVE_JOBS } from "@/server/modules/creative/jobs";
import { SITES_JOBS } from "@/server/modules/sites/jobs";
// Control Center stream B (people/RBAC): one DB-only job every 15 min.
import { PEOPLE_JOBS } from "@/server/modules/admin/jobs-people";
// Control Center stream C: hourly AI request log retention (DB only).
import { ADMIN_C_JOBS } from "@/server/modules/admin/ai-jobs";
// Control Center stream D: MRR snapshot 6 h, daily metrics 1 h, credit ledger 6 h, dispute deadlines 6 h (DB only).
import { BILLING_JOBS } from "@/server/modules/billing/jobs";

/** Background work contributed by business modules. */
export const MODULE_JOBS: ModuleJobs[] = [BUILDER_JOBS, BRAIN_JOBS, MARKETING_JOBS, FINANCE_JOBS, HR_JOBS, WORK_JOBS, COMMS_JOBS, SUPPORT_JOBS, AUTOMATION_JOBS, INTEGRATIONS_JOBS, WORKFORCE_JOBS, BI_JOBS, MARKETPLACE_JOBS, ENTERPRISE_JOBS, CRM_JOBS, LIVECHAT_JOBS, BRIEFING_JOBS, VOICE_JOBS, SITES_JOBS, COSTS_JOBS, CREATIVE_JOBS, PEOPLE_JOBS, ADMIN_C_JOBS, BILLING_JOBS];
