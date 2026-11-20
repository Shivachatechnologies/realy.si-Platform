// Shared by packages/backend and the user app (moved from src/components/ui/world.tsx by scripts/split).

export const WORLD_NAMES = [
  "command",
  "brain",
  "sales",
  "marketing",
  "finance",
  "people",
  "projects",
  "product",
  "support",
  "automation",
  "integrations",
  "marketplace",
  "settings",
] as const;

export type WorldName = (typeof WORLD_NAMES)[number];
