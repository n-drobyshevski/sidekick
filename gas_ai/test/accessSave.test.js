// Settings → Access never drops an edit silently — the shared contract, run against this
// app's own editor (see gas_shared/test/contracts/accessSave.js).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { registerAccessSaveContract } from "../../gas_shared/test/contracts/accessSave.js";

const editorSrc = readFileSync(
  new URL("../src/client/js/pages/accessEditor.js", import.meta.url), "utf8",
);

registerAccessSaveContract({ describe, it, expect, editorSrc });
