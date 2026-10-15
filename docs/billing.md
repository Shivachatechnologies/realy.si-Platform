# Realy — Pricing & Billing

> Status: **Frozen for Phase 1.** Implemented in `src/server/modules/pricing` and `src/server/modules/billing`.

## 1. Principles

1. **Configuration, not code.** No price, currency, trial length or tax rate exists in source code.
   Everything is administered in the Admin Pricing Console and stored in the catalog tables.
2. **History is immutable.** Prices change by adding a `price_version`; past versions are end-dated,
   never edited. Subscriptions reference the exact version they were sold at.
3. **Integer money.** `amount_minor BIGINT` + ISO-4217 currency.
4. **Internal catalog is the source of truth;** Stripe is the payment/tax processor. Each
   `price_version` maps 1:1 to an (immutable) Stripe Price. Phase 1.1 creates the Stripe Product,
   Price and Coupon **lazily at the first checkout that needs them** (with Stripe idempotency keys,
   ids stored on `plans`, `price_versions` and `promotions`), not on publish.

## 2. Catalog

```
billing_product ─ plan ─┬─ price (plan × interval × market) ─ price_version (amount over time)
                        ├─ plan_entitlements (feature_key, enabled, limit)
                        └─ promotions/coupons (optional)
market = GLOBAL:* | REGION:<code> | COUNTRY:<ISO2>
```

### Price resolution (for a plan, interval, billing country, instant `at`)
1. Find `prices` for the plan/interval with status ACTIVE in order of specificity:
   `COUNTRY:<billing country>` → `REGION:<country's pricing region>` → `GLOBAL:*`.
2. For the first price found, take the `price_version` where
   `effective_from ≤ at < coalesce(effective_to, ∞)`.
3. If no version is effective, continue to the next less specific price.
4. If nothing resolves → the plan is **not available** in that market (not silently priced in USD).
5. Plan must be ACTIVE + public, and the country must have `billing_enabled`.

Result: `{ plan, price, priceVersion, money, interval, trialDays, market }`.

### Example configuration (illustrative only — real values are admin-controlled)
| Plan | Market | Monthly |
|---|---|---|
| Founder | COUNTRY:US | USD 99.00 |
| Founder | COUNTRY:IN | INR 4,999.00 |
| Founder | COUNTRY:AE | AED 399.00 |
| Founder | COUNTRY:GB | GBP 89.00 |
| Founder | REGION:EU | EUR 99.00 |

These amounts are created by the **development seed** only so the UI and tests have a realistic
catalog; production catalogs are created by admins.

## 3. Price versioning

```
Founder · COUNTRY:US · MONTH
  v1  USD 99.00   2026-01-01 → 2026-07-01
  v2  USD 109.00  2026-07-01 → (open)
```
`schedulePriceChange(priceId, amountMinor, effectiveFrom, reason)`:
* locks the price row (`SELECT … FOR UPDATE`),
* `effectiveFrom` must be ≥ now (no retroactive changes) and > the current open version's start,
* end-dates the open version at `effectiveFrom` and inserts `version + 1`,
* writes an `ADMIN` audit log (old/new amount, reason, actor, requestId) and a
  `pricing.price_version.created` event,
* requires `pricing.manage` at the price's market chain and an MFA-verified session.

Existing `subscription_items.price_version_id` are untouched. Migrating subscribers to a new version
is a separate explicit operation (`billing.migrate_subscriptions`, Phase 2) with notice periods
honoring local consumer law (configured per country).

## 4. Entitlements & feature flags

Plans grant entitlements (`agents.max`, `computer_use.enabled`, `storage.gb`, `integrations.premium`).
Feature flags can additionally target `PLAN`, so e.g. *Advanced Computer Use* is enabled for
Enterprise and disabled for Free/Founder without code changes.

## 5. Regional checkout

`quote(org, planKey, interval, billingCountryCode, couponCode?)`:
1. Billing country comes from the **billing profile** (confirmed by the user at checkout); user
   country and company country are only suggestions. The quote echoes back the country it used so the
   UI asks the user to confirm it.
2. Resolve price (above) → currency is the price's currency.
3. Payment methods from `countries.payment_methods` (e.g. `card`, `upi`, `sepa_debit`, `bacs_debit`).
4. Tax: active `tax_configs` for the country → `{taxType, displayName, priceIncludesTax,
   calculation}`. Final tax is calculated by Stripe Tax at session creation; the quote shows
   "tax calculated at checkout" unless `calculation = MANUAL`, in which case an estimate is computed
   server-side using `rate_bps` with banker's rounding in minor units.
