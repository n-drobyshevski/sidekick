import { Select } from "@wiz-sidekick/design-system";

export const Default = () => (
  <Select
    ariaLabel="Rows per page"
    value="50"
    onChange={() => {}}
    options={["25", "50", "100", "250"]}
  />
);
