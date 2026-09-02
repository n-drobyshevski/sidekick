import { SevBadge, SheetRow, SheetSection } from "@wiz-sidekick/design-system";

export const Default = () => (
  <SheetSection label="Findings">
    <SheetRow
      title="Hardcoded credential in config/database.yml"
      note="payments-api · line 42"
      badge={<SevBadge severity="CRITICAL" />}
    />
  </SheetSection>
);
