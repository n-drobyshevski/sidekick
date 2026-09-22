// The implementation is shared: gas_shared/build/whichBuild.mjs.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { whichBuild } from "../gas_shared/build/whichBuild.mjs";
whichBuild(dirname(fileURLToPath(import.meta.url)));
