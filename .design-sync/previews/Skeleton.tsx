import { Skeleton } from "@wiz-sidekick/design-system";

export const Variants = () => (
  <div style={{ display: "grid", gap: 12, width: 320 }}>
    <Skeleton variant="title" />
    <Skeleton variant="line" />
    <Skeleton variant="line" width="70%" />
    <Skeleton variant="stat" />
  </div>
);
