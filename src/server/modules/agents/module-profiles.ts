import type { AgentProfile } from "./profile-types";
import { MARKETING_PROFILES } from "@/server/modules/marketing/ai-profiles";
import { FINANCE_PROFILES } from "@/server/modules/finance/ai-profiles";
import { HR_PROFILES } from "@/server/modules/hr/ai-profiles";
import { WORK_PROFILES } from "@/server/modules/work/ai-profiles";
import { COMMS_PROFILES } from "@/server/modules/comms/ai-profiles";
import { SUPPORT_PROFILES } from "@/server/modules/support/ai-profiles";
import { AUTOMATION_PROFILES } from "@/server/modules/automation/ai-profiles";
import { INTEGRATIONS_PROFILES } from "@/server/modules/integrations/ai-profiles";
import { WORKFORCE_PROFILES } from "@/server/modules/workforce/ai-profiles";
import { BI_PROFILES } from "@/server/modules/bi/ai-profiles";
import { MARKETPLACE_PROFILES } from "@/server/modules/marketplace/ai-profiles";
import { ENTERPRISE_PROFILES } from "@/server/modules/enterprise/ai-profiles";
import { CRM_PROFILES } from "@/server/modules/crm/ai-profiles";

/** AI employee profiles contributed by business modules. */
export const MODULE_PROFILES: AgentProfile[] = [...MARKETING_PROFILES, ...FINANCE_PROFILES, ...HR_PROFILES, ...WORK_PROFILES, ...COMMS_PROFILES, ...SUPPORT_PROFILES, ...AUTOMATION_PROFILES, ...INTEGRATIONS_PROFILES, ...WORKFORCE_PROFILES, ...BI_PROFILES, ...MARKETPLACE_PROFILES, ...ENTERPRISE_PROFILES, ...CRM_PROFILES];
