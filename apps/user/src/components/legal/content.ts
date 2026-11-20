/**
 * Built-in DRAFT legal texts (English). They describe what the product actually does in this codebase — what is stored,
 * which providers are called, which cookies are set — and are shown until a reviewed text is published in the CMS
 * (Admin → Content) under the slug `legal-<doc>` (legal-privacy, legal-terms, legal-cookies, legal-dpa).
 *
 * MUST be reviewed by a lawyer before launch. Placeholders in [square brackets] are for the operator to fill in.
 * Keep this file honest: when a feature changes what is collected or which provider receives data, update it.
 */

export const LEGAL_DOCS = ["privacy", "terms", "cookies", "dpa"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

/** Date of the built-in draft (shown as "last updated"). */
export const LEGAL_DRAFT_DATE = "2026-11-20";

export const CONTROLLER = "[company legal name / address / email]";

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  /** Optional closing paragraphs after the bullet list. */
  after?: string[];
}

/**
 * Sub-processors the platform itself can use. Most are only called when the operator configures them (environment
 * variables) or when a customer connects their own account under Integrations — then the customer's contract with that
 * provider applies. The operator edits this list to match the deployment (or publishes the reviewed list in the CMS).
 */
export const SUB_PROCESSORS: { name: string; purpose: string; when: string }[] = [
  { name: "[Hosting provider, e.g. Vercel]", purpose: "Hosting of the web application", when: "Always" },
  { name: "[Database provider]", purpose: "PostgreSQL database storing all account and business data", when: "Always" },
  { name: "[Redis provider]", purpose: "Background job queues and rate limiting (short-lived job data)", when: "When background work is enabled" },
  { name: "[Worker hosting, e.g. Render / Fly.io]", purpose: "Background worker running scheduled and AI jobs", when: "When background work is enabled" },
  { name: "Anthropic (Claude API)", purpose: "AI employees and AI tasks: prompts with the business context needed for the task", when: "When the operator configures an Anthropic API key" },
  { name: "Resend or Postmark", purpose: "Transactional email (sign-in, password reset, invitations, notifications, briefings)", when: "When the operator configures an email provider" },
  { name: "Stripe", purpose: "Subscription billing, payment methods, invoices and tax", when: "When billing is enabled" },
  { name: "Sentry", purpose: "Error reports (no cookies, headers, request bodies or user details are sent)", when: "When the operator configures a Sentry DSN" },
  { name: "[OpenTelemetry collector]", purpose: "Technical traces and metrics", when: "When the operator configures an OTLP endpoint" },
];

const RIGHTS = [
  "Access — get a copy of the personal data we hold about you.",
  "Rectification — have inaccurate data corrected (most profile data can be edited in Settings).",
  "Erasure — have your data deleted where there is no legal reason to keep it.",
  "Restriction — ask us to limit processing while a request or objection is being handled.",
  "Portability — receive data you gave us in a structured, machine-readable format.",
  "Objection — object to processing based on legitimate interests, and at any time to direct marketing.",
  "Withdraw consent — where processing is based on consent, without affecting earlier processing.",
  "Complaint — lodge a complaint with your local data protection supervisory authority.",
];