5. Promotions/coupons validated for plan, market and window.
6. Persist nothing until the user proceeds; `checkout/session` re-runs the quote server-side (the
   client never sends prices).

## 6. Subscriptions & usage

* Billing models: monthly, annual, seat-based (`quantity`), usage-based (metered prices), add-ons
  (extra subscription items), credits (prepaid balance ledger, Phase 2), marketplace (Phase 7).
* `usage_records` are written idempotently by workers (AI tokens, execution minutes, storage,
  premium integration calls), aggregated hourly, and reported to Stripe metered prices.
* Stripe webhooks (`/api/v1/webhooks/stripe`, signature-verified, idempotent by event id) drive
  subscription state; the app never trusts client-side success redirects. _(Implemented in Phase 1.1,
  `src/server/modules/billing/stripe-billing.ts`.)_ Details:
  * raw body verified with `Stripe.webhooks.constructEvent` (300 s timestamp tolerance); invalid
    signatures → `400` and nothing is recorded;
  * each event id is recorded in `stripe_events` in the **same transaction** as its effects, so a
    redelivery (sequential or concurrent) is acknowledged as a duplicate and never re-applied, and a
    processing failure is not acknowledged (Stripe retries);
  * the subscription is re-fetched from Stripe for every event, so out-of-order delivery converges
    to the current state;
  * the subscription is applied only if its Stripe customer belongs to the organization named in its
    metadata (cross-tenant guard); items are locked to the sold `price_version`;
  * handled: `checkout.session.completed`, `checkout.session.expired`,
    `customer.subscription.created|updated|deleted|paused|resumed`, `invoice.paid`,
    `invoice.payment_succeeded`, `invoice.payment_failed`; other events are acknowledged and ignored.
  * Without `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` the UI and API say **"Billing is not
    configured."**; nothing simulates a payment.
* **Double-billing protection** _(Phase 1.1)_. An organization can never have two payable checkout
  sessions or two live subscriptions:
  1. **Checkout lock in the database.** Every Stripe Checkout Session Realy creates has a
     `checkout_sessions` row; a partial unique index allows one `OPEN` row per organization. A
     request reserves the row *before* calling Stripe, so concurrent requests (double clicks, two
     admins, two tabs) race on the index: one creates the session, the others get `409`
     (`checkout_in_progress`) or the same session URL.
  2. **Same plan → same session.** Asking again for the same price version and coupon returns the
     open session's URL; nothing new is created.
  3. **Different plan → old session retired first.** The open session is expired at Stripe
     (`checkout.sessions.expire`) before a new one is created. If the customer already paid it, Stripe
     reports `complete` and the request is refused (`409 payment_processing`) — never a second session.
  4. **Paid but not yet confirmed.** Under the lock, Stripe is asked whether the customer already has
     an unended subscription (e.g. the webhook for a just-completed payment hasn't been applied, or
     failed to apply). If so, no new session: `409 payment_processing`.
  5. **Orphans.** Before creating a session, every other *open* Stripe session of the customer is
     expired. This covers a crash after Stripe created a session but before Realy stored its id.
  6. **Bounded lifetime.** Sessions are created with `expires_at` = 35 minutes, computed right before
     the Stripe call, and an idempotency key per reservation; an expired row (by time or
     `checkout.session.expired`) releases the lock. A reservation whose session id was never stored is
     considered abandoned after 10 minutes (longer than the worst case of the Stripe calls). A request
     that outlives its reservation stores nothing and expires its own session instead of returning it.
  7. **One live subscription.** A partial unique index allows one subscription per organization in
     `ACTIVE`, `TRIALING`, `PAST_DUE`, `INCOMPLETE`, `UNPAID` or `PAUSED`. If a second paid
     subscription ever reaches the webhook (e.g. a session created in the Stripe dashboard), it is not
     activated: the event is acknowledged with outcome `duplicate_subscription`, a SECURITY audit
     entry (`billing.subscription.duplicate_blocked`) and an error log are written, and a human must
     cancel/refund it in Stripe (runbook: Stripe dashboard → Subscriptions → filter by customer →
     cancel the newer one → refund its invoice).
  8. **Redirects are display-only.** `?checkout=success` only shows "Payment submitted…"; state
     changes come exclusively from verified webhooks.

## 7. Required tests (Phase 1)
* US / IN / AE / DE resolve correct price, currency, tax config.
* Admin changes India Founder price → India resolves new version; US unchanged; an existing India
  subscription item still references the old version; an ADMIN audit log exists.
* COUNTRY_ADMIN for IN cannot change US price; REGION_ADMIN for MIDDLE_EAST can change AE price.
* Retroactive or overlapping versions are rejected.
