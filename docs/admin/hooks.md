# Request, error and job-failure hooks (stream E)

Every API handler wrapped in `route()` (`packages/backend/src/server/core/http.ts`) feeds three process-wide lists.
The worker feeds a fourth (`core/jobs.ts`). Stream E owns these files. Other streams register their hooks only in their
own installer file.

| Hook | Where | When it runs | Can refuse the request? |
|---|---|---|---|
| `onRequestGate(fn)` | `core/http.ts` | Before the handler, after authentication, the platform gate and plan entitlements | Yes: throw an `AppError` and its envelope is returned |
| `onRequestComplete(fn)` | `core/http.ts` | After the response, once for every handled request (any status) | No |
| `onError(fn)` | `core/http.ts` | After the response, once for every unexpected server error (status >= 500: unhandled exceptions, database failures, and page or server-action errors reported through `reportServerError`) | No |
| `onJobFailure(fn)` | `core/jobs.ts` | After every failed worker job attempt (`final` marks the last attempt) | No |

Each registration call returns an unsubscribe function.

## Rules

- **Observers never delay or break a request.** `onRequestComplete` and `onError` run after the response: through Next.js `after()`, or as a detached promise outside a request scope. A throwing hook is swallowed and logged at debug level.
- **Gates run on the request path.** Keep them cheap: no I/O in the common case and at most one cached lookup. Skip methods or sessions that can never be refused.
- **Events carry only metadata.** That means request id, app (`user`, `admin`, `worker`), method, route template, path without query, status, duration, error code, actor type and id, session id, API-key flag, organization id from the path or API key, IP, and user agent. Headers, cookies, bodies and query strings are never included.
- `RequestErrorEvent.error` and `JobFailureEvent.error` are the original thrown values. **Scrub them before storing** (`scrubText` in `modules/admin/errors.ts`). `JobFailureEvent.error` is `null` for jobs that handle personal data (`redactErrors`).
- The lists live on `globalThis`, because a server process holds one copy of `http.ts` per route bundle.

## Registering

Each stream has one installer in `packages/backend/src/server/core/request-hooks/<stream>.ts`:

| File | Owner | Registers |
|---|---|---|
| `e.ts` | E | error grouping from `onError` and from final `onJobFailure` events; the warn+ `app_log_entries` sink (`core/logger.ts` `addLogSink`) |
| `b.ts` | B (added by E at the integrator's request) | `impersonationRequestGate` (mutating requests only), `recordImpersonatedRequest` on completion |
| `f.ts` | F | placeholder: register the API request logger with `onRequestComplete` |

`request-hooks/index.ts` (E) runs every installer once per process:

- **Web apps:** lazily, on the first `route()` request. That first request waits for installation before it runs the gates.
- **Worker:** at start, with `installHooks("worker")`. Install no HTTP hooks when `app === "worker"`.

Load your modules inside the installer with a dynamic `import()`, so installing costs nothing at cold start and adds no import cycles.

```ts
// core/request-hooks/f.ts
export async function installF(app: ProcessApp) {
  if (app === "worker") return;
  const { onRequestComplete } = await import("../http");
  const { recordApiRequest } = await import("@/server/modules/admin/api-logs");
  onRequestComplete((e) => recordApiRequest(e));
}
```

## Errors outside `route()`

`apps/admin/src/instrumentation.ts` calls `reportServerError(error, { method, route, path, kind: "render" })` for page,
server-action and proxy errors. Route-handler errors are already reported by `route()`. The user app's
`instrumentation.ts` records releases only: its `onRequestError` is unchanged, so user-app page render errors go to
Sentry only.