export const LEGAL_CONTENT: Record<LegalDoc, { title: string; intro: string; sections: LegalSection[] }> = {
  privacy: {
    title: "Privacy Policy",
    intro:
      "This policy explains which personal data Realy collects, why, who receives it and which rights you have. It covers the Realy website and application (the \"Service\").",
    sections: [
      {
        heading: "1. Who is responsible",
        paragraphs: [
          `The controller for account, billing and website data is ${CONTROLLER}.`,
          "For business data that customers put into Realy (for example their leads, contacts, employees, tickets or chat visitors), the customer company is the controller and we act as its processor under the Data Processing Agreement.",
        ],
      },
      {
        heading: "2. Data we process",
        bullets: [
          "Account data: name, email address, password (stored only as an Argon2 hash), language, time zone, two-factor authentication factors and recovery codes (stored protected), sign-in method (email/password, Google or Microsoft sign-in, or company SSO).",
          "Session and security data: a session record per sign-in (with IP address and browser user agent), sign-in attempts, rate-limit counters and an audit log of important actions.",
          "Organization and company data: company profile, members, roles and permissions, and settings.",
          "Business data you enter or import: CRM records, marketing content and campaigns, finance and HR records, projects, support tickets, live-chat conversations, documents and files.",
          "Integration credentials: access tokens and API keys for the services you connect. They are encrypted at rest and never shown again.",
          "AI data: instructions you give AI employees, the context they read through tools, their outputs, approvals and usage (token counts).",
          "Billing data: plan, billing country, tax details and invoices. Card details are entered at Stripe and never stored by us.",
          "Email interaction data: when you send marketing email through Realy, opens (tracking pixel) and clicks (redirect links) are recorded, and recipients can unsubscribe with one click.",
          "Technical logs and error reports needed to run and secure the Service.",
        ],
      },
      {
        heading: "3. Why we process it (legal bases)",
        bullets: [
          "To provide the Service you signed up for — contract (GDPR Art. 6(1)(b)).",
          "To secure the Service, prevent abuse and keep audit trails — legitimate interests (Art. 6(1)(f)) and, where applicable, legal obligations (Art. 6(1)(c)).",
          "To bill you and keep accounting records — contract and legal obligation.",
          "To send service emails (sign-in, password reset, invitations, notifications and briefings you subscribe to) — contract.",
          "Product announcements or marketing emails, if any — consent or legitimate interests, always with an opt-out.",
        ],
      },
      {
        heading: "4. AI processing",
        paragraphs: [
          "AI employees and AI tasks send the instructions and the business context they need to the AI provider configured by the operator (Anthropic's Claude API). Some features (quick rewrites, summaries, translations, images, research, contact data) use providers that your company connects under Integrations, such as OpenAI, Google Gemini, Tavily, Exa, SerpAPI, Apollo, Hunter, People Data Labs, Stability AI, Replicate or Runway; these are only called when connected and your contract with them applies.",
          "AI actions that change data or contact people require a person's approval unless your company enables Auto mode for that kind of action; automatic actions are logged and can be reviewed. AI output can be wrong and should be checked.",
        ],
      },
      {
        heading: "5. Who receives data",
        paragraphs: [
          "We use the sub-processors listed below. Services you connect yourself under Integrations (for example Google, Microsoft, Slack, HubSpot, Salesforce, social networks and ad platforms, Shopify, WordPress, Webflow, SendGrid, Mailchimp, Twilio, WhatsApp, Vapi, Retell, Razorpay, QuickBooks, Xero, your own S3-compatible storage) receive the data needed for what you ask them to do.",
          "We do not sell personal data and do not use it for advertising.",
        ],
      },
      {
        heading: "6. International transfers",
        paragraphs: [
          "Some providers process data outside the EU/EEA (notably in the United States). Where that happens we rely on an adequacy decision (such as the EU-U.S. Data Privacy Framework for certified providers) or Standard Contractual Clauses. Each company records a data region; [describe where data is actually hosted for each region].",
        ],
      },
      {
        heading: "7. How long we keep data",
        bullets: [
          "Account and business data: for as long as the account exists, then deleted [within N days] unless the law requires us to keep it.",
          "Sessions, one-time links and idempotency records: until they expire; expired records are purged automatically.",
          "Audit logs and invoices: [retention period] as required for security and accounting.",
        ],
      },
      { heading: "8. Your rights", paragraphs: ["Under the GDPR (and similar laws) you have the right to:"], bullets: RIGHTS, after: [`To exercise them, contact ${CONTROLLER}. We answer within one month.`] },
      {
        heading: "9. Cookies",
        paragraphs: ["We use only strictly necessary and preference cookies and no analytics or advertising cookies. See the [Cookie Policy](/legal/cookies)."],
      },
      {
        heading: "10. Security",
        paragraphs: [
          "Passwords are hashed with Argon2, integration credentials are encrypted at rest, sessions are httpOnly cookies, and two-factor authentication is available (required for platform administrators). Access to business data is limited by roles and permissions within each company.",
        ],
      },
      { heading: "11. Changes", paragraphs: ["We will post changes on this page and, for material changes, notify account owners by email."] },
      { heading: "Sub-processors", bullets: SUB_PROCESSORS.map((s) => `**${s.name}** — ${s.purpose} (${s.when}).`) },
    ],
  },
  terms: {
    title: "Terms of Service",
    intro: `These terms govern use of Realy (the "Service") provided by ${CONTROLLER} ("we"). By creating an account you agree to them on behalf of yourself and the organization you represent.`,
    sections: [
      { heading: "1. The Service", paragraphs: ["Realy is a business operating platform with CRM, marketing, finance, HR, projects, support, automation, integrations and AI employees. Features depend on your plan and on the integrations you connect."] },
      {
        heading: "2. Accounts",
        bullets: [
          "You must give accurate information and keep your credentials secure; enable two-factor authentication where possible.",
          "Organization owners control who has access and with which permissions, and are responsible for their members' use.",
          "You must be old enough to enter a binding contract and use the Service for business purposes.",
        ],
      },
      {
        heading: "3. Acceptable use",
        bullets: [
          "No unlawful, harmful, deceptive or infringing content or activity.",
          "No unsolicited bulk messages, calls or emails in breach of anti-spam, telemarketing or privacy laws. You are responsible for having a lawful basis to contact the people you prospect, email, message or call through Realy, and for honouring opt-outs and do-not-call lists.",
          "No attempts to break, overload or bypass security or usage limits of the Service.",
        ],
      },
      {
        heading: "4. AI features",
        paragraphs: [
          "AI employees act through defined tools. External or data-changing actions need approval unless you enable Auto mode for them; you remain responsible for actions taken on your behalf, including automatic ones within limits you configured. AI output may be inaccurate — review it before relying on it.",
        ],
      },
      { heading: "5. Your data", paragraphs: ["You keep all rights to the data you put into the Service. You grant us the rights needed to host and process it to provide the Service. Our processing of personal data in your business data is governed by the Data Processing Agreement."] },
      { heading: "6. Third-party services", paragraphs: ["Integrations connect to services operated by third parties under their own terms. We are not responsible for those services, their availability or their charges."] },
      {
        heading: "7. Plans, payment and cancellation",
        paragraphs: [
          "Paid plans are billed in advance through Stripe in the currency shown at checkout, with taxes where applicable. You can cancel at any time; the plan stays active until the end of the paid period. [Refund policy]. Consumers in the EU may have additional statutory rights.",
        ],
      },
      { heading: "8. Availability and changes", paragraphs: ["We aim for high availability but do not guarantee uninterrupted service. We may change features; we will give reasonable notice of material changes that reduce functionality of a paid plan."] },
      { heading: "9. Liability", paragraphs: ["[Limitation of liability — to be drafted by counsel for the applicable jurisdiction. Nothing limits liability that cannot be limited by law.]"] },
      { heading: "10. Termination", paragraphs: ["You may close your account at any time. We may suspend or terminate accounts that breach these terms. After termination your data is deleted as described in the Privacy Policy; export what you need beforehand."] },
      { heading: "11. Law and disputes", paragraphs: ["[Governing law and competent courts.]"] },
      { heading: "12. Contact", paragraphs: [CONTROLLER] },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    intro: "Realy uses only cookies that are strictly necessary to provide the Service or to remember choices you make. We use no analytics, advertising or social-media tracking cookies and load no third-party tracking scripts, so we do not ask for cookie consent; a short notice links here.",
    sections: [
      {
        heading: "Cookies we set",
        bullets: [
          "**realy_session** — keeps you signed in (httpOnly, SameSite=Lax, Secure in production; kept until the sign-in expires or you sign out).",
          "**realy_oauth**, **realy_int_oauth**, **realy_sso** — short-lived (minutes), httpOnly cookies that protect Google/Microsoft sign-in, connecting an integration and company SSO against forgery; deleted when the flow completes.",
          "**realy_locale** — the language you chose (1 year).",
          "**realy_org**, **realy_company** — the organization and company you selected in the app (1 year).",
          "Control Center only (admin.realy.si): **__Host-realy_admin_session** — administrator session (httpOnly, SameSite=Strict).",
        ],
      },
      {
        heading: "Browser storage",
        bullets: [
          "**realy_cookie_notice** (localStorage) — remembers that you dismissed the cookie notice.",
          "Interface preferences in localStorage (for example a collapsed sidebar or a calendar time-zone choice).",
          "sessionStorage holds an email-verification or invitation token for the current tab only, until it is used.",
        ],
      },
      {
        heading: "Live-chat widget on customers' websites",
        paragraphs: [
          "When a Realy customer embeds the live-chat widget on their own website, the widget stores a visitor token in that website's localStorage (realy_lc_<key>) so the conversation continues across pages. The customer operating that website is responsible for informing its visitors.",
        ],
      },
      {
        heading: "Marketing emails",
        paragraphs: ["Emails sent by Realy customers through the marketing module may contain an open-tracking pixel and tracked links. These are not cookies; recipients can unsubscribe with one click."],
      },
      { heading: "Managing cookies", paragraphs: ["You can delete or block cookies in your browser settings. Blocking the session cookie prevents signing in."] },
      { heading: "Contact", paragraphs: [CONTROLLER] },
    ],
  },
  dpa: {
    title: "Data Processing Agreement",
    intro: `This Data Processing Agreement ("DPA") forms part of the Terms of Service between the customer ("Controller") and ${CONTROLLER} ("Processor") and applies where the Processor processes personal data on the Controller's behalf under GDPR Art. 28.`,
    sections: [
      {
        heading: "1. Subject matter and duration",
        paragraphs: ["The Processor processes personal data contained in the Controller's business data to provide the Service, for the term of the agreement and until deletion as set out below."],
      },
      {
        heading: "2. Nature, purpose and data",
        bullets: [
          "Purposes: hosting, storage, organisation, retrieval, transmission (email, messaging, calls and integrations the Controller triggers), AI processing requested by the Controller, support.",
          "Data subjects: the Controller's employees and members, leads, contacts and customers, candidates, suppliers, website and chat visitors, email recipients.",
          "Categories: identification and contact data, business communication, CRM, HR, finance and support records, call recordings or transcripts where voice features are used, and other data the Controller chooses to enter. The Controller should not enter special categories of data unless necessary and lawful.",
        ],
      },
      {
        heading: "3. Processor obligations",
        bullets: [
          "Process only on documented instructions of the Controller (the Terms, this DPA and the Controller's use of the Service).",
          "Ensure persons authorised to process the data are bound by confidentiality.",
          "Implement appropriate technical and organisational measures (Annex: encryption of credentials at rest, hashed passwords, TLS in transit, role-based access, two-factor authentication, audit logging, backups [describe]).",
          "Assist the Controller with data subject requests, security, breach notification, DPIAs and prior consultation.",
          "Notify the Controller without undue delay (and aim for within 48 hours) after becoming aware of a personal data breach.",
          "Make available information needed to demonstrate compliance and allow audits [scope and frequency].",
        ],
      },
      {
        heading: "4. Sub-processors",
        paragraphs: [
          "The Controller authorises the sub-processors listed below. The Processor will inform the Controller of intended changes [N days] in advance, giving the Controller the opportunity to object. Providers the Controller connects itself under Integrations act under the Controller's own contract with them and are not sub-processors of the Processor.",
        ],
        bullets: SUB_PROCESSORS.map((s) => `**${s.name}** — ${s.purpose} (${s.when}).`),
      },
      { heading: "5. International transfers", paragraphs: ["Transfers outside the EU/EEA take place only with appropriate safeguards (adequacy decision or the Standard Contractual Clauses, Module 2/3 as applicable)."] },
      { heading: "6. Deletion and return", paragraphs: ["At the end of the Service the Processor deletes the Controller's personal data [within N days], unless law requires storage. The Controller can export its data before closing the account."] },
      { heading: "7. Contact", paragraphs: [CONTROLLER] },
    ],
  },
};
