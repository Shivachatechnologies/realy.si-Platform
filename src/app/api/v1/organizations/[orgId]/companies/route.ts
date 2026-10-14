import { body, route } from "@/server/core/http";
import { pageInput } from "@/server/core/pagination";
import { createCompany, createCompanyInput, listCompanies } from "@/server/modules/companies/service";

type P = { orgId: string };

export const GET = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId }) =>
  listCompanies(ctx, orgId, pageInput.parse(Object.fromEntries(req.nextUrl.searchParams))),
);
export const POST = route<P>({ auth: "required" }, async ({ req, ctx }, { orgId }) => createCompany(ctx, orgId, await body(req, createCompanyInput)));
