import { TogglePills } from "@wiz-sidekick/design-system";

export const Severity = () => (
  <TogglePills
    ariaLabel="Severity filter"
    selected={["CRITICAL", "HIGH"]}
    onToggle={() => {}}
    options={["CRITICAL", "HIGH", "MEDIUM", "LOW"]}
  />
);
