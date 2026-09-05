import { StatusPill } from "@wiz-sidekick/design-system";

export const AllStates = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <StatusPill kind="ok" text="Within SLA" />
    <StatusPill kind="warn" text="Due in 3d" />
    <StatusPill kind="bad" text="Overdue" />
    <StatusPill kind="neutral" text="Not assessed" />
  </div>
);
