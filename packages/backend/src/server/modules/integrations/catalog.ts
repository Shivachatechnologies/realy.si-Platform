/**
 * Provider catalog of the Integrations OS (pure data, safe to import from client components).
 * OAuth endpoints, token handling and connection tests live in ./providers.ts (server only).
 */

export const PROVIDER_CATEGORIES = [
  "ai",
  "research",
  "creative",
  "social",
  "ads",
  "search",
  "cms",
  "email",
  "messaging",
  "payments",
  "storage",
  "crm",
  "accounting",
  "productivity",
  "developer",
] as const;
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
  /** i18n key under integrations.fields when it differs from `key` (e.g. the apiKey of Twilio is its "authToken"). */
  labelKey?: string;
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
  /** An api_key provider that can alternatively be connected with OAuth when the platform configured the app. */
  oauthAlternative?: boolean;
  /** Settings editable after connecting (OAuth providers too); secret ones are stored encrypted with the credentials. */
  configFields?: CredentialField[];
  /** The provider exposes several selectable sub-accounts (pages, channels, ad accounts, sites...): config.accounts + config.activeAccountId. */
  multiAccount?: boolean;
}

/** A selectable sub-account of a connection, stored in config.accounts (non-secret). */
export interface ConnectionAccount {
  id: string;
  name: string;
  /** e.g. "page", "instagram", "channel", "ad_account", "site", "board", "audience", "account". */
  type: string;
}

