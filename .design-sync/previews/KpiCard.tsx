import { KpiCard, StatusPill } from "@wiz-sidekick/design-system";

export const Default = () => (
  <KpiCard label="Mean time to remediate" value="18.4d" sub="across 1,284 findings" />
);

export const WithChip = () => (
  <KpiCard
    label="SLA compliance"
    value="87%"
    sub="critical findings, last 90 days"
    chip={<StatusPill kind="warn" text="Below target" />}
  />
);

export const WithHelp = () => (
  <KpiCard
    label="Open secrets"
    value="843"
    sub="removed is not rotated"
    help="A secret leaving the register means the string left HEAD. The credential is live until rotated_at says otherwise."
  />
);
