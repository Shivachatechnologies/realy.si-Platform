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
  "voice",
  "video",
  "telephony",
  "support",
  "finance",
  "automation",
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
  /**
   * "awaiting_docs": the adapter is not live yet (no public API-key access, or the official API needs a partner
   * agreement / certificate flow Realy has not implemented). Shown honestly; it cannot be connected.
   */
  availability?: "awaiting_docs";
  /**
   * "config_only": the provider has no API that can prove the credentials (e.g. a SIP trunk); the connection test only
   * validates the configuration (host resolves publicly), so the marketplace shows "Configured" rather than "Verified".
   */
  verification?: "config_only";
  /**
   * The provider sends webhooks / status callbacks to Realy at the connection's provider-webhook URL
   * (/api/v1/integrations/webhooks/<provider>/<connectionId>/<token>), verified with the given scheme.
   */
  inboundWebhooks?: { scheme: "token" | "TWILIO" | "CALENDLY" | "META" | "ELEVENLABS" | "PLAID" | "ZENDESK" | "INTERCOM"; events: string[] };
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
    capabilities: ["ai_text", "image_generation", "speech_to_text", "text_to_speech"],
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
  // Speech (Realy Voice OS, modules/voiceos): speech-to-text and text-to-speech for the voice console.
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
    configFields: [{ key: "appSecret", secret: true, required: false, placeholder: "Meta app secret", pattern: "^[a-f0-9]{32}$" }],
    capabilities: ["chat"],
    inboundWebhooks: { scheme: "META", events: ["messages", "message_status"] },
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
    inboundWebhooks: { scheme: "TWILIO", events: ["message.status"] },
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

  // ───────────── AI (OpenAI-compatible gateways) ─────────────
  {
    key: "openrouter",
    name: "OpenRouter",
    category: "ai",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://openrouter.ai/docs/api-reference/authentication",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "sk-or-v1-…", pattern: "^sk-or-[A-Za-z0-9_\\-]{20,}$" },
      { key: "model", secret: false, required: false, placeholder: "openai/gpt-4.1-mini", pattern: "^[A-Za-z0-9._:/-]{2,100}$" },
    ],
    capabilities: ["ai_text"],
  },
  {
    key: "openai_compatible",
    name: "OpenAI-compatible API",
    category: "ai",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    fields: [
      { key: "baseUrl", secret: false, required: true, placeholder: "https://api.together.xyz/v1", pattern: "^https://[^\\s]{3,300}$" },
      { key: "apiKey", secret: true, required: true, placeholder: "…", pattern: "^[^\\s]{8,400}$" },
      { key: "model", secret: false, required: true, placeholder: "meta-llama/Llama-3.3-70B-Instruct-Turbo", pattern: "^[A-Za-z0-9._:/-]{2,100}$" },
    ],
    capabilities: ["ai_text"],
  },
  // ───────────── Voice & audio ─────────────
  {
    key: "elevenlabs",
    name: "ElevenLabs",
    category: "voice",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://elevenlabs.io/docs/api-reference/authentication",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "sk_…", pattern: "^[A-Za-z0-9_\\-]{20,128}$" },
      { key: "defaultVoiceId", secret: false, required: false, placeholder: "21m00Tcm4TlvDq8ikWAM", pattern: "^[A-Za-z0-9]{10,40}$" },
    ],
    configFields: [
      { key: "webhookSecret", secret: true, required: false, placeholder: "wsec_…", pattern: "^[^\\s]{8,200}$" },
      { key: "voiceId", secret: false, required: false, placeholder: "21m00Tcm4TlvDq8ikWAM", pattern: "^[A-Za-z0-9]{10,40}$" },
    ],
    capabilities: ["speech_synthesis", "text_to_speech", "voice_library", "speech_to_text"],
    inboundWebhooks: { scheme: "ELEVENLABS", events: ["speech_to_text_transcription", "post_call_transcription"] },
  },
  {
    key: "deepgram",
    name: "Deepgram",
    category: "voice",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developers.deepgram.com/docs/create-additional-api-keys",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "40 hex characters", pattern: "^[A-Za-z0-9]{32,64}$" },
      { key: "model", secret: false, required: false, placeholder: "nova-3", pattern: "^[a-z0-9.-]{2,40}$" },
    ],
    capabilities: ["speech_to_text"],
    inboundWebhooks: { scheme: "token", events: ["transcription.callback"] },
  },
  // ───────────── Video generation & rendering ─────────────
  {
    key: "jamendo",
    name: "Jamendo Music",
    category: "video",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://devportal.jamendo.com/",
    fields: [{ key: "apiKey", secret: true, required: true, labelKey: "clientId", placeholder: "Client ID", pattern: "^[A-Za-z0-9]{6,64}$" }],
    capabilities: ["licensed_music"],
  },
  {
    key: "luma",
    name: "Luma Dream Machine",
    category: "video",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.lumalabs.ai/docs/api",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "luma-…", pattern: "^[A-Za-z0-9_\\-]{20,200}$" },
      { key: "videoModel", secret: false, required: false, placeholder: "ray-2", pattern: "^[a-z0-9.-]{2,40}$" },
    ],
    capabilities: ["video_generation", "image_generation"],
    inboundWebhooks: { scheme: "token", events: ["generation.completed", "generation.failed"] },
  },
  {
    key: "kling",
    name: "Kling AI",
    category: "video",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://app.klingai.com/global/dev/document-api/apiReference/commonInfo",
    fields: [
      { key: "accessKey", secret: false, required: true, placeholder: "Access Key", pattern: "^[A-Za-z0-9]{16,64}$" },
      { key: "apiKey", secret: true, required: true, labelKey: "secretKey", placeholder: "Secret Key", pattern: "^[A-Za-z0-9]{16,64}$" },
      { key: "baseUrl", secret: false, required: false, placeholder: "https://api-singapore.klingai.com", pattern: "^https://api(-[a-z]+)?\\.klingai\\.com/?$" },
    ],
    capabilities: ["video_generation"],
    inboundWebhooks: { scheme: "token", events: ["task.succeed", "task.failed"] },
  },
  {
    key: "shotstack",
    name: "Shotstack",
    category: "video",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://shotstack.io/docs/guide/getting-started/core-concepts/",
    fields: [
      { key: "apiKey", secret: true, required: true, placeholder: "40 characters", pattern: "^[A-Za-z0-9]{20,64}$" },
      { key: "environment", secret: false, required: true, placeholder: "stage / v1", pattern: "^(stage|v1)$" },
    ],
    capabilities: ["video_rendering"],
    inboundWebhooks: { scheme: "token", events: ["render.done", "render.failed"] },
  },
  {
    key: "creatomate",
    name: "Creatomate",
    category: "video",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://creatomate.com/docs/api/introduction",
    fields: [{ key: "apiKey", secret: true, required: true, placeholder: "Project API key", pattern: "^[A-Za-z0-9]{20,128}$" }],
    capabilities: ["video_rendering", "image_generation"],
    inboundWebhooks: { scheme: "token", events: ["render.succeeded", "render.failed"] },
  },
  // ───────────── Telephony ─────────────
  {
    key: "twilio_voice",
    name: "Twilio Voice",
    category: "telephony",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://www.twilio.com/docs/voice/api",
    fields: [
      { key: "accountSid", secret: false, required: true, placeholder: "AC…", pattern: "^AC[a-f0-9]{32}$" },
      { key: "apiKey", secret: true, required: true, labelKey: "authToken", placeholder: "32 hex characters", pattern: "^[a-f0-9]{32}$" },
      { key: "fromNumber", secret: false, required: false, placeholder: "+15551234567", pattern: "^\\+[1-9]\\d{6,14}$" },
    ],
    capabilities: ["voice_calls", "phone_numbers", "call_recordings"],
    multiAccount: true,
    inboundWebhooks: { scheme: "TWILIO", events: ["call.status", "recording.completed"] },
  },
  {
    key: "sip_trunk",
    name: "SIP trunk",
    category: "telephony",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://datatracker.ietf.org/doc/html/rfc3261",
    fields: [
      { key: "sipDomain", secret: false, required: true, placeholder: "sip.example-carrier.com", pattern: "^(?=.{3,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$" },
      { key: "username", secret: false, required: true, placeholder: "trunk-user", pattern: "^[A-Za-z0-9_.+\\-]{1,64}$" },
      { key: "apiKey", secret: true, required: true, labelKey: "sipPassword", placeholder: "…", pattern: "^[^\\s]{6,128}$" },
      { key: "transport", secret: false, required: false, placeholder: "udp / tcp / tls", pattern: "^(udp|tcp|tls)$" },
      { key: "callerId", secret: false, required: false, placeholder: "+15551234567", pattern: "^\\+[1-9]\\d{6,14}$" },
    ],
    capabilities: ["sip_trunking", "voice_calls"],
    verification: "config_only",
  },
  // ───────────── Business apps ─────────────
  {
    key: "pipedrive",
    name: "Pipedrive",
    category: "crm",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://pipedrive.readme.io/docs/how-to-find-the-api-token",
    fields: [{ key: "apiKey", secret: true, required: true, labelKey: "apiToken", placeholder: "40 hex characters", pattern: "^[a-f0-9]{40}$" }],
    syncKinds: ["pipedrive.persons"],
    capabilities: ["contacts", "sync"],
  },
  {
    key: "notion",
    name: "Notion",
    category: "productivity",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developers.notion.com/docs/create-a-notion-integration",
    fields: [{ key: "apiKey", secret: true, required: true, labelKey: "integrationSecret", placeholder: "ntn_… / secret_…", pattern: "^(ntn_|secret_)[A-Za-z0-9]{20,}$" }],
    capabilities: ["notes_docs", "workflow_actions"],
  },
  {
    key: "clickup",
    name: "ClickUp",
    category: "productivity",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developer.clickup.com/docs/authentication",
    fields: [{ key: "apiKey", secret: true, required: true, labelKey: "apiToken", placeholder: "pk_…", pattern: "^pk_[A-Za-z0-9_]{20,}$" }],
    capabilities: ["tasks", "workflow_actions"],
    multiAccount: true,
  },
  {
    key: "calendly",
    name: "Calendly",
    category: "productivity",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developer.calendly.com/how-to-authenticate-with-personal-access-tokens",
    fields: [{ key: "apiKey", secret: true, required: true, labelKey: "personalAccessToken", placeholder: "eyJ…", pattern: "^[A-Za-z0-9_\\-.]{40,4000}$" }],
    syncKinds: ["calendly.events"],
    capabilities: ["scheduling", "meetings", "sync"],
    inboundWebhooks: { scheme: "CALENDLY", events: ["invitee.created", "invitee.canceled"] },
  },
  {
    key: "google_drive",
    name: "Google Drive",
    category: "productivity",
    authType: "oauth2",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.metadata.readonly"],
    envVars: ["OAUTH_GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET"],
    docsUrl: "https://developers.google.com/drive/api/guides/about-auth",
    capabilities: ["files", "storage"],
  },
  // ───────────── Customer support ─────────────
  {
    key: "zendesk",
    name: "Zendesk",
    category: "support",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developer.zendesk.com/api-reference/introduction/security-and-auth/",
    fields: [
      { key: "subdomain", secret: false, required: true, placeholder: "yourcompany", pattern: "^[a-z0-9][a-z0-9-]{0,62}$" },
      { key: "email", secret: false, required: true, placeholder: "agent@example.com", pattern: "^[^\\s@]{1,64}@[^\\s@]{1,190}\\.[^\\s@]{2,}$" },
      { key: "apiKey", secret: true, required: true, labelKey: "apiToken", placeholder: "…", pattern: "^[A-Za-z0-9]{20,80}$" },
    ],
    configFields: [{ key: "webhookSecret", secret: true, required: false, placeholder: "Webhook signing secret", pattern: "^[^\\s]{8,200}$" }],
    capabilities: ["support_tickets"],
    inboundWebhooks: { scheme: "ZENDESK", events: ["ticket.created", "ticket.updated"] },
  },
  {
    key: "intercom",
    name: "Intercom",
    category: "support",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developers.intercom.com/docs/build-an-integration/learn-more/authentication",
    fields: [{ key: "apiKey", secret: true, required: true, labelKey: "accessToken", placeholder: "dG9r…", pattern: "^[A-Za-z0-9=_\\-:]{20,200}$" }],
    configFields: [{ key: "webhookSecret", secret: true, required: false, placeholder: "App client secret", pattern: "^[^\\s]{8,200}$" }],
    capabilities: ["support_tickets", "chat"],
    inboundWebhooks: { scheme: "INTERCOM", events: ["conversation.user.created", "conversation.user.replied"] },
  },
  // ───────────── Finance (bank feeds, read-only) ─────────────
  {
    key: "plaid",
    name: "Plaid",
    category: "finance",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://plaid.com/docs/quickstart/",
    fields: [
      { key: "clientId", secret: false, required: true, placeholder: "24 hex characters", pattern: "^[a-f0-9]{24}$" },
      { key: "apiKey", secret: true, required: true, labelKey: "plaidSecret", placeholder: "30 hex characters", pattern: "^[a-f0-9]{30}$" },
      { key: "environment", secret: false, required: true, placeholder: "sandbox / production", pattern: "^(sandbox|production)$" },
      { key: "countryCodes", secret: false, required: false, placeholder: "US,CA,GB", pattern: "^[A-Z]{2}(,[A-Z]{2}){0,11}$" },
    ],
    syncKinds: ["plaid.transactions"],
    capabilities: ["bank_feeds", "balances", "sync"],
    inboundWebhooks: { scheme: "PLAID", events: ["TRANSACTIONS:SYNC_UPDATES_AVAILABLE", "ITEM:ERROR", "ITEM:PENDING_EXPIRATION"] },
  },
  {
    key: "wise",
    name: "Wise Business",
    category: "finance",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.wise.com/api-docs/features/authentication-access/personal-tokens",
    fields: [
      { key: "apiKey", secret: true, required: true, labelKey: "apiToken", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", pattern: "^[a-f0-9-]{36}$" },
      { key: "environment", secret: false, required: true, placeholder: "sandbox / production", pattern: "^(sandbox|production)$" },
    ],
    syncKinds: ["wise.balances"],
    capabilities: ["balances", "sync"],
    multiAccount: true,
  },
  {
    key: "revolut_business",
    name: "Revolut Business",
    category: "finance",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://developer.revolut.com/docs/business/business-api",
    fields: [],
    capabilities: ["balances", "bank_feeds"],
    availability: "awaiting_docs",
  },
  // ───────────── Automation platforms ─────────────
  {
    key: "zapier",
    name: "Zapier",
    category: "automation",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks",
    fields: [
      { key: "apiKey", secret: true, required: true, labelKey: "catchHookUrl", placeholder: "https://hooks.zapier.com/hooks/catch/123/abc/", pattern: "^https://hooks\\.zapier\\.com/hooks/catch/\\d{1,20}/[A-Za-z0-9]{3,40}/?$" },
      { key: "signingSecret", secret: true, required: false, placeholder: "Optional: verify Realy's signature in your Zap", pattern: "^[^\\s]{16,200}$" },
    ],
    capabilities: ["automation_triggers", "workflow_actions"],
  },
  {
    key: "make",
    name: "Make",
    category: "automation",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://www.make.com/en/help/tools/webhooks",
    fields: [
      { key: "apiKey", secret: true, required: true, labelKey: "webhookUrl", placeholder: "https://hook.eu1.make.com/…", pattern: "^https://hook\\.[a-z0-9]{2,10}\\.make\\.com/[A-Za-z0-9]{10,80}$" },
      { key: "signingSecret", secret: true, required: false, placeholder: "Optional: verify Realy's signature in your scenario", pattern: "^[^\\s]{16,200}$" },
    ],
    capabilities: ["automation_triggers", "workflow_actions"],
  },
  {
    key: "n8n",
    name: "n8n",
    category: "automation",
    authType: "api_key",
    scopes: [],
    envVars: [],
    docsUrl: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/",
    fields: [
      { key: "apiKey", secret: true, required: true, labelKey: "webhookUrl", placeholder: "https://n8n.example.com/webhook/…", pattern: "^https://[^\\s]{3,500}$" },
      { key: "signingSecret", secret: true, required: false, placeholder: "Optional: HMAC secret checked by your workflow", pattern: "^[^\\s]{16,200}$" },
    ],
    capabilities: ["automation_triggers", "workflow_actions"],
  },
];

