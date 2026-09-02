import { StatRow } from "@wiz-sidekick/design-system";

export const Default = () => (
  <StatRow name="SAST" value="412" sub="open findings" />
);

export const WithMeter = () => (
  <StatRow name="Remediated" value="68%" sub="within SLA window" meterPct={68} />
);
