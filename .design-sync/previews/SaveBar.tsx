import { SaveBar } from "@wiz-sidekick/design-system";

export const Default = () => (
  <SaveBar
    countText="3 unsaved changes"
    changes={[
      { label: "Critical SLA", tab: "sla", tabLabel: "SLA" },
      { label: "High SLA", tab: "sla", tabLabel: "SLA" },
      { label: "Right-censoring", tab: "metrics", tabLabel: "Metrics" },
    ]}
    onSave={() => {}}
    onDiscard={() => {}}
    onJump={() => {}}
  />
);
