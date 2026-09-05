import { TriCell } from "@wiz-sidekick/design-system";

export const States = () => (
  <div style={{ display: "flex", gap: 16 }}>
    <TriCell value={true} />
    <TriCell value={false} />
    <TriCell value={null} />
  </div>
);
