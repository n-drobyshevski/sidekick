import { Select, SelectField } from "@wiz-sidekick/design-system";

export const Default = () => (
  <SelectField label="Order">
    <Select
      ariaLabel="Order"
      value="mttr"
      onChange={() => {}}
      options={[
        { value: "mttr", label: "Slowest to fix" },
        { value: "age", label: "Oldest first" },
      ]}
    />
  </SelectField>
);
