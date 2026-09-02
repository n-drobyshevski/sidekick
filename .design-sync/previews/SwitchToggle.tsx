import { SwitchToggle } from "@wiz-sidekick/design-system";

export const States = () => (
  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
    <SwitchToggle id="sw-on" checked ariaLabel="On" onChange={() => {}} />
    <SwitchToggle id="sw-off" ariaLabel="Off" onChange={() => {}} />
    <SwitchToggle id="sw-dis" checked disabled ariaLabel="Disabled" onChange={() => {}} />
  </div>
);
