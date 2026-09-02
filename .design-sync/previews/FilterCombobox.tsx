import { FilterCombobox } from "@wiz-sidekick/design-system";

export const Default = () => (
  <FilterCombobox
    ariaLabel="Repository"
    value="payments-api"
    onChange={() => {}}
    options={["payments-api", "ledger-svc", "report-gen", "auth-edge"]}
  />
);
