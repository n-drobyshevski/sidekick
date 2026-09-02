import { EmptyState } from "@wiz-sidekick/design-system";

export const Default = () => (
  <EmptyState
    message="No secrets findings in this scope."
    hint="Severity defaults to MEDIUM and above here — PASSWORD and CERTIFICATE both sit below HIGH."
  />
);
