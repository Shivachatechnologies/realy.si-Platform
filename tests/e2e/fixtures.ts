import { expect, test as base } from "@playwright/test";

/**
 * Every page in every spec is watched for Content-Security-Policy violations (console reports and
 * `securitypolicyviolation` events). A violation fails the test: the nonce CSP must actually hold.
 */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      const watch = (page: import("@playwright/test").Page) => {
        page.on("console", (msg) => {
          if (/Content Security Policy|Content-Security-Policy/i.test(msg.text())) violations.push(`${page.url()}: ${msg.text()}`);
        });
      };
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          console.error(`Content Security Policy violation: ${e.violatedDirective} blocked ${e.blockedURI}`);
        });
      });
      context.pages().forEach(watch);
      context.on("page", watch);
      await use(violations);
      expect(violations, "CSP violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
