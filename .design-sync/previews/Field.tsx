import { Field } from "@wiz-sidekick/design-system";

export const Default = () => (
  <Field id="sla-window" label="SLA window" hint="Days allowed before a critical finding is overdue.">
    <input id="sla-window" type="number" defaultValue={30} />
  </Field>
);
