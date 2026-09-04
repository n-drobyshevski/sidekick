// Fetch the Chart.js bundle on the first route that draws a chart, and run it.
//
// WHY THIS IS NOT AN `include()`. `doGet` has no idea which page the reader is on: routing is
// `location.hash` (store.js), which never reaches the server, and every navigation after the
// first is a hash change with no request behind it. A conditional partial could only ever be
// right for the first route of a session and wrong for the rest.
//
// WHY NOT A CDN. charts.js's own header says the bundling exists so the app works behind
// proxies that block or rewrite third-party script hosts — the same threat that produced the
// build's middlebox guard. Fetching Chart.js from a CDN would give that threat back the thing
// the bundle was written to take away from it.
//
// So the source comes over `google.script.run`, which is the app's only transport, and then
// has to be EXECUTED — and that is the part with a real unknown behind it.
//
// THE UNKNOWN, STATED PLAINLY. HtmlService serves the app inside a sandboxed iframe. Google
// documents the iframe's `sandbox` keywords and the HTTPS requirement for active content
// (developers.google.com/apps-script/guides/html/restrictions) and documents NO
// Content-Security-Policy at all — neither that one is set nor what it contains. This repo
// has no precedent for running code obtained at runtime, and the dev harness cannot settle it
// either: `dev/serve.mjs` serves partials as real `<script src>` files and sets no CSP, so all
// three mechanisms below succeed there whatever GAS would do. A claim about the deployed app
// would be a guess.
//
// So this tries three mechanisms in order and REPORTS FAILURE HONESTLY rather than assuming
// one works:
//
//   1. a `<script>` element with its `textContent` set     (needs `unsafe-inline`)
//   2. `new Function(src)()`                               (needs `unsafe-eval`)
//   3. a `blob:` URL as a script `src`                     (needs `blob:` in `script-src`)
//
// They are ordered by how likely a policy is to permit them and, second, by how little each
// costs when it fails: 1 and 2 fail synchronously.
//
// On rejection the two call sites keep their existing empty state and add one line saying the
// chart is unavailable. That is the trade this file makes: every route stops paying for
// Chart.js, and a deployment whose policy refuses all three loses its charts and is told so.

import { call } from "../../../../gas_shared/api.js";
import { el } from "./ui.js";

/** The global chartsBundle.js assigns to. */
const GLOBAL = "__WSK_CHARTS__";

/**
 * Memoized across the session — including the rejection.
 *
 * A REJECTION IS CACHED HERE. A refusal is a property of the deployment's policy, not a
 * transport blip, so re-running three blocked mechanisms on every navigation between chart
 * routes would cost an RPC and a console error each time to reach the same answer.
 */
let pending = null;

export function loadCharts() {
  if (!pending) pending = start();
  return pending;
}

async function start() {
  const src = await call("api_getChartsBundle", {});
  if (typeof src !== "string" || !src) throw new Error("empty charts bundle");
  return run(src);
}

function claim() {
  return window[GLOBAL] || null;
}

// Labelled by hand rather than off `fn.name`: the bundle is minified, so a function's own
// name is one or two letters by the time this string reaches a console.
const MECHANISMS = [
  ["script textContent", byScriptText],
  ["new Function", byFunction],
  ["blob: script src", byBlobUrl],
];

/** Try each mechanism in turn; the first that leaves the global behind wins. */
async function run(src) {
  const reasons = [];

  for (const [label, mechanism] of MECHANISMS) {
    try {
      await mechanism(src);
      const api = claim();
      if (api) return api;
      // No throw and no global: the element was accepted and its body silently not run,
      // which is what a CSP violation on an inline script looks like from script.
      reasons.push(label + ": ran without defining " + GLOBAL);
    } catch (e) {
      reasons.push(label + ": " + String((e && e.message) || e));
    }
  }
  throw new Error("no way to run the charts bundle in this deployment — " + reasons.join("; "));
}

function byScriptText(src) {
  const s = document.createElement("script");
  s.textContent = src;
  document.head.appendChild(s);
  // Removed either way: it has already run or it never will, and a large text node in the
  // head is nothing but weight afterwards.
  s.remove();
}

function byFunction(src) {
  // Scope is not a concern: the bundle is an IIFE whose only outward effect is the assignment
  // to `window.__WSK_CHARTS__`, so it does the same thing wherever it is evaluated.
  new Function(src)();
}

function byBlobUrl(src) {
  return new Promise((resolve, reject) => {
    let url = null;
    try {
      url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    } catch (e) {
      reject(e);
      return;
    }
    const s = document.createElement("script");
    const done = (fn, arg) => {
      s.remove();
      URL.revokeObjectURL(url);
      fn(arg);
    };
    s.onload = () => done(resolve);
    s.onerror = () => done(reject, new Error("blob script blocked"));
    s.src = url;
    document.head.appendChild(s);
  });
}

/**
 * Replace a chart's box with the app's own empty state and one honest line.
 *
 * `role="status"` because the message arrives after the page has painted, so a reader on a
 * screen reader is told rather than left with a box that quietly never fills.
 */
export function chartUnavailable(canvas) {
  const box = canvas.closest ? canvas.closest(".chart-box") : null;
  const target = box || canvas;
  const note = el("div", { class: "chart-empty", role: "status" },
    "Chart unavailable in this deployment.");
  if (target.parentNode) target.parentNode.replaceChild(note, target);
}
