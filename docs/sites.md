# Company websites & landing pages (`sites`)

Every company builds and publishes its own website and landing pages without code (Marketing → Website, `/website`).

| Concern | Location |
|---|---|
| Models | `packages/database/prisma/schema/sites.prisma` — `Site` (one per company), `SitePage` (kind `PAGE` / `LANDING`), `SitePageVersion`, `SiteFormSubmission` |
| Content model (pure) | `modules/sites/schemas.ts` — typed blocks (hero, features, rich text, image, CTA, FAQ, testimonials, pricing, contact form, logo strip), theme, nav, footer, SEO |
| Services | `modules/sites/service.ts` (site, pages, publish / schedule / rollback, scheduler), `forms.ts` (public form → CRM lead, inbox), `domain.ts`, `public.ts` (read side), `ai.ts` |
| AI | profile `web_designer`; tools `read_site` (read) and `draft_site_pages` (SUPERVISED: drafts only, never publishes) |
| Jobs | `marketing.sites_publish_scheduled` (every minute) |
| User app | `/[locale]/website/**` (overview + setup, pages, editor, leads, settings, domain); public site `/s/<slug>/…` (root layout outside `[locale]`) |
| API | `/api/v1/organizations/:orgId/companies/:companyId/sites/**`; public `POST /api/public/sites/:slug/forms`, `GET /api/public/sites/:slug/assets/:assetId` |

## Rules

- **RBAC** `marketing.read` / `marketing.manage`; plan feature `feature.website_builder` (create, publish, AI); counted limits
  `sites.pages.max` and `sites.landing_pages.max` (entitlements catalog).
- **Public pages** render published snapshots only, as React elements (never raw HTML). Links: site paths, anchors,
  http(s), mailto, tel. Images are company visual assets served same-origin, and only those referenced by the live site
  (`Site.publicAssetIds`). Testimonials must reference CRM accounts of type `CUSTOMER`; pricing cards reference real
  products — both are checked on save, publish and render.
- **Forms** require consent (the exact text is stored), create a CRM lead through `crm/service.createLead` (an existing
  lead with the same email gets a note), notify `marketing.manage` holders and emit `site.form_submitted`. Spam: honeypot,
  minimum fill time, per-IP route limits and a per-site limit.
- **Events**: `site.published` (page publish, scheduled publish, site online), `site.form_submitted`.
- **Caching**: public data is cached in the Next data cache (60 s, tag `site:<slug>`), expired on publish / settings
  changes by the API routes. HTML is rendered per request (CSP nonce).

## Custom domains

1. The founder enters a domain; the app stores it with status `PENDING` and a token.
2. The founder adds the DNS TXT record `_realy-verification.<domain>` = `realy-site-verification=<token>` and clicks
   *Check now*; the server does a real DNS lookup and stores `VERIFIED` or `FAILED` with the reason.
3. **Routing is an operator step (not automated yet).** To serve a verified domain:
   - the customer adds a `CNAME` from the domain to the user app's host (e.g. `cname.vercel-dns.com`), or `A`/`ALIAS`
     records for an apex domain;
   - an operator adds the domain to the user app's hosting project (Vercel → Domains) so TLS is issued;
   - the user app maps the host to the site: a host-based rewrite in `apps/user/src/proxy.ts` from
     `https://<domain>/<path>` to `/s/<slug>/<path>` for hosts found in `sites.custom_domain` with status `VERIFIED`
     (to be added together with a host → slug lookup cache). The per-site `robots.txt` and `sitemap.xml`
     (`/s/<slug>/robots.txt`, `/s/<slug>/sitemap.xml`) are designed to be served at the domain root then.

Until then the UI says plainly that the site stays at `/s/<slug>`.
