import { ErrorState } from "@wiz-sidekick/design-system";

export const Default = () => (
  <ErrorState
    message="Could not reach the Wiz API."
    onRetry={() => {}}
    detail="HTTP 400 VALIDATION_INVALID_TYPE_VARIABLE: SASTFindingFilters.severity expects SASTSeverityFilter"
  />
);
