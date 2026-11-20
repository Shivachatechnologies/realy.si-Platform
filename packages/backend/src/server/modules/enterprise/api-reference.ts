/** Public /api/v1 endpoints documented on Settings → Developers → API reference (descriptions: enterprise.api.endpoints.<id>). */
export interface ApiEndpoint {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  permission: string;
}

export const API_REFERENCE: { group: string; endpoints: ApiEndpoint[] }[] = [
  {
    group: "organization",
    endpoints: [
      {
        id: "listCompanies",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies",
        permission: "companies.read",
      },
      {
        id: "createCompany",
        method: "POST",
        path: "/api/v1/organizations/{orgId}/companies",
        permission: "companies.manage",
      },
      {
        id: "listMembers",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/members",
        permission: "users.read",
      },
      {
        id: "listRoles",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/roles",
        permission: "roles.read",
      },
      {
        id: "auditLogs",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/enterprise/audit",
        permission: "audit.read",
      },
      {
        id: "usage",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/enterprise/usage",
        permission: "organizations.read",
      },
    ],
  },
  {
    group: "company",
    endpoints: [
      {
        id: "companyProfile",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/enterprise/profile",
        permission: "companies.read",
      },
      {
        id: "workspaces",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/enterprise/workspaces",
        permission: "workspaces.read",
      },
      {
        id: "objectives",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/objectives",
        permission: "objectives.read",
      },
      {
        id: "createObjective",
        method: "POST",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/objectives",
        permission: "objectives.manage",
      },
      {
        id: "graph",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/graph",
        permission: "graph.read",
      },
      {
        id: "brainSearch",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/brain/search?q=",
        permission: "brain.read",
      },
      {
        id: "export",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/enterprise/export",
        permission: "organizations.manage",
      },
    ],
  },
  {
    group: "crm",
    endpoints: [
      {
        id: "listLeads",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/leads",
        permission: "sales.read",
      },
      {
        id: "createLead",
        method: "POST",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/leads",
        permission: "sales.manage",
      },
      {
        id: "updateLead",
        method: "PATCH",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/leads/{leadId}",
        permission: "sales.manage",
      },
    ],
  },
  {
    group: "ai",
    endpoints: [
      {
        id: "listTasks",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/tasks",
        permission: "agents.read",
      },
      {
        id: "createTask",
        method: "POST",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/tasks",
        permission: "agents.run",
      },
      {
        id: "approvals",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/approvals",
        permission: "approvals.read",
      },
    ],
  },
  {
    group: "marketplace",
    endpoints: [
      {
        id: "searchListings",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/marketplace/listings?q=&type=&category=&sort=",
        permission: "marketplace.read",
      },
      {
        id: "installations",
        method: "GET",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/marketplace/installations",
        permission: "marketplace.read",
      },
      {
        id: "install",
        method: "POST",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/marketplace/installations",
        permission: "marketplace.install",
      },
      {
        id: "upgrade",
        method: "POST",
        path: "/api/v1/organizations/{orgId}/companies/{companyId}/marketplace/installations/{installationId}/upgrade",
        permission: "marketplace.install",
      },
    ],
  },
];
