import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HealthState } from "@/lib/types";

const MAP: Record<HealthState, { label: string; dot: string; className: string }> = {
  healthy: {
    label: "健康",
    dot: "bg-success",
    className: "border-success/40 text-success",
  },
  degraded: {
    label: "降级",
    dot: "bg-warning",
    className: "border-warning/40 text-warning",
  },
  down: {
    label: "故障",
    dot: "bg-destructive",
    className: "border-destructive/40 text-destructive",
  },
};

export function HealthBadge({ state }: { state: HealthState }) {
  const s = MAP[state];
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", s.className)}>
      <span className={cn("size-1.5 rounded-full animate-pulse-dot", s.dot)} />
      {s.label}
    </Badge>
  );
}

export function ProtocolBadge({ protocol }: { protocol: "openai" | "anthropic" }) {
  return (
    <Badge variant="secondary" className="font-mono text-[11px]">
      {protocol === "openai" ? "OpenAI" : "Anthropic"}
    </Badge>
  );
}
