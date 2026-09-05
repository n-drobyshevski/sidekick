import { SevSegmentBar } from "@wiz-sidekick/design-system";

export const Default = () => (
  <SevSegmentBar
    counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 }}
    label="Open findings by severity"
  />
);

export const Sizes = () => (
  <div style={{ display: "grid", gap: 12, width: 360 }}>
    <SevSegmentBar size="sm" counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210 }} label="Small" />
    <SevSegmentBar size="md" counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210 }} label="Medium" />
    <SevSegmentBar size="lg" counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210 }} label="Large" />
  </div>
);
