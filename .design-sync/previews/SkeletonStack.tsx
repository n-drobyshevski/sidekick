import { SkeletonStack } from "@wiz-sidekick/design-system";

export const Default = () => (
  <div style={{ width: 320 }}>
    <SkeletonStack count={4} widths={["100%", "82%", "94%", "60%"]} />
  </div>
);
