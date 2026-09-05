import { Disclosure } from "@wiz-sidekick/design-system";

export const Default = () => (
  <Disclosure summary="Why this finding has no resolved date">
    <p className="small muted">
      SASTFinding exposes createdAt but no resolvedAt, and status: RESOLVED returns 0 rows.
      The ledger dates the death by disappearance instead.
    </p>
  </Disclosure>
);
