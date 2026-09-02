import { SevBadge, SheetRow } from "@wiz-sidekick/design-system";

export const Default = () => (
  <SheetRow
    title="Hardcoded credential in config/database.yml"
    note="payments-api · first seen 41 days ago"
    fix="Move the value to a secret manager and rotate the credential — removal from HEAD is not rotation."
    badge={<SevBadge severity="CRITICAL" />}
  />
);
