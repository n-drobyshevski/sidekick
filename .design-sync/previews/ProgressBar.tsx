import { ProgressBar } from "@wiz-sidekick/design-system";

export const Determinate = () => (
  <ProgressBar pct={62} />
);

export const Indeterminate = () => (
  <ProgressBar pct={null} />
);
