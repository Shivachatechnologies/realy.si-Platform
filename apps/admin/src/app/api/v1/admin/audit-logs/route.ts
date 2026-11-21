import { z } from "zod";
import { route } from "@/server/core/http";
import { pageInput } from "@/server/core/pagination";
import { listAuditLogs } from "@/server/modules/audit/service";

const query = pageInput.extend({ category: z.enum(["TENANT", "ADMIN", "SECURITY"]).optional() });

export const GET = route({ auth: "required" }, async ({ req, ctx }) => listAuditLogs(ctx, null, query.parse(Object.fromEntries(req.nextUrl.searchParams))));
