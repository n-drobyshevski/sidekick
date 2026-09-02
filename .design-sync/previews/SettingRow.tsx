import { SettingRow, SwitchToggle } from "@wiz-sidekick/design-system";

export const Default = () => (
  <SettingRow
    label="Count open findings as right-censored"
    description="Keeps unresolved findings in the MTTR curve instead of dropping them."
    htmlFor="censor"
  >
    <SwitchToggle id="censor" checked onChange={() => {}} />
  </SettingRow>
);
