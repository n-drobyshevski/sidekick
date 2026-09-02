import { TokenList } from "@wiz-sidekick/design-system";

export const Default = () => (
  <TokenList
    ariaLabel="Repositories"
    values={["payments-api", "ledger-svc"]}
    options={["payments-api", "ledger-svc", "report-gen", "auth-edge"]}
    onChange={() => {}}
  />
);
