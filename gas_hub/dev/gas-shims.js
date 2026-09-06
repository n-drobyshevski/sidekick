// In-browser fakes of the GAS services the server bundle touches, for local UI/UX
// work (dev/serve.mjs). Everything is in-memory and resets on reload; dev/boot.js
// seeds the Script Properties each load.
//
// TRIMMED FROM gas_devsecops/dev/gas-shims.js FROM 26KB TO THIS, and the list of what went
// is the list of what this app does not do: no Utilities (nothing gzips, base64s or sleeps),
// no LockService (no ledger to serialize writes to), no CacheService (nothing to memoize
// across a request), no DriveApp (no archives), no SpreadsheetApp (no ledger at all), and no
// ScriptApp trigger builder (no scheduled work). What is left is the four services the
// server bundle genuinely reaches: Script Properties, the caller's identity, this
// deployment's own URL, and HtmlService.
//
// ScriptApp.getService() IS SHIMMED HERE, WHERE THE REGISTERS DELIBERATELY LEAVE IT OUT.
// There it is unreachable in dev and `access.serviceUrl()` catches the ReferenceError, so a
// dev session degrades to a denial page with no switch-account link. Here the same call is
// the only reason `script.scriptapp` is in the manifest at all (deniedPage ->
// accountChooserUrl -> serviceUrl), so leaving it to throw would make the one path that
// scope exists for the one path the harness cannot show.

(function () {
  "use strict";

  // ------------------------------------------------------------ PropertiesService
  //
  // Counted, the way the register harnesses count theirs: a Properties read is a ~10-50ms
  // round trip in real GAS and free here, so a claim about cost can be MEASURED rather than
  // asserted. Deliberately NOT part of snapshot()/restore() — they describe what the code
  // just DID, not what the world currently holds.
  const counters = { propGet: 0, propSet: 0 };
  let propGetKeys = Object.create(null);

  const props = new Map();
  window.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => {
        counters.propGet++;
        propGetKeys[k] = (propGetKeys[k] || 0) + 1;
        return props.has(k) ? props.get(k) : null;
      },
      setProperty: (k, v) => { counters.propSet++; props.set(k, String(v)); },
      deleteProperty: (k) => { props.delete(k); },
      getProperties: () => Object.fromEntries(props),
      getKeys: () => [...props.keys()],
    }),
  };

  // --------------------------------------------------------------------- Session
  // Active and effective user are the same address on purpose: dev has no
  // domain/impersonation split, just the one person running their own script. That makes
  // the dev user the OWNER, so access.decide() admits them by identity and every guarded
  // entry point behaves exactly as it does in a deployment the same person deployed.
  window.Session = {
    getActiveUser: () => ({ getEmail: () => "dev@example.com" }),
    getEffectiveUser: () => ({ getEmail: () => "dev@example.com" }),
  };

  // ------------------------------------------------------------------- ScriptApp
  //
  // getService().getUrl() and nothing else — no trigger surface, because this project
  // installs no triggers. The /exec form is what a real deployment returns and what the
  // account-chooser link is built from; see this file's header for why it is shimmed here
  // and not in the registers.
  window.ScriptApp = {
    getService: () => ({
      getUrl: () => "https://script.google.com/a/macros/example.com/s/DEV_HUB_DEPLOYMENT/exec",
    }),
  };

  // ------------------------------------------------------------------- HtmlService
  //
  // Only `createHtmlOutputFromFile().getContent()`, served over /_partial by dev/serve.mjs.
  // `doGet` and `include` are not exercised here at all — dev/serve.mjs composes index.html
  // itself — so this is a backstop that keeps the call answering with the real file rather
  // than throwing, not a live path.
  //
  // SYNCHRONOUS, because the shim stands in for a GAS API that is synchronous and the server
  // bundle calls it with no await anywhere in the chain.
  window.HtmlService = {
    createHtmlOutputFromFile(name) {
      const req = new XMLHttpRequest();
      req.open("GET", "/_partial/" + name, false);
      req.send(null);
      if (req.status !== 200) throw new Error("No HTML file " + name);
      const content = req.responseText;
      return { getContent: () => content };
    },
  };

  // ------------------------------------------------------------------ test handle
  //
  // The same handle the register harnesses expose, over the only state this file holds.
  // test/gasEnv.ts evaluates this file in Node (aliasing `window` to `globalThis`) and uses
  // snapshot/restore to run a case against a known set of properties and put them back.
  window.__gasFakes = {
    /** Service calls made since the last resetCounters(). */
    counters() { return { ...counters, propGetKeys: { ...propGetKeys } }; },
    resetCounters() {
      for (const k of Object.keys(counters)) counters[k] = 0;
      propGetKeys = Object.create(null);
    },
    snapshot() {
      return { props: new Map(props) };
    },
    restore(snap) {
      props.clear();
      for (const [k, v] of snap.props) props.set(k, v);
    },
  };
})();
