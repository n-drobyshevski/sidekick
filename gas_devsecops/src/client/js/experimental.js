// "Show experimental content", this app's end of the shared gate.
//
// THE MODULE ITSELF IS `gas_shared/shell/experimental.js` NOW. The two copies of this file
// were 53 lines each and differed in exactly one character span — the `"sidekickdso."` in
// front of the storage key — which is what `MANIFEST.storagePrefix` is for. The shared module
// composes the key from it, so the stored value is byte-identical to what this fork already
// wrote and no reader loses the flag.
//
// This file stays as the seam, not as a second implementation: `pages/settings.js` and
// `helpContent.js` import `../experimental.js`, and a re-export keeps those specifiers
// resolving at their own relative depth — the same arrangement `ui.js` has over the shared
// component barrel. esbuild flattens the hop at build time.

export {
  onExperimentalChange, setShowExperimental, showExperimental,
} from "../../../../gas_shared/shell/experimental.js";
