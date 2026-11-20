import type { ToolDefinition } from "./define";
import { MARKETING_TOOLS } from "@/server/modules/marketing/ai-tools";
import { FINANCE_TOOLS } from "@/server/modules/finance/ai-tools";
import { HR_TOOLS } from "@/server/modules/hr/ai-tools";
import { WORK_TOOLS } from "@/server/modules/work/ai-tools";
import { COMMS_TOOLS } from "@/server/modules/comms/ai-tools";
import { SUPPORT_TOOLS } from "@/server/modules/support/ai-tools";
import { AUTOMATION_TOOLS } from "@/server/modules/automation/ai-tools";
import { INTEGRATIONS_TOOLS } from "@/server/modules/integrations/ai-tools";
import { WORKFORCE_TOOLS } from "@/server/modules/workforce/ai-tools";
import { BI_TOOLS } from "@/server/modules/bi/ai-tools";
import { MARKETPLACE_TOOLS } from "@/server/modules/marketplace/ai-tools";
import { ENTERPRISE_TOOLS } from "@/server/modules/enterprise/ai-tools";
import { CRM_TOOLS } from "@/server/modules/crm/ai-tools";

/** Tool groups contributed by business modules. A function so module evaluation order never matters. */
export const MODULE_TOOLS = (): Record<string, ToolDefinition>[] => [MARKETING_TOOLS, FINANCE_TOOLS, HR_TOOLS, WORK_TOOLS, COMMS_TOOLS, SUPPORT_TOOLS, AUTOMATION_TOOLS, INTEGRATIONS_TOOLS, WORKFORCE_TOOLS, BI_TOOLS, MARKETPLACE_TOOLS, ENTERPRISE_TOOLS, CRM_TOOLS];
