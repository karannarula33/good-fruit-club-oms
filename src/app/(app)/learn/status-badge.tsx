import { Badge, type BadgeTone } from "@/components/ui/badge";
import { STATUS_LABEL, type ModuleStatus } from "@/lib/training/progress";

const TONE: Record<ModuleStatus, BadgeTone> = {
  not_started: "neutral",
  in_progress: "info",
  completed: "success",
  needs_review: "warning",
};

export function TrainingStatusBadge({ status }: { status: ModuleStatus }) {
  return (
    <Badge key={status} tone={TONE[status]} size="sm">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
