-- G6 (B22): per-workflow autonomy for external actions (docs/automation.md §Autonomy). Additive only.

-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "autonomy_mode" "AutopilotMode" NOT NULL DEFAULT 'APPROVAL_REQUIRED';
