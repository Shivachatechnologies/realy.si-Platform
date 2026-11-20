/**
 * Public website content model (no CMS, no MDX): structure lives here, every visible word lives in the i18n messages
 * under `site.*` so the site ships in all five locales. Pure data — safe to import from server and client components.
 *
 * Rule for everything described here: it must match what the product actually does today. No customer logos,
 * testimonials, usage numbers or invented results.
 */
import type { WorldName } from "@/components/ui/world";

/** Department pages (/platform/<key>). `app` is the in-app area a signed-in founder lands in. */
export const SITE_DEPARTMENTS = [
  { key: "sales", world: "sales", app: "/crm", profiles: ["sdr", "account_executive", "sales_manager", "sales_researcher"] },
  { key: "marketing", world: "marketing", app: "/marketing", profiles: ["cmo", "content_writer", "seo_specialist", "campaign_strategist"] },
  { key: "finance", world: "finance", app: "/finance", profiles: ["ai_cfo", "bookkeeper"] },
  { key: "people", world: "people", app: "/hr", profiles: ["recruiter", "hr_policy_assistant", "people_analyst"] },
  { key: "projects", world: "projects", app: "/projects", profiles: ["ai_project_manager", "delivery_analyst", "operations_assistant"] },
  { key: "product", world: "product", app: "/product", profiles: ["product_manager", "product_researcher", "ux_designer", "release_manager"] },
  { key: "support", world: "support", app: "/support", profiles: ["support_agent", "support_lead"] },
  { key: "operations", world: "automation", app: "/operations", profiles: ["automation_architect", "org_admin_assistant", "integrations_engineer"] },
  { key: "knowledge", world: "brain", app: "/brain", profiles: ["brain_answerer", "knowledge_manager", "research_analyst"] },
] as const satisfies readonly { key: string; world: WorldName; app: string; profiles: readonly string[] }[];

export type SiteDepartmentKey = (typeof SITE_DEPARTMENTS)[number]["key"];
export const SITE_DEPARTMENT_KEYS = SITE_DEPARTMENTS.map((d) => d.key) as [SiteDepartmentKey, ...SiteDepartmentKey[]];
export const siteDepartment = (key: string) => SITE_DEPARTMENTS.find((d) => d.key === key);

/** Feature bullets per department page (site.departments.<key>.f1 … f4). */
export const DEPARTMENT_FEATURES = ["f1", "f2", "f3", "f4"] as const;

/** Profile department (agents/profile-types.ts) → world, for the AI workforce page. */
export const PROFILE_DEPARTMENT_ORDER = ["executive", "sales", "marketing", "finance", "hr", "product", "engineering", "support", "operations", "research", "general"] as const;

/** Journal (platform blog). Bodies: site.blog.posts.<id>.{title, excerpt, intro, h1, p1, h2, p2, h3, p3}. */
export const BLOG_POSTS = [
  { slug: "why-every-ai-action-waits-for-approval", id: "approvals", world: "command", publishedAt: "2026-11-18", minutes: 5 },
  { slug: "one-company-graph-instead-of-twelve-tools", id: "graph", world: "brain", publishedAt: "2026-11-11", minutes: 4 },
  { slug: "built-for-five-languages-from-day-one", id: "languages", world: "integrations", publishedAt: "2026-11-04", minutes: 4 },
] as const satisfies readonly { slug: string; id: string; world: WorldName; publishedAt: string; minutes: number }[];
export const BLOG_SECTIONS = ["1", "2", "3"] as const;
export const blogPost = (slug: string) => BLOG_POSTS.find((p) => p.slug === slug);

/** Documentation articles. Bodies: site.docs.articles.<id>.{title, summary, s1h, s1p, s2h, s2p, s3h, s3p}. */
export const DOC_CATEGORIES = ["start", "ai", "data", "trust"] as const;
export const DOC_ARTICLES = [
  { slug: "create-your-company", id: "createCompany", category: "start", world: "command" },
  { slug: "invite-your-team", id: "inviteTeam", category: "start", world: "people" },
  { slug: "ai-employees", id: "aiEmployees", category: "ai", world: "automation" },
  { slug: "approvals-and-autonomy", id: "approvals", category: "ai", world: "command" },
  { slug: "company-brain", id: "brain", category: "data", world: "brain" },
  { slug: "integrations", id: "integrations", category: "data", world: "integrations" },
  { slug: "roles-and-security", id: "security", category: "trust", world: "settings" },
  { slug: "languages-and-regions", id: "languages", category: "trust", world: "marketplace" },
] as const satisfies readonly { slug: string; id: string; category: (typeof DOC_CATEGORIES)[number]; world: WorldName }[];
export const DOC_SECTIONS = ["1", "2", "3"] as const;
export const docArticle = (slug: string) => DOC_ARTICLES.find((a) => a.slug === slug);

/** Help-center questions: site.help.faq.<id>.{q, a}; `doc` links the matching article. */
export const HELP_FAQ = [
  { id: "whatIs", doc: "create-your-company" },
  { id: "aiActs", doc: "approvals-and-autonomy" },
  { id: "aiCost", doc: "ai-employees" },
  { id: "data", doc: "company-brain" },
  { id: "connect", doc: "integrations" },
  { id: "team", doc: "invite-your-team" },
  { id: "security", doc: "roles-and-security" },
  { id: "languages", doc: "languages-and-regions" },
  { id: "pricing", doc: null },
  { id: "waitlist", doc: null },
] as const;

/** Public paths of the marketing site (after /{locale}), for the sitemap. */
export function sitePaths(): string[] {
  return [
    "",
    "/platform",
    ...SITE_DEPARTMENTS.map((d) => `/platform/${d.key}`),
    "/ai-workforce",
    "/pricing",
    "/blog",
    ...BLOG_POSTS.map((p) => `/blog/posts/${p.slug}`),
    "/docs",
    ...DOC_ARTICLES.map((a) => `/docs/${a.slug}`),
    "/help",
    "/waitlist",
    "/sign-up",
  ];
}
