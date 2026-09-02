import { SevBadge } from "@wiz-sidekick/design-system";

export const Scale = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <SevBadge severity="CRITICAL" />
    <SevBadge severity="HIGH" />
    <SevBadge severity="MEDIUM" />
    <SevBadge severity="LOW" />
    <SevBadge severity="INFO" />
  </div>
);
