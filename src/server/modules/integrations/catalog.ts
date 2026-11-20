/**
 * Provider catalog of the Integrations OS (pure data, safe to import from client components).
 * OAuth endpoints, token handling and connection tests live in ./providers.ts (server only).
 */

export const PROVIDER_CATEGORIES = ["productivity", "communication", "payments", "crm", "social", "accounting", "developer"] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

export type AuthType = "oauth2" | "api_key" | "none";

/** A field of an API-key setup form. Secret fields are encrypted at rest and never shown again. */
export interface CredentialField {
  key: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  /** Regex the value must match (checked on the server). */
  pattern?: string;
}

export interface ProviderInfo {
  key: string;
  name: string;
  category: ProviderCategory;
  authType: AuthType;
  scopes: string[];
  /** Environment variables the platform admin must set (OAuth app credentials). */
  envVars: string[];
  docsUrl: string;
  /** API-key setup form fields (authType "api_key"). */
  fields?: CredentialField[];
  /** Sync kinds this provider supports (see ./sync.ts). */
  syncKinds?: string[];
  /** Workflow actions / platform features this provider powers (i18n keys under integrations.capabilities). */
  capabilities: string[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    key: "google",
    name: "Google Workspace",
    category: "productivity",
    authType: "oauth2",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
    envVars: ["OAUTH_GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET"],
    docsUrl: "https://developers.google.com/identity/protocols/oauth2/web-server",
    capabilities: ["email", "calendar", "files"],
  },
  {
    key: "microsoft",
    name: "Microsoft 365",
    category: "productivity",
    authType: "oauth2",
    scopes: ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Send", "Mail.Read", "Calendars.ReadWrite", "Team.ReadBasic.All", "ChannelMessage.Send"],
    envVars: ["OAUTH_MICROSOFT_CLIENT_ID", "OAUTH_MICROSOFT_CLIENT_SECRET"],
    docsUrl: "https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow",
    capabilities: ["email", "calendar", "chat"],
  },
  {
    key: "slack",
    name: "Slack",
    category: "communication",
    authType: "oauth2",
    scopes: ["chat:write", "chat:write.public", "channels:read", "users:read"],
    envVars: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    docsUrl: "https://api.slack.com/authentication/oauth-v2",
    capabilities: ["chat", "workflow_actions"],
  },
  {
    key: "stripe",
    name: "Stripe",
    category: "payments",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.stripe.com/keys",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "rk_live_… / sk_live_…", pattern: "^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$" }],
    syncKinds: ["stripe.payments"],
    capabilities: ["payments", "sync"],
  },
  {
    key: "whatsapp",
    name: "WhatsApp Business",
    category: "communication",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "EAAG…" },
      { key: "phoneNumberId", secret: false, required: true, placeholder: "1234567890", pattern: "^\\d{5,25}$" },
      { key: "businessAccountId", secret: false, required: false, placeholder: "1234567890", pattern: "^\\d{5,25}$" },
    ],
    capabilities: ["chat"],
  },
  {
    key: "hubspot",
    name: "HubSpot",
    category: "crm",
    authType: "oauth2",
    scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.companies.read"],
    envVars: ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"],
    docsUrl: "https://developers.hubspot.com/docs/api/oauth-quickstart-guide",
    syncKinds: ["hubspot.contacts"],
    capabilities: ["contacts", "sync"],
  },
  {
    key: "salesforce",
    name: "Salesforce",
    category: "crm",
    authType: "oauth2",
    scopes: ["api", "refresh_token"],
    envVars: ["SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET"],
    docsUrl: "https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm",
    syncKinds: ["salesforce.contacts"],
    capabilities: ["contacts", "sync"],
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    category: "social",
    authType: "oauth2",
    scopes: ["openid", "profile", "email", "w_member_social"],
    envVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    docsUrl: "https://learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow",
    capabilities: ["social_publishing"],
  },
  {
    key: "x",
    name: "X (Twitter)",
    category: "social",
    authType: "oauth2",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    envVars: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    docsUrl: "https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code",
    capabilities: ["social_publishing"],
  },
  {
    key: "facebook",
    name: "Facebook Pages",
    category: "social",
    authType: "oauth2",
    scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"],
    envVars: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
    docsUrl: "https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow",
    capabilities: ["social_publishing"],
  },
  {
    key: "instagram",
    name: "Instagram",
    category: "social",
    authType: "oauth2",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
    envVars: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api",
    capabilities: ["social_publishing"],
  },
  {
    key: "quickbooks",
    name: "QuickBooks Online",
    category: "accounting",
    authType: "oauth2",
    scopes: ["com.intuit.quickbooks.accounting"],
    envVars: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"],
    docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0",
    capabilities: ["accounting"],
  },
  {
    key: "xero",
    name: "Xero",
    category: "accounting",
    authType: "oauth2",
    scopes: ["openid", "profile", "email", "offline_access", "accounting.transactions", "accounting.contacts"],
    envVars: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
    docsUrl: "https://developer.xero.com/documentation/guides/oauth2/auth-flow",
    capabilities: ["accounting"],
  },
  {
    key: "webhook",
    name: "Incoming webhooks",
    category: "developer",
    authType: "none",
    scopes: [],
    envVars: [],
    docsUrl: "https://en.wikipedia.org/wiki/Webhook",
    capabilities: ["webhooks", "workflow_triggers"],
  },
  {
    key: "custom_api",
    name: "Custom API",
    category: "developer",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developer.mozilla.org/docs/Web/HTTP/Authentication",
    fields: [
      { key: "baseUrl", secret: false, required: true, placeholder: "https://api.example.com", pattern: "^https://[^\\s]{3,500}$" },
      { key: "headerName", secret: false, required: true, placeholder: "Authorization", pattern: "^[A-Za-z0-9-]{1,64}$" },
      { key: "headerPrefix", secret: false, required: false, placeholder: "Bearer" },
      { key: "apiKey", secret: true, required: true, placeholder: "…" },
      { key: "testPath", secret: false, required: false, placeholder: "/v1/me", pattern: "^/[^\\s]{0,300}$" },
    ],
    capabilities: ["workflow_actions"],
  },
];

export const PROVIDER_KEYS = PROVIDERS.map((p) => p.key);
export const providerInfo = (key: string): ProviderInfo | undefined => PROVIDERS.find((p) => p.key === key);