export const PROVIDERS: ProviderInfo[] = [
  // ───────────── AI ─────────────
  {
    key: "openai",
    name: "OpenAI",
    category: "ai",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://platform.openai.com/api-keys",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "sk-…", pattern: "^sk-[A-Za-z0-9_\\-]{20,}$" },
      { key: "organization", secret: false, required: false, placeholder: "org-…", pattern: "^org-[A-Za-z0-9]{6,}$" },
      { key: "model", secret: false, required: false, placeholder: "gpt-4.1-mini", pattern: "^[A-Za-z0-9.:_-]{2,64}$" },
    ],
    capabilities: ["ai_text", "image_generation"],
  },
  {
    key: "gemini",
    name: "Google Gemini",
    category: "ai",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://ai.google.dev/gemini-api/docs/api-key",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "AIza…", pattern: "^[A-Za-z0-9_\\-]{30,}$" },
      { key: "model", secret: false, required: false, placeholder: "gemini-2.5-flash", pattern: "^[A-Za-z0-9.:_-]{2,64}$" },
    ],
    capabilities: ["ai_text"],
  },
  // ───────────── Research ─────────────
  {
    key: "tavily",
    name: "Tavily",
    category: "research",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.tavily.com/documentation/quickstart",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "tvly-…", pattern: "^tvly-[A-Za-z0-9_\\-]{10,}$" }],
    capabilities: ["research"],
  },
  {
    key: "exa",
    name: "Exa",
    category: "research",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.exa.ai/reference/getting-started",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "xxxxxxxx-xxxx-…", pattern: "^[A-Za-z0-9_\\-]{16,}$" }],
    capabilities: ["research"],
  },
  {
    key: "serpapi",
    name: "SerpApi",
    category: "research",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://serpapi.com/manage-api-key",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "64 hex characters", pattern: "^[A-Za-z0-9]{32,128}$" }],
    capabilities: ["research"],
  },
  // ───────────── Contact data (prospecting) ─────────────
  {
    key: "apollo",
    name: "Apollo.io",
    category: "research",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.apollo.io/docs/create-api-key",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "Master API key", pattern: "^[A-Za-z0-9_\\-]{16,128}$" }],
    capabilities: ["contact_data", "email_finder", "enrichment"],
  },
  {
    key: "hunter",
    name: "Hunter.io",
    category: "research",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://hunter.io/api-keys",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "40 hex characters", pattern: "^[A-Za-z0-9]{20,80}$" }],
    capabilities: ["contact_data", "email_finder", "email_verification", "enrichment"],
  },
  {
    key: "pdl",
    name: "People Data Labs",
    category: "research",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.peopledatalabs.com/docs/authentication",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "64 hex characters", pattern: "^[A-Za-z0-9]{20,128}$" }],
    capabilities: ["contact_data", "enrichment"],
  },
  // ───────────── Creative ─────────────
  {
    key: "stability",
    name: "Stability AI",
    category: "creative",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://platform.stability.ai/account/keys",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "sk-…", pattern: "^sk-[A-Za-z0-9]{20,}$" }],
    capabilities: ["image_generation"],
  },
  {
    key: "replicate",
    name: "Replicate",
    category: "creative",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://replicate.com/account/api-tokens",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "r8_…", pattern: "^r8_[A-Za-z0-9]{20,}$" },
      { key: "imageModel", secret: false, required: false, placeholder: "black-forest-labs/flux-schnell", pattern: "^[a-z0-9_.-]{1,64}/[a-z0-9_.-]{1,64}$" },
      { key: "videoModel", secret: false, required: false, placeholder: "minimax/video-01", pattern: "^[a-z0-9_.-]{1,64}/[a-z0-9_.-]{1,64}$" },
    ],
    capabilities: ["image_generation", "video_generation"],
  },
  {
    key: "runway",
    name: "Runway",
    category: "creative",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.dev.runwayml.com/guides/setup/",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "key_…", pattern: "^key_[A-Za-z0-9]{20,}$" }],
    capabilities: ["video_generation"],
  },
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
    syncKinds: ["google.calendar"],
    capabilities: ["email", "calendar", "files", "sync"],
  },
  {
    key: "microsoft",
    name: "Microsoft 365",
    category: "productivity",
    authType: "oauth2",
    scopes: ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Send", "Mail.Read", "Calendars.ReadWrite", "Team.ReadBasic.All", "ChannelMessage.Send"],
    envVars: ["OAUTH_MICROSOFT_CLIENT_ID", "OAUTH_MICROSOFT_CLIENT_SECRET"],
    docsUrl: "https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow",
    syncKinds: ["microsoft.calendar"],
    capabilities: ["email", "calendar", "chat", "workflow_actions", "sync"],
  },
  {
    key: "slack",
    name: "Slack",
    category: "messaging",
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
    category: "messaging",
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
    multiAccount: true,
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
    multiAccount: true,
  },
  {
    key: "youtube",
    name: "YouTube",
    category: "social",
    authType: "oauth2",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    envVars: ["OAUTH_GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET"],
    docsUrl: "https://developers.google.com/youtube/v3/guides/authentication",
    capabilities: ["social_publishing", "video_publishing"],
    multiAccount: true,
  },
  {
    key: "tiktok",
    name: "TikTok",
    category: "social",
    authType: "oauth2",
    scopes: ["user.info.basic", "video.upload", "video.publish", "video.list"],
    envVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    docsUrl: "https://developers.tiktok.com/doc/login-kit-web",
    capabilities: ["social_publishing", "video_publishing"],
  },
  {
    key: "threads",
    name: "Threads",
    category: "social",
    authType: "oauth2",
    scopes: ["threads_basic", "threads_content_publish", "threads_manage_insights"],
    envVars: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
    docsUrl: "https://developers.facebook.com/docs/threads/get-started",
    capabilities: ["social_publishing"],
  },
  {
    key: "pinterest",
    name: "Pinterest",
    category: "social",
    authType: "oauth2",
    scopes: ["user_accounts:read", "boards:read", "pins:read", "pins:write"],
    envVars: ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET"],
    docsUrl: "https://developers.pinterest.com/docs/getting-started/authentication-and-scopes/",
    capabilities: ["social_publishing"],
    multiAccount: true,
  },
  // ───────────── Ads ─────────────
  {
    key: "meta_ads",
    name: "Meta Ads",
    category: "ads",
    authType: "oauth2",
    scopes: ["ads_read", "ads_management", "business_management"],
    envVars: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
    docsUrl: "https://developers.facebook.com/docs/marketing-apis/get-started",
    capabilities: ["ads"],
    multiAccount: true,
  },
  {
    key: "google_ads",
    name: "Google Ads",
    category: "ads",
    authType: "oauth2",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/adwords"],
    envVars: ["OAUTH_GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
    docsUrl: "https://developers.google.com/google-ads/api/docs/get-started/introduction",
    capabilities: ["ads"],
    multiAccount: true,
    configFields: [
      { key: "developerToken", secret: true, required: false, placeholder: "22 characters", pattern: "^[A-Za-z0-9_\\-]{10,64}$" },
      { key: "loginCustomerId", secret: false, required: false, placeholder: "1234567890", pattern: "^\\d{10}$" },
    ],
  },
  {
    key: "linkedin_ads",
    name: "LinkedIn Ads",
    category: "ads",
    authType: "oauth2",
    scopes: ["r_ads", "rw_ads", "r_ads_reporting"],
    envVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    docsUrl: "https://learn.microsoft.com/linkedin/marketing/getting-started",
    capabilities: ["ads"],
    multiAccount: true,
  },
  {
    key: "tiktok_ads",
    name: "TikTok Ads",
    category: "ads",
    authType: "oauth2",
    scopes: [],
    envVars: ["TIKTOK_ADS_APP_ID", "TIKTOK_ADS_APP_SECRET"],
    docsUrl: "https://business-api.tiktok.com/portal/docs?id=1738373164380162",
    capabilities: ["ads"],
    multiAccount: true,
  },
  // ───────────── Search ─────────────
  {
    key: "google_search_console",
    name: "Google Search Console",
    category: "search",
    authType: "oauth2",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"],
    envVars: ["OAUTH_GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET"],
    docsUrl: "https://developers.google.com/webmaster-tools/v1/how-tos/authorizing",
    capabilities: ["search_analytics"],
    multiAccount: true,
  },
  // ───────────── CMS ─────────────
  {
    key: "wordpress",
    name: "WordPress",
    category: "cms",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/",
    fields: [
      { key: "siteUrl", secret: false, required: true, placeholder: "https://blog.example.com", pattern: "^https?://[^\\s/]{3,253}(/[^\\s]{0,200})?$" },
      { key: "username", secret: false, required: true, placeholder: "editor", pattern: "^[^\\s:]{1,120}$" },
      { key: "apiKey", secret: true, required: true, labelKey: "applicationPassword", placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx", pattern: "^[A-Za-z0-9 ]{16,64}$" },
    ],
    capabilities: ["cms_publishing"],
  },
  {
    key: "webflow",
    name: "Webflow",
    category: "cms",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developers.webflow.com/data/reference/authentication/site-token",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "site API token", pattern: "^[A-Za-z0-9_\\-]{20,}$" }],
    capabilities: ["cms_publishing"],
    multiAccount: true,
  },
  {
    key: "shopify",
    name: "Shopify",
    category: "cms",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
    fields: [
      { key: "shopDomain", secret: false, required: true, placeholder: "your-store.myshopify.com", pattern: "^[a-z0-9][a-z0-9-]{0,60}\\.myshopify\\.com$" },
      { key: "apiKey", secret: true, required: true, labelKey: "adminToken", placeholder: "shpat_…", pattern: "^shp(at|ca|pa)_[A-Za-z0-9]{20,}$" },
    ],
    capabilities: ["cms_publishing", "ecommerce"],
  },
  // ───────────── Email ─────────────
  {
    key: "sendgrid",
    name: "SendGrid",
    category: "email",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "SG.…", pattern: "^SG\\.[A-Za-z0-9_\\-.]{20,}$" },
      { key: "fromEmail", secret: false, required: true, placeholder: "hello@example.com", pattern: "^[^\\s@]{1,64}@[^\\s@]{1,190}\\.[^\\s@]{2,}$" },
      { key: "fromName", secret: false, required: false, placeholder: "Example Inc." },
    ],
    capabilities: ["email_sending"],
  },
  {
    key: "mailchimp",
    name: "Mailchimp",
    category: "email",
    authType: "api_key",
    oauthAlternative: true,
    scopes: [],
    envVars: ["MAILCHIMP_CLIENT_ID", "MAILCHIMP_CLIENT_SECRET"],
    docsUrl: "https://mailchimp.com/developer/marketing/guides/quick-start/",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "…-us21", pattern: "^[a-f0-9]{32}-[a-z]{2,4}\\d{1,3}$" },
      { key: "serverPrefix", secret: false, required: false, placeholder: "us21", pattern: "^[a-z]{2,4}\\d{1,3}$" },
    ],
    capabilities: ["email_marketing"],
    multiAccount: true,
  },
  // ───────────── Messaging ─────────────
  {
    key: "twilio",
    name: "Twilio",
    category: "messaging",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://www.twilio.com/docs/iam/api/authtoken",
    fields: [
      { key: "accountSid", secret: false, required: true, placeholder: "AC…", pattern: "^AC[a-f0-9]{32}$" },
      { key: "apiKey", secret: true, required: true, labelKey: "authToken", placeholder: "32 hex characters", pattern: "^[a-f0-9]{32}$" },
      { key: "fromNumber", secret: false, required: false, placeholder: "+15551234567 or MG…", pattern: "^(\\+[1-9]\\d{6,14}|MG[a-f0-9]{32})$" },
      { key: "whatsappFrom", secret: false, required: false, placeholder: "+15551234567", pattern: "^\\+[1-9]\\d{6,14}$" },
    ],
    capabilities: ["sms", "chat"],
  },
  // ───────────── Voice (AI phone team, src/server/modules/voice) ─────────────
  {
    key: "vapi",
    name: "Vapi",
    category: "messaging",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.vapi.ai/api-reference",
    fields: [{ key: "apiKey", secret: true, required: true, labelKey: "privateApiKey", placeholder: "Private API key", pattern: "^[A-Za-z0-9_\\-]{20,}$" }],
    capabilities: ["voice_calls"],
  },
  {
    key: "retell",
    name: "Retell AI",
    category: "messaging",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.retellai.com/api-references/list-agents",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "key_…", pattern: "^[A-Za-z0-9_\\-]{16,}$" }],
    capabilities: ["voice_calls"],
  },
  {
    key: "razorpay",
    name: "Razorpay",
    category: "payments",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://razorpay.com/docs/api/authentication/",
    fields: [
      { key: "keyId", secret: false, required: true, placeholder: "rzp_live_…", pattern: "^rzp_(live|test)_[A-Za-z0-9]{10,}$" },
      { key: "apiKey", secret: true, required: true, labelKey: "keySecret", placeholder: "…", pattern: "^[A-Za-z0-9]{16,64}$" },
    ],
    capabilities: ["payments"],
  },
  // ───────────── Storage / infra ─────────────
  {
    key: "s3",
    name: "S3-compatible storage",
    category: "storage",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
    fields: [
      { key: "endpoint", secret: false, required: false, placeholder: "https://<account>.r2.cloudflarestorage.com", pattern: "^https://[^\\s/]{3,253}/?$" },
      { key: "region", secret: false, required: true, placeholder: "eu-central-1 / auto", pattern: "^[a-z0-9-]{2,40}$" },
      { key: "bucket", secret: false, required: true, placeholder: "my-bucket", pattern: "^[a-z0-9][a-z0-9.\\-]{1,61}[a-z0-9]$" },
      { key: "accessKeyId", secret: false, required: true, placeholder: "AKIA…", pattern: "^[A-Za-z0-9]{16,128}$" },
      { key: "apiKey", secret: true, required: true, labelKey: "secretAccessKey", placeholder: "…", pattern: "^[A-Za-z0-9/+=]{16,128}$" },
    ],
    capabilities: ["storage"],
  },
  {
    key: "cloudflare",
    name: "Cloudflare",
    category: "storage",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
    fields: [
      { key: "apiKey", secret: true, required: true, labelKey: "apiToken", placeholder: "…", pattern: "^[A-Za-z0-9_\\-]{30,}$" },
      { key: "accountId", secret: false, required: false, placeholder: "32 hex characters", pattern: "^[a-f0-9]{32}$" },
    ],
    capabilities: ["infrastructure", "storage"],
    multiAccount: true,
  },
  {
    key: "quickbooks",
    name: "QuickBooks Online",
    category: "accounting",
    authType: "oauth2",
    scopes: ["com.intuit.quickbooks.accounting"],
    envVars: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"],
    docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0",
    syncKinds: ["quickbooks.customers", "quickbooks.invoices"],
    capabilities: ["accounting", "sync"],
  },
  {
    key: "xero",
    name: "Xero",
    category: "accounting",
    authType: "oauth2",
    scopes: ["openid", "profile", "email", "offline_access", "accounting.transactions", "accounting.contacts"],
    envVars: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
    docsUrl: "https://developer.xero.com/documentation/guides/oauth2/auth-flow",
    syncKinds: ["xero.contacts", "xero.invoices"],
    capabilities: ["accounting", "sync"],
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
