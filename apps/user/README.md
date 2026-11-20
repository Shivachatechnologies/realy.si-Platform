# @realy/user — app.realy.si

The founder product: the company app (`src/app/[locale]/(app)`), user sign-in/up/MFA/recovery (`(auth)`), the public
site and the user API (`src/app/api`, `/api/v1/**` except `/api/v1/admin/**`). Shared backend code comes from
`packages/*` through the `paths` in `tsconfig.json`; this app's session cookie is `realy_session`.

```bash
pnpm dev:user        # from the repo root — http://localhost:3000
pnpm typecheck:user
```

Its Vercel build (`pnpm run build`) is the only one that runs database migrations (`scripts/deploy-db.mjs`).
Never import from `apps/admin` — see `docs/architecture/apps.md`.
