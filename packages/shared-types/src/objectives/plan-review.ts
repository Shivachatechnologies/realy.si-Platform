// Shared by packages/backend and the user app (moved from src/components/objectives/plan-review.tsx by scripts/split).

export interface DraftTask {
  key: string;
  include: boolean;
  title: string;
  description: string;
  assigneeId: string;
  dueDate: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  suggestion: string;
}

export interface DraftProject {
  key: string;
  include: boolean;
  name: string;
  description: string;
  ownerId: string;
  dueDate: string;
  suggestion: string;
  tasks: DraftTask[];
}

export interface DraftMilestone {
  key: string;
  include: boolean;
  title: string;
  dueDate: string;
  project: DraftProject | null;
}

export interface DraftKeyResult {
  key: string;
  include: boolean;
  title: string;
  source: "METRIC" | "MANUAL";
  metricKey: string;
  unit: string;
  baseline: string;
  target: string;
  direction: "INCREASE" | "DECREASE";
  /** The AI proposed a metric that is unknown or not visible; converted to a manual key result. */
  convertedFrom: string;
}

export interface DraftObjective {
  key: string;
  include: boolean;
  title: string;
  description: string;
  ownerId: string;
  departmentId: string;
  startDate: string;
  targetDate: string;
  suggestion: string;
  keyResults: DraftKeyResult[];
  milestones: DraftMilestone[];
}
