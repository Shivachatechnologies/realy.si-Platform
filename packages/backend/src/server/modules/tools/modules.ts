import type { ToolDefinition } from "./define";

/**
 * Tool groups contributed by business modules. Loaded with dynamic imports: module tool files import their services,
 * which import the gateway, which needs this registry — static imports here would form evaluation cycles.
 */
export const MODULE_TOOLS = (): Promise<Record<string, ToolDefinition>[]> =>
  Promise.all([
    import("@/server/modules/brain/ai-tools").then((m) => m.BRAIN_TOOLS),
    import("@/server/modules/marketing/ai-tools").then((m) => m.MARKETING_TOOLS),
    import("@/server/modules/finance/ai-tools").then((m) => m.FINANCE_TOOLS),
    import("@/server/modules/hr/ai-tools").then((m) => m.HR_TOOLS),
    import("@/server/modules/work/ai-tools").then((m) => m.WORK_TOOLS),
    import("@/server/modules/comms/ai-tools").then((m) => m.COMMS_TOOLS),
    import("@/server/modules/support/ai-tools").then((m) => m.SUPPORT_TOOLS),
    import("@/server/modules/automation/ai-tools").then((m) => m.AUTOMATION_TOOLS),
    import("@/server/modules/integrations/ai-tools").then((m) => m.INTEGRATIONS_TOOLS),
    import("@/server/modules/workforce/ai-tools").then((m) => m.WORKFORCE_TOOLS),
    import("@/server/modules/bi/ai-tools").then((m) => m.BI_TOOLS),
    import("@/server/modules/marketplace/ai-tools").then((m) => m.MARKETPLACE_TOOLS),
    import("@/server/modules/enterprise/ai-tools").then((m) => m.ENTERPRISE_TOOLS),
    import("@/server/modules/crm/ai-tools").then((m) => m.CRM_TOOLS),
    import("@/server/modules/livechat/ai-tools").then((m) => m.LIVECHAT_TOOLS),
    import("@/server/modules/briefing/ai-tools").then((m) => m.BRIEFING_TOOLS),
    import("@/server/modules/voice/ai-tools").then((m) => m.VOICE_TOOLS),
    import("@/server/modules/sites/ai-tools").then((m) => m.SITES_TOOLS),
  ]);
