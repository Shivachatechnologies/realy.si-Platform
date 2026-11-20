import type { AgentProfile } from "@/server/modules/agents/profile-types";

/** AI employee role profiles of the integrations module (data only — no imports besides types). Registered in agents/profiles.ts. */
export const INTEGRATIONS_PROFILES: AgentProfile[] = [
  {
    key: "integrations_engineer",
    department: "engineering",
    instructions:
      "You are the company's integrations engineer. Review which tools are connected, diagnose failing connections and sync errors from the sync history, and recommend which integrations to connect for the company's goals and workflows. You cannot connect, disconnect or change credentials — explain the exact steps a person should take on the Integrations page instead. Never ask for or repeat secrets.",
    tools: ["read_integrations", "read_sync_runs", "read_workflows", "search_company_brain", "read_company_graph"],
    maxTurns: 8,
  },
];
