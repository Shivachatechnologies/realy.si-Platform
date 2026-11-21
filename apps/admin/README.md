# @realy/admin — admin.realy.si

The Realy Control Center: platform administration only. Console pages live in `src/app/[locale]/(console)` and are
served at the root of the domain (`/[locale]/organizations`, …); `src/app/[locale]/(auth)` holds the admin login and
MFA step; `src/app/api/v1/admin/**` is the admin API. `src/proxy.ts` verifies every request server-side (admin
session cookie, MFA, platform role) before routing — there are no public routes.

The UI primitives under `src/components/{ui,motion,graphics}` are this app's own copies with its own dense theme
(`src/app/globals.css`); change them here without affecting the user app. Product strings shared with the user app
are copies — edit them in `apps/user/src/i18n/messages` and run `pnpm i18n:sync`.

```bash
pnpm dev:admin       # from the repo root — http://localhost:3001
pnpm typecheck:admin
```

This app's build never migrates the database. Never import from `apps/user` — see `docs/architecture/apps.md`.
