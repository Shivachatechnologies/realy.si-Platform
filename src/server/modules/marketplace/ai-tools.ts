import { z } from "zod";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { installListing, listInstallations } from "./install";
import { LISTING_TYPES, manifestCounts } from "./manifest";
import { searchListings } from "./service";

/** AI tools of the marketplace module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const MARKETPLACE_TOOLS: Record<string, ToolDefinition> = {
  read_marketplace_listings: def({
    name: "read_marketplace_listings",
    version: 1,
    description:
      "Search the marketplace (company and department templates, industry blueprints, AI employees, skills, workflows, integrations). Returns each listing's key, type, latest version, what it installs and whether this company already installed it.",
    input: z
      .object({
        query: z.string().trim().max(120).optional(),
        type: z.enum(LISTING_TYPES).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords, e.g. saas or support",
        },
        type: { type: "string", enum: [...LISTING_TYPES] },
      },
      required: [],
      additionalProperties: false,
    },
    permissions: ["marketplace.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ query, type }) => `Search the marketplace${query ? ` for "${query}"` : ""}${type ? ` (${type})` : ""}`,
    async execute({ query, type }, { ctx, organizationId, companyId }) {
      const [{ data }, installed] = await Promise.all([
        searchListings(ctx, organizationId, {
          q: query,
          type,
          sort: "popular",
          page: 1,
        }),
        listInstallations(ctx, organizationId, companyId),
      ]);
      if (!data.length) return { content: "No listings match.", count: 0 };
      const have = new Map(installed.map((i) => [i.listingKey, i.version]));
      const content = data
        .map((l) => {
          const c = l.versions[0] ? manifestCounts(l.versions[0].manifest) : null;
          const parts = c
            ? Object.entries(c)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${n} ${k}`)
                .join(", ")
            : "";
          const status = have.has(l.key) ? `installed v${have.get(l.key)}` : "not installed";
          return `- ${l.key} [${l.type}] ${l.name} v${l.latestVersion ?? "?"} (${l.pricingModel}, ${status}): ${l.summary}${parts ? `\n  Installs: ${parts}` : ""}`;
        })
        .join("\n");
      return { content, count: data.length };
    },
  }),

  install_template: def({
    name: "install_template",
    version: 1,
    description:
      "Propose installing a free marketplace listing (by key, e.g. realy/saas-company) into this company. Creates departments, teams, roles, projects with tasks and objectives; existing names are skipped. A person must approve it first.",
    input: z
      .object({
        listingKey: z.string().min(3).max(140),
        version: z.string().max(20).optional(),
      })
      .strict(),
    modelSchema: {
      type: "object",
      properties: {
        listingKey: {
          type: "string",
          description: "Listing key from read_marketplace_listings",
        },
        version: {
          type: "string",
          description: "Optional version; latest by default",
        },
      },
      required: ["listingKey"],
      additionalProperties: false,
    },
    permissions: ["marketplace.install"],
    risk: "HIGH",
    autonomy: "SUPERVISED",
    timeoutMs: 60_000,
    summarize: ({ listingKey, version }) => `Install ${listingKey}${version ? ` v${version}` : ""} into the company`,
    async execute({ listingKey, version }, { ctx, organizationId, companyId }) {
      const r = await installListing(ctx, organizationId, companyId, {
        listingKey,
        version,
        config: {},
      });
      const lines = Object.entries(r.summary).map(
        ([k, s]) =>
          `${k.replace(/^_/, "")}: ${s.created} created, ${s.skipped} skipped${s.pending ? " (pending module wiring)" : ""}${s.forbidden ? ` (skipped: needs ${s.forbidden})` : ""}`,
      );
      return {
        content: `Installed ${r.listingKey} v${r.version}.\n${lines.join("\n")}`,
        records: [`marketplace_installation:${r.id}`],
      };
    },
  }),
};
