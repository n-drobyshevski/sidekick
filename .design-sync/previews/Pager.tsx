import { Pager } from "@wiz-sidekick/design-system";

export const Paged = () => (
  <Pager page={2} pageCount={12} total={573} onPage={() => {}} />
);

export const SinglePage = () => (
  <Pager page={0} pageCount={1} total={18} onPage={() => {}} />
);
