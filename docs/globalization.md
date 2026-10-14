# Realy — Globalization

> Status: **Frozen for Phase 1.** Implemented in `src/i18n` and `src/server/modules/globalization`.

## 1. Independent dimensions (the core rule)

| Dimension | Stored on | Example |
|---|---|---|
| User locale (UI language + formatting) | `users.locale` | `en-US` |
| User country (where the person is) | `users.country_code` | `IN` |
| User timezone | `users.timezone` | `Asia/Dubai` |
| Company incorporation country | `companies.incorporation_country_code` | `AE` |
| Company operating countries | `companies.operating_country_codes[]` | `[AE, IN]` |
| Company target markets | `companies.target_market_codes[]` | `[US]` |
| Company base currency (books) | `companies.base_currency` | `AED` |
| Company default locale / timezone | `companies.default_locale`, `.timezone` | `en-AE`, `Asia/Dubai` |
| Data region (residency) | `companies.data_region` | `me-central` |
| Billing country (tax + price market) | `billing_profiles.billing_country_code` | `AE` |
| Billing currency | `billing_profiles.currency` | `AED` |

None is derived from another except as a **suggested default** the user confirms. IP geolocation is
only a hint for the first default of `users.country_code` and is never used for billing.
The founder-in-India / company-in-UAE / market-USA / Dubai-timezone / Middle-East-data scenario is a
required automated test.

## 2. Languages and locales

* Catalog: `src/i18n/messages/<locale>.json`, ICU MessageFormat (plurals, selects, number/date args).
* Phase 1 ships complete catalogs for **en-US, hi-IN, ar-AE, de-DE, zh-CN** (the test matrix); the
  architecture supports unlimited locales (add a JSON file + a `locales` row).
* Resolution order: explicit user preference → `realy_locale` cookie → `Accept-Language` best match →
  `en-US`. Missing keys fall back along `fallback_tag` (e.g. `en-GB → en-US`), then to `en-US`.
* **No user-facing string literals in components.** Everything renders via `t('namespace.key')`.
  Enforced by a CI test that scans `src/app` and `src/components` for JSX text literals, and a test
  that every locale has exactly the key set of `en-US`.
* Emails, notifications, invoices and server errors use the same catalogs (server-side `getT(locale)`).
  API error `message`s are English for developers; the UI maps `error.code` to a localized string.

## 3. Formatting

All formatting goes through `src/i18n/format.ts` using `Intl.*` with the active locale:
`formatMoney({amountMinor, currency}, locale)` (respects `currencies.minor_units`; `JPY` has 0),
`formatNumber`, `formatDate(date, locale, timeZone)`, `formatRelativeTime`, `formatList`.
Dates are stored in UTC and rendered in the viewer's timezone (or the company's, where the business
context requires it — e.g. a company deadline shows company time with the viewer's offset hint).

## 4. RTL

* `<html dir>` is set server-side from the locale's `direction` (`ar-*`, `he-*`, `fa-*`, `ur-*` → RTL).
* CSS uses **logical properties only**: `ms-*/me-*`, `ps-*/pe-*`, `start-*/end-*`, `text-start/end`,
  `border-s/e`. Physical `ml-/mr-/pl-/pr-/left-/right-/text-left/right` utilities are forbidden by a
  lint test.
* Directional icons (chevrons, arrows) flip via `rtl:-scale-x-100`.
* Numbers remain in the locale's numbering system as decided by `Intl` (Arabic UI uses Latin digits
  for `ar-AE` per common business usage; configurable via locale extension `-u-nu-arab`).

## 5. Countries and regions

* `countries` (ISO 3166-1 alpha-2) and `regions` are **data**, administered in the Admin Console, never
  `if (country === 'IN')` in code. Country-specific behavior is expressed as configuration:
  supported locales, currencies, payment methods, billing availability, tax configs, feature flags,
  and (Phase 7) country workflows (company formation, compliance calendars).
* Seeded regions: `US`, `EU`, `UK`, `MIDDLE_EAST`, `INDIA`, `APAC` (+ `LATAM`, `NORTH_AMERICA_OTHER`
  for BR/CA coverage). Each country belongs to exactly one *pricing* region.
* Seeded countries: US, GB, IN, AE, SG, DE, FR, CA, AU, JP, BR, CN, SA, NL, ES, IT, IE (extendable).

## 6. Currencies

ISO 4217 with `minor_units`: USD 2, EUR 2, GBP 2, INR 2, AED 2, SGD 2, CAD 2, AUD 2, JPY 0, CNY 2,
BRL 2, SAR 2. Monetary values everywhere are `{ amountMinor: bigint, currency }` (`Money` type).
Arithmetic on `Money` refuses mixed currencies. FX conversion (Phase 6 finance) uses dated rates
stored in `fx_rates` and is never applied to prices — each market has its own configured price.

## 7. Data residency

`companies.data_region ∈ {us-east, eu-west, me-central, ap-south, ap-southeast}`; regions map to a
default data region. Phase 1 runs a single physical cell; the column is recorded from day one and all
company-scoped storage keys are prefixed `<data_region>/<org>/<company>/…` so that regional cells
(database, object storage, vector index, workers) can be introduced by routing on `data_region`
without data model changes. Cross-region processing of company data by AI providers honors the
region's configured provider endpoints (Phase 3).

## 8. Global test matrix (automated)

| Persona | Locale | Dir | Currency | Billing country | Timezone |
|---|---|---|---|---|---|
| US user | en-US | ltr | USD | US | America/New_York |
| India user | hi-IN | ltr | INR | IN | Asia/Kolkata |
| UAE user | ar-AE | **rtl** | AED | AE | Asia/Dubai |
| Germany user | de-DE | ltr | EUR | DE | Europe/Berlin |
| China user (language check) | zh-CN | ltr | — | — | Asia/Shanghai |

Each asserts locale resolution, direction, resolved plan price & currency, money formatting, tax
config, timezone formatting, feature flags, and permissions.
