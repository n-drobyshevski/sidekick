import { TabList } from "@wiz-sidekick/design-system";

export const Default = () => (
  <TabList
    ariaLabel="Register"
    active="sast"
    onSelect={() => {}}
    tabs={[
      { id: "sast", label: "SAST" },
      { id: "sca", label: "SCA" },
      { id: "secrets", label: "Secrets" },
    ]}
  />
);
