"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface GuideScopeValue {
  orgId: string | null;
  companyId: string | null;
}

const GuideScopeContext = createContext<GuideScopeValue>({ orgId: null, companyId: null });

/** Active organization/company for guide components (mounted once by the app layout). */
export function GuideScopeProvider({ value, children }: { value: GuideScopeValue; children: ReactNode }) {
  return <GuideScopeContext value={value}>{children}</GuideScopeContext>;
}

export const useGuideScope = () => useContext(GuideScopeContext);

/** API base for the active company, or null without one. */
export function companyApi(scope: { orgId: string | null; companyId: string | null }): string | null {
  return scope.orgId && scope.companyId ? `/api/v1/organizations/${scope.orgId}/companies/${scope.companyId}` : null;
}
