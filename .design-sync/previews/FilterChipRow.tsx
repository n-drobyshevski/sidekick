import { FilterChipRow } from "@wiz-sidekick/design-system";

export const Default = () => (
  <FilterChipRow
    onPatch={() => {}}
    onClearAll={() => {}}
    entries={[
      { key: "sev", label: "Severity", value: "CRITICAL, HIGH" },
      { key: "scope", label: "Scope", value: "secrets" },
      { key: "repo", label: "Repository", value: "payments-api", isDefault: true },
    ]}
  />
);
