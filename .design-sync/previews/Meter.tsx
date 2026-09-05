import { Meter } from "@wiz-sidekick/design-system";

export const Default = () => (
  <Meter value={68} label="Remediation coverage, 68 percent" />
);

export const Decorative = () => (
  <Meter value={34} decorative />
);
