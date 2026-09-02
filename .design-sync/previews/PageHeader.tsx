import { HeroStat, PageHeader, SevSegmentBar, StatRow } from "@wiz-sidekick/design-system";

export const Default = () => (
  <PageHeader
    hero={<HeroStat label="Median time to remediate" value="18.4 days" sub="1,284 findings closed" />}
    aside={<SevSegmentBar counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 }} label="Open findings by severity" />}
    stats={
      <>
        <StatRow name="SAST" value="412" sub="open" />
        <StatRow name="SCA" value="318" sub="open" />
        <StatRow name="Secrets" value="843" sub="open" />
      </>
    }
  />
);
