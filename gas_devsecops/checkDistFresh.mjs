// The implementation is shared: gas_shared/build/checkDistFresh.mjs.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDistFresh } from "../gas_shared/build/checkDistFresh.mjs";
checkDistFresh(dirname(fileURLToPath(import.meta.url)));
