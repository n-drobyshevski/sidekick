import { AxisBar } from "@wiz-sidekick/design-system";

export const Default = () => (
  <div style={{ width: 420 }}>
    <AxisBar
      unit="findings"
      values={["CRITICAL", "HIGH", "MEDIUM", "LOW"]}
      reading={{
        total: 392,
        counts: { CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 },
        unknowns: { MEDIUM: 40, LOW: 18 },
      }}
    />
  </div>
);
