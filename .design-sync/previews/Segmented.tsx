import { Segmented } from "@wiz-sidekick/design-system";

export const Default = () => (
  <Segmented
    ariaLabel="Register scope"
    value="sast"
    onChange={() => {}}
    options={[
      { value: "sast", label: "SAST" },
      { value: "sca", label: "SCA" },
      { value: "secrets", label: "Secrets" },
    ]}
  />
);
