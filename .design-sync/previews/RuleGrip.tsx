import { RuleGrip } from "@wiz-sidekick/design-system";

export const InContext = () => (
  <div style={{ width: 360, display: "grid", gap: 4 }}>
    {["Exploitability", "Asset exposure", "Data sensitivity"].map((label) => (
      <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)" }}>
        <RuleGrip />
        <span>{label}</span>
      </div>
    ))}
  </div>
);
