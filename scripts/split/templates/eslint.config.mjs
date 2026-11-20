import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** App isolation (docs/architecture/apps.md); scripts/split/check-boundaries.mjs enforces the same rules on resolved imports. */
const crossApp = (other) => ({
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        { group: [`**/apps/${other}/**`, `@realy/${other}`, `@realy/${other}/*`], message: `apps/${other} is a separate app — share code through packages/*.` },
        { group: [`@realy/api-client/${other}`, `**/api-client/src/${other}*`], message: `The ${other} API client entry is private to apps/${other}.` },
      ],
    },
  ],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: ["apps/user/", "apps/admin/"] } } },
  { files: ["apps/user/**"], rules: crossApp("admin") },
  { files: ["apps/admin/**"], rules: crossApp("user") },
  {
    files: ["packages/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/apps/**", "@realy/user", "@realy/admin", "@/components/*", "@/app/*"], message: "Packages never depend on an app." }] },
      ],
    },
  },
  globalIgnores([".next/**", "**/.next/**", "out/**", "build/**", "**/next-env.d.ts", "packages/database/src/generated/**"]),
]);

export default eslintConfig;