export const PROVIDER_KEYS = PROVIDERS.map((p) => p.key);
export const providerInfo = (key: string): ProviderInfo | undefined => PROVIDERS.find((p) => p.key === key);

/** Providers that can be connected today (adapters awaiting documentation are listed but not connectable). */
export const isConnectable = (info: ProviderInfo) => info.availability !== "awaiting_docs";

// ───────────── Platform-managed providers ─────────────

/**
 * Providers run on REALY's own account (docs/integrations.md "Who manages what"): only the platform admin sets their
 * keys, once, in Admin → Platform keys; customers never see or enter keys. Every customer call is attributed to the
 * organization and company (plan meters, cost ledger). In the user app these providers show only as Available /
 * Not available. Existing company connection rows for them are kept in the database but no longer used.
 */
export const PLATFORM_MANAGED_PROVIDERS = [
  // AI
  "openai",
  "gemini",
  "openrouter",
  "openai_compatible",
  // Research
  "tavily",
  "exa",
  "serpapi",
  "apollo",
  "hunter",
  "pdl",
  // Creative
  "stability",
  "replicate",
  "runway",
  // Voice
  "elevenlabs",
  "deepgram",
  // Video
  "jamendo",
  "luma",
  "kling",
  "shotstack",
  "creatomate",
  // Telephony
  "twilio_voice",
  "sip_trunk",
  "vapi",
  "retell",
  // Email, messaging, storage and payments (Realy's accounts)
  "sendgrid",
  "mailchimp",
  "twilio",
  "whatsapp",
  "s3",
  "cloudflare",
  "stripe",
  "razorpay",
] as const;
export type PlatformManagedProvider = (typeof PLATFORM_MANAGED_PROVIDERS)[number];

