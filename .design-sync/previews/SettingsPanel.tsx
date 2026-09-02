import { SaveBar, SettingRow, SettingsPanel, SwitchToggle } from "@wiz-sidekick/design-system";

export const Default = () => (
  <SettingsPanel
    title="Remediation SLA"
    description="How long each severity may stay open before the register calls it overdue."
    footer={<SaveBar onSave={() => {}} onDiscard={() => {}} />}
  >
    <SettingRow label="Critical" description="Days before a critical finding is overdue." htmlFor="sla-crit">
      <SwitchToggle id="sla-crit" checked onChange={() => {}} />
    </SettingRow>
    <SettingRow label="High" description="Days before a high finding is overdue." htmlFor="sla-high">
      <SwitchToggle id="sla-high" onChange={() => {}} />
    </SettingRow>
  </SettingsPanel>
);
