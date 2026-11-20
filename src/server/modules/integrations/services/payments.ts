import "server-only";
import { providerFetch } from "../client";
import { recordUsage } from "../usage";
import { ensureOk, errorText, withFallback, type ServiceResult } from "./common";

/**
 * Hosted payment links (e.g. for finance invoices): Razorpay Payment Links or Stripe Payment Links, using the company's
 * own connected account. `amountMinor` is in the currency's minor unit (cents, paise).
 */

export const PAYMENT_LINK_PROVIDERS = ["razorpay", "stripe"] as const;

export interface PaymentLinkInput {
  amountMinor: number;
  /** ISO 4217, e.g. "INR", "EUR". */
  currency: string;
  description: string;
  /** Your reference (invoice number); echoed in provider metadata. */
  reference?: string;
  customer?: { name?: string; email?: string; phone?: string };
  providers?: readonly (typeof PAYMENT_LINK_PROVIDERS)[number][];
}

export interface PaymentLink {
  id: string;
  url: string;
  status: string;
}

export async function createPaymentLink(organizationId: string, companyId: string, input: PaymentLinkInput): Promise<ServiceResult<PaymentLink>> {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, code: "invalid_input", error: "Invalid currency", providerId: null, attempts: [] };
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 100 || input.amountMinor > 100_000_000_00) return { ok: false, code: "invalid_input", error: "Invalid amount", providerId: null, attempts: [] };
  const description = input.description.trim().slice(0, 240) || "Payment";
  const reference = input.reference?.replace(/[^\w./-]/g, "").slice(0, 40);
  // Razorpay settles INR-first accounts; prefer it for INR, Stripe first otherwise.
  const order = input.providers ?? (currency === "INR" ? PAYMENT_LINK_PROVIDERS : (["stripe", "razorpay"] as const));

  return withFallback(organizationId, companyId, order, async (conn) => {
    try {
      let link: PaymentLink;
      if (conn.provider === "razorpay") {
        const res = await providerFetch<{ id?: string; short_url?: string; status?: string }>(conn, "https://api.razorpay.com/v1/payment_links", {
          json: {
            amount: input.amountMinor,
            currency,
            description,
            ...(reference ? { reference_id: reference } : {}),
            ...(input.customer ? { customer: { name: input.customer.name, email: input.customer.email, contact: input.customer.phone } } : {}),
            notify: { sms: false, email: false },
          },
          retries: 1,
        });
        ensureOk(res, "Razorpay payment link");
        if (!res.data?.id || !res.data.short_url) throw new Error("Razorpay returned no link");
        link = { id: res.data.id, url: res.data.short_url, status: res.data.status ?? "created" };
      } else {
        const price = await providerFetch<{ id?: string }>(conn, "https://api.stripe.com/v1/prices", {
          form: { currency: currency.toLowerCase(), unit_amount: String(input.amountMinor), "product_data[name]": description },
          retries: 1,
        });
        ensureOk(price, "Stripe price");
        if (!price.data?.id) throw new Error("Stripe returned no price");
        const res = await providerFetch<{ id?: string; url?: string; active?: boolean }>(conn, "https://api.stripe.com/v1/payment_links", {
          form: { "line_items[0][price]": price.data.id, "line_items[0][quantity]": "1", ...(reference ? { "metadata[reference]": reference } : {}) },
          retries: 1,
        });
        ensureOk(res, "Stripe payment link");
        if (!res.data?.id || !res.data.url) throw new Error("Stripe returned no link");
        link = { id: res.data.id, url: res.data.url, status: res.data.active === false ? "inactive" : "active" };
      }
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: conn.provider, operation: "payments.link", status: "SUCCEEDED", estimatedCostMicros: 0, meta: { linkId: link.id, currency, amountMinor: input.amountMinor } });
      return link;
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: conn.provider, operation: "payments.link", status: "FAILED", error: errorText(err), meta: { currency } });
      throw err;
    }
  });
}