const PLATFORM_MANAGED = new Set<string>(PLATFORM_MANAGED_PROVIDERS);
export const isPlatformManaged = (key: string): key is PlatformManagedProvider => PLATFORM_MANAGED.has(key);

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

/** Environment / platform-key name of one credential field: OPENAI_API_KEY, TWILIO_VOICE_AUTH_TOKEN, KLING_ACCESS_KEY... */
export const platformFieldKey = (provider: string, field: Pick<CredentialField, "key" | "labelKey">) => `${provider.toUpperCase()}_${snake(field.labelKey ?? field.key)}`;

/** Every credential / setting field of a platform-managed provider (setup fields, then settings), with its platform key name. */
export function platformCredentialFields(info: ProviderInfo): (CredentialField & { envKey: string })[] {
  if (!isPlatformManaged(info.key)) return [];
  const seen = new Set<string>();
  const out: (CredentialField & { envKey: string })[] = [];
  for (const f of [...(info.fields ?? []), ...(info.configFields ?? [])]) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    out.push({ ...f, envKey: platformFieldKey(info.key, f) });
  }
  return out;
}

/**
 * How a customer gets a provider in the user app:
 *  - "platform": runs on Realy's keys (Admin → Platform keys); read-only Available / Not available.
 *  - "oauth": the customer logs in to their OWN account with Realy's OAuth app (client id / secret in Platform keys) —
 *    a plain Connect / Disconnect button and the status, nothing else.
 *  - "unavailable": acts in the customer's own account but has no OAuth flow yet; customers cannot connect it (an
 *    existing connection keeps working and shows its status; the admin can disconnect it).
 */
export type CustomerConnectMode = "platform" | "oauth" | "unavailable";

export function customerConnectMode(info: Pick<ProviderInfo, "key" | "authType" | "availability">): CustomerConnectMode {
  if (isPlatformManaged(info.key)) return "platform";
  if (info.authType === "oauth2" && info.availability !== "awaiting_docs") return "oauth";
  return "unavailable";
}
