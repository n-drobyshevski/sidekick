"use strict";
var Server = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/server/index.ts
  var index_exports = {};
  __export(index_exports, {
    access: () => access_exports,
    api: () => api_exports,
    deploymentDiagnostic: () => deploymentDiagnostic,
    devSeed: () => devSeed_exports,
    doGet: () => doGet,
    include: () => include,
    readModels: () => readModels_exports,
    scanJobs: () => scanJobs_exports,
    setup: () => setup,
    welcome: () => welcome_exports
  });

  // src/server/main.ts
  function doGet(_e) {
    const template = HtmlService.createTemplateFromFile("index");
    return template.evaluate().setTitle("Wiz Sidekick DevSecOps").addMetaTag("viewport", "width=device-width, initial-scale=1").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }
  function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }

  // src/server/access.ts
  var access_exports = {};
  __export(access_exports, {
    PRODUCT: () => PRODUCT,
    __resetMemosForTest: () => __resetMemosForTest,
    accountChooserUrl: () => accountChooserUrl,
    assertAllowed: () => assertAllowed,
    canEditAdmins: () => canEditAdmins,
    canEditUsers: () => canEditUsers,
    check: () => check,
    contactMailto: () => contactMailto,
    currentAdmins: () => currentAdmins,
    currentUsers: () => currentUsers,
    decide: () => decide,
    deniedHtml: () => deniedHtml,
    deniedPage: () => deniedPage,
    denyResult: () => denyResult,
    isOwner: () => isOwner,
    ownerDomain: () => ownerDomain,
    ownerEmail: () => ownerEmail,
    parseAllowlist: () => parseAllowlist,
    serviceUrl: () => serviceUrl
  });

  // src/server/pageShell.ts
  var MARK_COMPACT_VIEWBOX = "12.2 8.4 52.7 74";
  var MARK_COMPACT_RATIO = 52.7 / 74;
  var MARK_ORBIT = "M47.64 80.58A32.1 32.1 0 0 1 17.83 52.04M19.82 36.92A32.1 32.1 0 0 1 54.21 16.76";
  var MARK_ORBIT_WIDTH = 2.41;
  var MARK_NODES = [[17.22, 44.33, 4.41], [45.96, 16.55, 7.56]];
  var MARK_SHIELD = "M48.56 29.88C52.79 34.78 58.69 37.87 64.33 37.81C64.44 45.48 63.64 48.51 62.11 51.96C61.32 54.62 56.36 61.55 48.56 64.18C40.76 61.55 35.8 54.62 35.01 51.96C33.48 48.51 32.68 45.48 32.79 37.81C38.43 37.87 44.33 34.78 48.56 29.88Z";
  var MARK_CHECK = "M42.3 48.81 46.19 52.7 54.89 43.99";
  var MARK_CHECK_WIDTH = 3.04;
  function brandMarkSvg(height) {
    const width = Math.round(height * MARK_COMPACT_RATIO * 100) / 100;
    const nodes = MARK_NODES.map(
      (n2) => '<circle cx="' + n2[0] + '" cy="' + n2[1] + '" r="' + n2[2] + '" fill="#0a0a0a"/>'
    ).join("");
    return [
      '<svg class="brand-mark" viewBox="' + MARK_COMPACT_VIEWBOX + '"',
      ' width="' + width + '" height="' + height + '" focusable="false" aria-hidden="true">',
      '<path d="' + MARK_ORBIT + '" fill="none" stroke="#0a0a0a" stroke-width="' + MARK_ORBIT_WIDTH,
      '" stroke-linecap="round"/>',
      nodes,
      '<path d="' + MARK_SHIELD + '" fill="#0a0a0a"/>',
      '<path d="' + MARK_CHECK + '" fill="none" stroke="#ffffff" stroke-width="' + MARK_CHECK_WIDTH,
      '" stroke-linecap="round" stroke-linejoin="round"/>',
      "</svg>"
    ].join("");
  }
  function escapeHtml(s2) {
    return s2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function primaryAction(href, label) {
    return '<a class="btn" target="_top" href="' + escapeHtml(href) + '">' + escapeHtml(label) + "</a>";
  }
  function secondaryAction(href, label) {
    return '<a class="alt" target="_top" href="' + escapeHtml(href) + '">' + escapeHtml(label) + "</a>";
  }
  function cardPage(spec) {
    const body = spec.paragraphs.map((p) => "<p>" + p + "</p>").join("");
    const actions = spec.actions ? '<div class="actions">' + spec.actions + "</div>" : "";
    return [
      '<!DOCTYPE html><html><head><meta charset="utf-8">',
      // Every link on these pages has to break out of the HtmlService sandbox iframe; the app's
      // own index.html carries the same base tag for the same reason.
      '<base target="_top">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>" + escapeHtml(spec.title) + "</title><style>",
      "*{box-sizing:border-box}",
      // --surface / --ink, and the same --font stack tokens.css:254 carries.
      "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;",
      "background:#f8f8fa;color:#171717;",
      "font-family:-apple-system,BlinkMacSystemFont,Inter,'Segoe UI',Roboto,'Helvetica Neue',sans-serif}",
      // --page on --hairline at --radius-xl.
      ".card{max-width:32rem;margin:24px;padding:32px;background:#ffffff;border:1px solid #e6e6e9;",
      "border-radius:14px;box-shadow:0 1px 2px rgba(10,10,10,.06)}",
      ".lockup{display:flex;align-items:center;gap:8px;margin:0 0 16px}",
      // Mirrors .appbar-name in base.css (600 / --fs-lead 16px / -0.02em / --ink) so the
      // wordmark is the same object here as in the header, not a near-miss of it.
      ".lockup span{font-weight:600;font-size:1rem;letter-spacing:-0.02em;color:#171717;",
      "white-space:nowrap}",
      ".brand-mark{display:block;flex:0 0 auto}",
      "h1{font-size:20px;line-height:1.3;margin:0 0 12px;font-weight:650}",
      // --text-2, the same alpha the app's prose carries.
      "p{margin:0 0 8px;font-size:14px;line-height:1.6;color:rgba(0,0,0,.65)}",
      ".actions{margin-top:24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}",
      // Graphite, not the accent: DESIGN.md keeps the accent for data, focus and links, and
      // fills the one committing action with --graphite / --on-graphite.
      ".btn{display:inline-flex;align-items:center;min-height:36px;padding:6px 14px;",
      "border-radius:8px;background:#0a0a0a;color:#fafafa;font-size:14px;font-weight:500;",
      "text-decoration:none}",
      ".btn:hover{background:#27272a}",
      // --accent-text. NOT --accent: this page is plain text on white, where #ffcb13 is 1.52:1.
      // pages are the product's front door and must read as this product.
      "a{color:#7c4a0a}",
      // Never remove: CLAUDE.md names the focus-ring rules load-bearing, and these pages are
      // reachable by keyboard only.
      "a:focus-visible{outline:2px solid #7c4a0a;outline-offset:2px;border-radius:4px}",
      '</style></head><body><main class="card">',
      // The same lockup as the app header — mark then wordmark — so the door and the room
      // behind it are recognisably one product.
      '<div class="lockup">' + brandMarkSvg(22) + "<span>" + escapeHtml(spec.eyebrow) + "</span></div>",
      "<h1>" + escapeHtml(spec.heading) + "</h1>",
      body,
      actions,
      "</main></body></html>"
    ].join("");
  }

  // src/server/props.ts
  var PROP_KEYS = {
    wizApiToken: "WIZ_API_TOKEN",
    wizClientId: "WIZ_CLIENT_ID",
    wizClientSecret: "WIZ_CLIENT_SECRET",
    wizAuthUrl: "WIZ_AUTH_URL",
    wizApiUrl: "WIZ_API_URL",
    wizProjectIdV2: "WIZ_PROJECT_ID_V2",
    ledgerSpreadsheetId: "LEDGER_SPREADSHEET_ID",
    archiveFolderId: "ARCHIVE_FOLDER_ID",
    // Who may open the web app, on top of the deployment's own "anyone within <domain>" fence.
    // Comma/semicolon/whitespace-separated addresses; see server/access.ts. Unset means nobody —
    // the guard fails closed, and the owner is allowed by identity rather than by this list.
    allowedUsers: "ALLOWED_USERS",
    // Who may EDIT that list. Owner-only to change; see the admin-tier note in access.ts.
    // Unset means owner-only, like its sibling. Admins are allowed into the app by being admins,
    // not by also appearing in ALLOWED_USERS.
    allowedAdmins: "ALLOWED_ADMINS",
    // The warm schedule setup() last installed, as a signature string. A ClockTrigger exposes
    // its handler and nothing else, so this is the ONLY way to tell a correctly-scheduled set
    // from one an older deployment left behind. Written by setup(), read by setup().
    warmTriggerSchedule: "WARM_TRIGGER_SCHEDULE"
  };
  var DEFAULT_WIZ_AUTH_URL = "https://auth.app.wiz.io/oauth/token";
  function getProp(key) {
    return PropertiesService.getScriptProperties().getProperty(key);
  }
  function requireProp(key) {
    const v = getProp(key);
    if (!v) {
      throw new Error(`Missing Script Property ${key} \u2014 run setup() or set it in Project Settings > Script Properties.`);
    }
    return v;
  }
  function setProp(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, value);
  }
  function deleteProp(key) {
    PropertiesService.getScriptProperties().deleteProperty(key);
  }
  function projectScope() {
    const id = getProp(PROP_KEYS.wizProjectIdV2);
    return id && id.trim() ? [id.trim()] : null;
  }
  function resolveWizAuthMode(token, clientId, clientSecret) {
    if (token && token.trim()) return "token";
    if (clientId && clientSecret) return "oauth";
    return null;
  }
  function hasWizCredentials() {
    return Boolean(getProp(PROP_KEYS.wizApiUrl)) && resolveWizAuthMode(
      getProp(PROP_KEYS.wizApiToken),
      getProp(PROP_KEYS.wizClientId),
      getProp(PROP_KEYS.wizClientSecret)
    ) !== null;
  }

  // src/server/access.ts
  var PRODUCT = "Wiz Sidekick DevSecOps";
  var DENIAL_MESSAGE = {
    anonymous: "This app can't identify your Google account. It only recognizes accounts signed in to the same Google Workspace domain as the app.",
    "not-listed": "Your account isn't on this app's access list."
  };
  function parseAllowlist(raw) {
    if (!raw) return [];
    const seen = {};
    const out = [];
    for (const part of raw.split(/[,;\s]+/)) {
      const email = part.trim().toLowerCase();
      if (!email || seen[email]) continue;
      seen[email] = true;
      out.push(email);
    }
    return out;
  }
  function decide(active, owner, raw, adminsRaw) {
    const email = (active || "").trim();
    const key = email.toLowerCase();
    if (!key) return { allowed: false, email: "", reason: "anonymous" };
    const ownerKey = (owner || "").trim().toLowerCase();
    if (ownerKey && ownerKey === key) return { allowed: true, email, reason: "owner" };
    if (parseAllowlist(adminsRaw != null ? adminsRaw : null).indexOf(key) >= 0) {
      return { allowed: true, email, reason: "admin" };
    }
    return parseAllowlist(raw).indexOf(key) >= 0 ? { allowed: true, email, reason: "listed" } : { allowed: false, email, reason: "not-listed" };
  }
  var memo;
  function check() {
    if (memo === void 0) {
      memo = decide(
        Session.getActiveUser().getEmail(),
        Session.getEffectiveUser().getEmail(),
        getProp(PROP_KEYS.allowedUsers),
        getProp(PROP_KEYS.allowedAdmins)
      );
    }
    return memo;
  }
  function __resetMemosForTest() {
    memo = void 0;
  }
  function logDenial(op, d) {
    console.log(JSON.stringify({ access: "denied", op, reason: d.reason, email: d.email }));
  }
  function denyResult(op) {
    const d = check();
    if (d.allowed) return null;
    logDenial(op, d);
    const env = {
      ok: false,
      error: DENIAL_MESSAGE[d.reason] || DENIAL_MESSAGE["not-listed"],
      errorKind: "forbidden"
    };
    const who = ownerEmail().trim();
    if (who) {
      env.contact = who;
      env.contactUrl = contactMailto(who);
    }
    return env;
  }
  function assertAllowed(op) {
    const d = check();
    if (d.allowed) return;
    logDenial(op, d);
    throw new Error(DENIAL_MESSAGE[d.reason] || DENIAL_MESSAGE["not-listed"]);
  }
  function contactMailto(email) {
    return "mailto:" + email.trim() + "?subject=" + encodeURIComponent("Access to " + PRODUCT);
  }
  function deniedHtml(d, switchUrl, contact) {
    const detail = d.email ? "You're signed in as <strong>" + escapeHtml(d.email) + "</strong>." : "This app can't see which Google account you're signed in as, which happens when the account isn't in the same Google Workspace domain as the app.";
    const who = (contact || "").trim();
    const ask = who ? 'If you think you should have access, contact <a href="' + escapeHtml(contactMailto(who)) + '">' + escapeHtml(who) + "</a>." : (
      // No owner address resolved — never render "contact:" with nothing after it.
      "If you think you should have access, ask whoever runs this dashboard to add you."
    );
    return cardPage({
      title: PRODUCT,
      eyebrow: PRODUCT,
      heading: "You don't have access to this app.",
      paragraphs: [detail, ask],
      actions: switchUrl ? secondaryAction(switchUrl, "Switch Google account") : ""
    });
  }
  function deniedPage() {
    const d = check();
    if (d.allowed) return null;
    logDenial("doGet", d);
    return HtmlService.createHtmlOutput(deniedHtml(d, accountChooserUrl(), ownerEmail())).setTitle(PRODUCT).addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
  function serviceUrl() {
    try {
      return ScriptApp.getService().getUrl() || null;
    } catch (_e) {
      return null;
    }
  }
  function accountChooserUrl() {
    const url = serviceUrl();
    return url ? "https://accounts.google.com/AccountChooser?continue=" + encodeURIComponent(url) : null;
  }
  function ownerEmail() {
    return Session.getEffectiveUser().getEmail() || "";
  }
  function isOwner() {
    return check().reason === "owner";
  }
  function canEditUsers() {
    const r = check().reason;
    return r === "owner" || r === "admin";
  }
  function canEditAdmins() {
    return isOwner();
  }
  function currentUsers() {
    return parseAllowlist(getProp(PROP_KEYS.allowedUsers));
  }
  function currentAdmins() {
    return parseAllowlist(getProp(PROP_KEYS.allowedAdmins));
  }
  function ownerDomain() {
    const at = ownerEmail().lastIndexOf("@");
    return at >= 0 ? ownerEmail().slice(at + 1).toLowerCase() : "";
  }

  // src/server/welcome.ts
  var welcome_exports = {};
  __export(welcome_exports, {
    ENTER_PARAM: () => ENTER_PARAM,
    ENTRY_TTL_SEC: () => ENTRY_TTL_SEC,
    gate: () => gate,
    welcomeHtml: () => welcomeHtml
  });

  // src/domain/sha1.ts
  function utf8Bytes(s2) {
    const out = [];
    for (let i = 0; i < s2.length; i++) {
      let c = s2.charCodeAt(i);
      if (c < 128) {
        out.push(c);
      } else if (c < 2048) {
        out.push(192 | c >> 6, 128 | c & 63);
      } else if (c >= 55296 && c <= 56319 && i + 1 < s2.length) {
        const c2 = s2.charCodeAt(++i);
        const cp = 65536 + (c - 55296 << 10) + (c2 - 56320);
        out.push(
          240 | cp >> 18,
          128 | cp >> 12 & 63,
          128 | cp >> 6 & 63,
          128 | cp & 63
        );
      } else {
        out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      }
    }
    return out;
  }
  function rotl(n2, b) {
    return (n2 << b | n2 >>> 32 - b) >>> 0;
  }
  function sha1Hex(input) {
    const bytes = utf8Bytes(input);
    const bitLen = bytes.length * 8;
    bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 4294967296);
    bytes.push(hi >>> 24 & 255, hi >>> 16 & 255, hi >>> 8 & 255, hi & 255);
    bytes.push(bitLen >>> 24 & 255, bitLen >>> 16 & 255, bitLen >>> 8 & 255, bitLen & 255);
    let h0 = 1732584193, h1 = 4023233417, h2 = 2562383102, h3 = 271733878, h4 = 3285377520;
    const w = new Array(80);
    for (let block = 0; block < bytes.length; block += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = (bytes[block + i * 4] << 24 | bytes[block + i * 4 + 1] << 16 | bytes[block + i * 4 + 2] << 8 | bytes[block + i * 4 + 3]) >>> 0;
      }
      for (let i = 16; i < 80; i++) {
        w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) {
          f = b & c | ~b & d;
          k = 1518500249;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 1859775393;
        } else if (i < 60) {
          f = b & c | b & d | c & d;
          k = 2400959708;
        } else {
          f = b ^ c ^ d;
          k = 3395469782;
        }
        const t = rotl(a, 5) + f + e + k + w[i] >>> 0;
        e = d;
        d = c;
        c = rotl(b, 30);
        b = a;
        a = t;
      }
      h0 = h0 + a >>> 0;
      h1 = h1 + b >>> 0;
      h2 = h2 + c >>> 0;
      h3 = h3 + d >>> 0;
      h4 = h4 + e >>> 0;
    }
    return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
  }

  // src/server/buildInfo.ts
  var BUILD_ID = true ? "ff5399d267f8" : "dev";

  // src/server/serverCache.ts
  var VERSION_PROP = "DATA_VERSION";
  var WIZ_VERSION_PROP = "WIZ_DATA_VERSION";
  var KEY_PREFIX = `wsk.${BUILD_ID}`;
  var CHUNK_CHARS = 9e4;
  var DEFAULT_TTL_SEC = 21600;
  var dataVersionMemo;
  var wizDataVersionMemo;
  var configStampMemo;
  function __resetMemosForTest2() {
    dataVersionMemo = void 0;
    wizDataVersionMemo = void 0;
    configStampMemo = void 0;
  }
  function dataVersion() {
    var _a;
    if (dataVersionMemo === void 0) dataVersionMemo = (_a = getProp(VERSION_PROP)) != null ? _a : "0";
    return dataVersionMemo;
  }
  function nextVersion(prev) {
    const now = String(Date.now());
    const [prevMs, prevN] = String(prev != null ? prev : "").split(".");
    return prevMs === now ? `${now}.${(Number(prevN) || 0) + 1}` : `${now}.0`;
  }
  function bumpDataVersion() {
    setProp(VERSION_PROP, nextVersion(getProp(VERSION_PROP)));
    __resetMemosForTest2();
  }
  function bumpWizDataVersion() {
    setProp(WIZ_VERSION_PROP, nextVersion(getProp(WIZ_VERSION_PROP)));
    __resetMemosForTest2();
  }
  function paramsHash(params) {
    return sha1Hex(JSON.stringify(params != null ? params : null)).slice(0, 12);
  }
  function cacheKey(name, params, version) {
    return `${KEY_PREFIX}:${version}:${name}:${paramsHash(params)}`;
  }
  function configStamp() {
    var _a;
    if (configStampMemo === void 0) {
      configStampMemo = sha1Hex(`${(_a = getProp(PROP_KEYS.wizProjectIdV2)) != null ? _a : ""}`).slice(0, 8);
    }
    return configStampMemo;
  }
  function currentStamp(version) {
    return `${KEY_PREFIX}:${version != null ? version : dataVersion()}.${configStamp()}`;
  }
  function splitChunks(s2, size = CHUNK_CHARS) {
    const out = [];
    for (let i = 0; i < s2.length; i += size) out.push(s2.slice(i, i + size));
    return out.length ? out : [""];
  }
  function cachePutJson(key, value, ttlSec = DEFAULT_TTL_SEC, chunkChars = CHUNK_CHARS) {
    const json = JSON.stringify(value);
    const gz = Utilities.gzip(Utilities.newBlob(json, "application/json"));
    const packed = Utilities.base64Encode(gz.getBytes());
    const chunks = splitChunks(packed, chunkChars);
    const entries = { [`${key}:m`]: String(chunks.length) };
    chunks.forEach((c, i) => {
      entries[`${key}:${i}`] = c;
    });
    CacheService.getScriptCache().putAll(entries, ttlSec);
  }
  function cacheGetJson(key) {
    const cache = CacheService.getScriptCache();
    const meta = cache.get(`${key}:m`);
    if (!meta) return void 0;
    const n2 = Number(meta);
    if (!Number.isInteger(n2) || n2 < 1) return void 0;
    const names = [];
    for (let i = 0; i < n2; i++) names.push(`${key}:${i}`);
    const got = cache.getAll(names);
    let packed = "";
    for (const name of names) {
      const chunk = got[name];
      if (chunk === void 0 || chunk === null) return void 0;
      packed += chunk;
    }
    const bytes = Utilities.base64Decode(packed);
    const json = Utilities.ungzip(
      Utilities.newBlob(bytes, "application/x-gzip")
    ).getDataAsString("UTF-8");
    return JSON.parse(json);
  }
  function cached(name, params, compute, ttlSec = DEFAULT_TTL_SEC, version) {
    let key = null;
    try {
      key = cacheKey(name, params, `${version != null ? version : dataVersion()}.${configStamp()}`);
      const hit = cacheGetJson(key);
      if (hit !== void 0) return hit;
    } catch (e) {
      console.warn(`Cache read failed for ${name}: ${e}`);
      key = null;
    }
    const value = compute();
    if (key) {
      try {
        cachePutJson(key, value, ttlSec);
      } catch (e) {
        console.warn(`Cache write failed for ${name}: ${e}`);
      }
    }
    return value;
  }

  // src/server/welcome.ts
  var ENTRY_TTL_SEC = 21600;
  var ENTER_PARAM = "enter";
  function markerKey(email) {
    return "entered:" + paramsHash(email.trim().toLowerCase());
  }
  function markEntered(email) {
    try {
      CacheService.getScriptCache().put(markerKey(email), "1", ENTRY_TTL_SEC);
    } catch (e) {
      console.warn("entry marker write failed: " + e);
    }
  }
  function hasEntered(email) {
    try {
      return CacheService.getScriptCache().get(markerKey(email)) !== null;
    } catch (e) {
      console.warn("entry marker read failed: " + e);
      return true;
    }
  }
  function welcomeHtml(email, continueUrl, switchUrl) {
    return cardPage({
      title: PRODUCT,
      eyebrow: PRODUCT,
      heading: "You're signed in.",
      paragraphs: [
        "This dashboard will open as <strong>" + escapeHtml(email) + "</strong>.",
        "If that isn't the account you meant to use, switch before you continue \u2014 the register you see depends on which account opens it."
      ],
      actions: primaryAction(continueUrl, "Continue") + (switchUrl ? secondaryAction(switchUrl, "Switch Google account") : "")
    });
  }
  function gate(e) {
    const email = check().email;
    if (!email) return null;
    if (e && e.parameter && e.parameter[ENTER_PARAM]) {
      markEntered(email);
      return null;
    }
    if (hasEntered(email)) {
      markEntered(email);
      return null;
    }
    const url = serviceUrl();
    if (!url) return null;
    const continueUrl = url + (url.indexOf("?") >= 0 ? "&" : "?") + ENTER_PARAM + "=1";
    return HtmlService.createHtmlOutput(welcomeHtml(email, continueUrl, accountChooserUrl())).setTitle(PRODUCT).addMetaTag("viewport", "width=device-width, initial-scale=1");
  }

  // src/domain/config.ts
  var SEVERITY_ORDER = [
    "CRITICAL",
    "HIGH",
    "MEDIUM",
    "LOW",
    "INFO",
    "UNKNOWN"
  ];
  var SELECTABLE_SEVERITIES = SEVERITY_ORDER.filter((s2) => s2 !== "UNKNOWN");
  var SLA_TARGETS = {
    CRITICAL: 7,
    HIGH: 14,
    MEDIUM: 30,
    LOW: 90,
    INFO: 180
  };
  var SCOPES = ["sca", "sast", "secrets"];
  var DEFAULT_FETCH_SEVERITIES = {
    sca: ["CRITICAL", "HIGH"],
    sast: ["CRITICAL", "HIGH"],
    secrets: []
  };
  var RESOLVED_STATUSES = /* @__PURE__ */ new Set(["RESOLVED", "REMEDIATED", "FIXED", "CLOSED"]);
  var STATUS_OPEN = "OPEN";
  var STATUS_RESOLVED = "RESOLVED";
  var RESOLUTION_API = "api";
  var RESOLUTION_DISAPPEARED = "disappeared";
  var EPSS_PRIORITY_THRESHOLD = 0.1;
  var DEFAULT_RISK_RULE = {
    kev: true,
    exploit: true,
    epss: true,
    epssThreshold: EPSS_PRIORITY_THRESHOLD
  };
  var DEFAULT_SAST_RISK_RULE = {
    cwe: true,
    aiVerdict: true,
    critical: true
  };
  var CWE_TOP_25_2024 = [
    "CWE-79",
    "CWE-787",
    "CWE-89",
    "CWE-352",
    "CWE-22",
    "CWE-125",
    "CWE-78",
    "CWE-416",
    "CWE-862",
    "CWE-434",
    "CWE-94",
    "CWE-20",
    "CWE-77",
    "CWE-287",
    "CWE-269",
    "CWE-502",
    "CWE-200",
    "CWE-863",
    "CWE-918",
    "CWE-119",
    "CWE-476",
    "CWE-798",
    "CWE-190",
    "CWE-400",
    "CWE-306"
  ];
  var CWE_ANCESTORS = {
    "CWE-23": "CWE-22",
    "CWE-36": "CWE-22",
    "CWE-80": "CWE-79",
    "CWE-83": "CWE-79",
    "CWE-91": "CWE-94",
    "CWE-95": "CWE-94",
    "CWE-470": "CWE-94",
    "CWE-1321": "CWE-94",
    "CWE-88": "CWE-77",
    "CWE-611": "CWE-20",
    "CWE-547": "CWE-798",
    "CWE-259": "CWE-798",
    "CWE-321": "CWE-798",
    "CWE-1333": "CWE-400",
    "CWE-732": "CWE-863",
    "CWE-284": "CWE-862"
  };
  var AI_VERDICTS_HIGH = /* @__PURE__ */ new Set([
    "EXPLOITABLE",
    "TRUE_POSITIVE",
    "CONFIRMED",
    "VULNERABLE"
  ]);
  function ruleForScope(scope) {
    if (scope === "sca") return DEFAULT_RISK_RULE;
    if (scope === "sast") return DEFAULT_SAST_RISK_RULE;
    return null;
  }
  var NET_CAPACITY_BAND_PCT = 2;
  var OVERALL = "OVERALL";
  var POPULATION_ALL = "all";
  var POPULATION_HIGH_RISK = "high_risk";
  var ASSET_GROUP_UNKNOWN = "UNKNOWN";
  var DISAPPEARANCE_RESOLUTION = "scan_ts";
  var MIN_UNSEALED_FLAT_SCANS = 2;
  var DEFAULT_RETENTION_DAYS = 180;

  // src/domain/severity.ts
  function normalizeSeverity(sev2) {
    if (typeof sev2 !== "string") return "UNKNOWN";
    const s2 = sev2.toUpperCase().trim();
    if (s2 === "INFORMATIONAL" || s2 === "INFO") return "INFO";
    return SEVERITY_ORDER.includes(s2) ? s2 : "UNKNOWN";
  }

  // src/domain/util.ts
  function clampInt(v, fallback, min, max) {
    const n2 = Math.round(Number(v));
    if (!Number.isFinite(n2)) return fallback;
    return Math.min(max, Math.max(min, n2));
  }
  function cmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function present(v) {
    if (v === null || v === void 0) return false;
    if (typeof v === "number" && Number.isNaN(v)) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  }
  function clean(v) {
    return present(v) ? v : null;
  }
  function pyStr(v) {
    if (v === true) return "True";
    if (v === false) return "False";
    return String(v);
  }
  function parseTs(v) {
    const c = clean(v);
    if (c === null) return null;
    if (c instanceof Date) return isNaN(c.getTime()) ? null : c.getTime();
    if (typeof c === "number" && Number.isFinite(c)) return c;
    let s2 = String(c).trim();
    if (!s2) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s2)) s2 = s2.replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s2)) s2 += "Z";
    const t = Date.parse(s2);
    return Number.isNaN(t) ? null : t;
  }
  function toIso(ms) {
    if (ms === null || !Number.isFinite(ms)) return null;
    return new Date(Math.floor(ms / 1e3) * 1e3).toISOString().replace(".000Z", "Z");
  }
  function minIso(...values) {
    let min = null;
    for (const v of values) {
      const t = parseTs(v);
      if (t !== null && (min === null || t < min)) min = t;
    }
    return min === null ? null : toIso(min);
  }
  function midpointIso(a, b) {
    var _a;
    const da = parseTs(a);
    const db = parseTs(b);
    if (da === null || db === null) return (_a = toIso(db)) != null ? _a : toIso(da);
    return toIso(da + (db - da) / 2);
  }
  function nowIso(now) {
    return toIso(now != null ? now : Date.now());
  }
  function mean(values) {
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  function quantile(values, q) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = q * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function median(values) {
    return quantile(values, 0.5);
  }
  function maxNum(values) {
    return values.reduce((m, v) => Math.max(m, v), -Infinity);
  }
  function minNum(values) {
    return values.reduce((m, v) => Math.min(m, v), Infinity);
  }
  function pushAll(target, items) {
    for (const item of items) target.push(item);
  }

  // src/domain/compaction.ts
  function serializeSeverities(sevs) {
    if (sevs === null || sevs === void 0) return null;
    const vals = /* @__PURE__ */ new Set();
    for (const s2 of sevs) {
      if (typeof s2 === "string") {
        const n2 = normalizeSeverity(s2);
        if (SELECTABLE_SEVERITIES.includes(n2)) vals.add(n2);
      }
    }
    if (!vals.size || vals.size === SELECTABLE_SEVERITIES.length) return null;
    const ordered = SEVERITY_ORDER.filter((s2) => vals.has(s2));
    return `[${ordered.map((s2) => JSON.stringify(s2)).join(", ")}]`;
  }
  function parseSeverities(text) {
    if (typeof text !== "string" || !text) return null;
    let vals;
    try {
      vals = JSON.parse(text);
    } catch {
      return null;
    }
    if (!Array.isArray(vals)) return null;
    const chosen = new Set(
      vals.filter((v) => typeof v === "string").map(normalizeSeverity)
    );
    const out = SEVERITY_ORDER.filter((s2) => chosen.has(s2));
    return out.length ? out : null;
  }
  function selectSealCandidates(rows, cutoffMs) {
    const protectedIds = new Set(rows.map((r) => r.scan_id).slice(-MIN_UNSEALED_FLAT_SCANS));
    const candidates = [];
    for (const r of rows) {
      if (protectedIds.has(r.scan_id)) break;
      const ts = parseTs(r.ts);
      if (ts === null || ts > cutoffMs) break;
      candidates.push(r);
    }
    return candidates;
  }
  function statsEqual(a, b) {
    if (isMissing(a) && isMissing(b)) return true;
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length || !ka.every((k) => kb.includes(k))) return false;
      return ka.every((k) => statsEqual(a[k], b[k]));
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((x, i) => statsEqual(x, b[i]));
    }
    return a === b;
  }
  function isMissing(v) {
    return v === null || v === void 0 || typeof v === "number" && Number.isNaN(v);
  }

  // src/domain/metrics.ts
  var DAY_MS = 864e5;
  function summarize(workIn, now, scope) {
    var _a;
    const work = scope ? workIn.filter((r) => r.scope === void 0 || r.scope === scope) : workIn;
    if (!work.length) return { perSev: {}, overall: {} };
    const nowMs = now != null ? now : Date.now();
    const mttrDays = (r) => r.resolved !== null && r.firstSeen !== null ? (r.resolved - r.firstSeen) / DAY_MS : null;
    const ageDays = (r) => r.firstSeen !== null ? (nowMs - r.firstSeen) / DAY_MS : null;
    const perSev = {};
    for (const sev2 of SEVERITY_ORDER) {
      const sub = work.filter((r) => r.sev === sev2);
      if (!sub.length) continue;
      const resolvedDays = sub.map(mttrDays).filter((d) => d !== null);
      const openAges = sub.filter((r) => r.resolved === null && r.firstSeen !== null).map(ageDays).filter((d) => d !== null);
      const target = (_a = SLA_TARGETS[sev2]) != null ? _a : null;
      const withinSla = target !== null && resolvedDays.length ? resolvedDays.filter((d) => d <= target).length : 0;
      perSev[sev2] = {
        mttr_mean: resolvedDays.length ? mean(resolvedDays) : null,
        mttr_median: resolvedDays.length ? median(resolvedDays) : null,
        resolved: resolvedDays.length,
        open: openAges.length,
        open_age_p50: openAges.length ? median(openAges) : null,
        open_age_p90: openAges.length ? quantile(openAges, 0.9) : null,
        sla_target: target,
        sla_compliant: withinSla,
        sla_pct: resolvedDays.length && target !== null ? withinSla / resolvedDays.length * 100 : null
      };
    }
    const allMttr = work.map(mttrDays).filter((d) => d !== null);
    const overall = {
      mttr_mean: allMttr.length ? mean(allMttr) : null,
      mttr_median: allMttr.length ? median(allMttr) : null,
      resolved: work.filter((r) => r.resolved !== null).length,
      open: work.filter((r) => r.resolved === null).length
    };
    return { perSev, overall };
  }
  function overallSlaOldest(perSev) {
    const stats = Object.values(perSev);
    const compliant = stats.reduce((a, d) => {
      var _a;
      return a + ((_a = d.sla_compliant) != null ? _a : 0);
    }, 0);
    const resolved = stats.reduce((a, d) => {
      var _a;
      return a + ((_a = d.resolved) != null ? _a : 0);
    }, 0);
    const slaPct = resolved ? compliant / resolved * 100 : null;
    const p90s = stats.map((d) => d.open_age_p90).filter((v) => v !== null && v !== void 0);
    const oldestDays = p90s.length ? maxNum(p90s) : null;
    return { slaPct, oldestDays };
  }

  // src/domain/lifecycle.ts
  function findingKey(scope, node) {
    var _a, _b, _c, _d;
    if (scope === "secrets") {
      const secretDataId = pyStr((_a = clean(node["secretDataId"])) != null ? _a : "").trim();
      if (!secretDataId) {
        throw new Error(`findingKey: scope "secrets" node has no secretDataId`);
      }
      const path = pyStr((_b = clean(node["path"])) != null ? _b : "");
      const lineNumber = pyStr((_c = clean(node["lineNumber"])) != null ? _c : "");
      const basis = `${secretDataId}|${path}|${lineNumber}`;
      return `${scope}:h:${sha1Hex(basis).slice(0, 16)}`;
    }
    const rawId = node["id"];
    const id = typeof rawId === "string" ? rawId.trim() : pyStr((_d = clean(rawId)) != null ? _d : "");
    if (!id) {
      throw new Error(`findingKey: scope "${scope}" node has no id`);
    }
    return `${scope}:id:${id}`;
  }
  function mttrFromLedger(ledgerRows, opts = {}) {
    const rows = [...ledgerRows];
    if (!rows.length) return { perSev: {}, overall: {} };
    const work = rows.map((r) => ({
      sev: "severity" in r ? normalizeSeverity(r["severity"]) : "UNKNOWN",
      firstSeen: parseTs(r["first_seen"]),
      resolved: parseTs(r["resolved_at"]),
      scope: "scope" in r ? r["scope"] : void 0
    }));
    return summarize(work, opts.now, opts.scope);
  }

  // src/domain/reconcile.ts
  var DAY_MS2 = 864e5;
  var MEASURED_VALIDATION = /* @__PURE__ */ new Set(["VALID", "INVALID"]);
  var RESOURCE_BRANCH = "REPOSITORY_BRANCH";
  function dottedRaw(record, path) {
    const flat = record[path];
    if (present(flat)) return flat;
    let cur = record;
    for (const seg of path.split(".")) {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return null;
      cur = cur[seg];
    }
    return present(cur) ? cur : null;
  }
  function dotted(record, path) {
    const v = dottedRaw(record, path);
    return v === null ? "" : pyStr(v);
  }
  function str(record, ...paths) {
    for (const p of paths) {
      const v = dotted(record, p);
      if (v !== "") return v;
    }
    return null;
  }
  function num(record, path) {
    const v = dottedRaw(record, path);
    if (v === null) return null;
    const n2 = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n2) ? n2 : null;
  }
  function canonicalJson(entries) {
    const keys = Object.keys(entries).sort();
    if (!keys.length) return null;
    const parts = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(entries[k])}`);
    return `{${parts.join(", ")}}`;
  }
  var TAGS_PREFIX = "vulnerableAsset.tags.";
  function tagsJson(record) {
    const va = record["vulnerableAsset"];
    let tags = null;
    if (va && typeof va === "object" && !Array.isArray(va)) {
      const t = va["tags"];
      if (t && typeof t === "object" && !Array.isArray(t)) tags = t;
    }
    if (tags === null) {
      const flat = record["vulnerableAsset.tags"];
      if (flat && typeof flat === "object" && !Array.isArray(flat)) tags = flat;
    }
    if (tags === null) {
      const collected = {};
      for (const [k, v] of Object.entries(record)) {
        if (k.startsWith(TAGS_PREFIX) && clean(v) !== null) {
          collected[k.slice(TAGS_PREFIX.length)] = v;
        }
      }
      tags = collected;
    }
    const kept = {};
    for (const [k, v] of Object.entries(tags)) {
      if (clean(v) !== null || v === "") kept[String(k)] = v;
    }
    return canonicalJson(kept);
  }
  function projectList(record) {
    const raw = record["projects"];
    if (!Array.isArray(raw)) return [];
    return raw.filter((p) => p !== null && typeof p === "object" && !Array.isArray(p));
  }
  function projectsJson(record) {
    const entries = {};
    for (const p of projectList(record)) {
      const key = str(p, "slug", "id");
      const name = str(p, "name");
      if (key !== null) entries[key] = name != null ? name : key;
    }
    return canonicalJson(entries);
  }
  function ownerProject(record) {
    var _a;
    const projects = projectList(record);
    const leaf = projects.find((p) => p["isFolder"] !== true);
    return str((_a = leaf != null ? leaf : projects[0]) != null ? _a : {}, "name");
  }
  function ownerPath(record) {
    const names = [];
    for (const p of projectList(record)) {
      if (p["isFolder"] !== true) continue;
      const n2 = str(p, "name");
      if (n2 !== null) names.push(n2);
    }
    if (!names.length) return null;
    return names.sort().join(" / ");
  }
  function splitRepoBranch(name, type) {
    if (name === null) return { repo: null, branch: null };
    if ((type != null ? type : "").toUpperCase() !== RESOURCE_BRANCH) return { repo: name, branch: null };
    const i = name.lastIndexOf("/");
    if (i <= 0 || i === name.length - 1) return { repo: name, branch: null };
    return { repo: name.slice(0, i), branch: name.slice(i + 1) };
  }
  function firstLanguage(v) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (present(item)) return pyStr(item);
      }
      return null;
    }
    return present(v) ? pyStr(v) : null;
  }
  function joinedCwes(record) {
    const raw = record["weaknesses"];
    if (!Array.isArray(raw)) return null;
    const ids = [];
    for (const w of raw) {
      if (w === null || typeof w !== "object" || Array.isArray(w)) continue;
      const id = str(w, "id");
      if (id !== null) ids.push(id);
    }
    if (!ids.length) return null;
    return ids.sort().join(",");
  }
  function attributes(rec, scope) {
    var _a, _b, _c, _d, _e, _f;
    const empty = {
      identifier: null,
      component: null,
      repo_id: null,
      repo_name: null,
      branch: null,
      platform: null,
      fixed_version: null,
      cwe: null,
      ai_verdict: null,
      language: null,
      file_path: null,
      start_line: null,
      origin: null,
      secret_kind: null,
      confidence: null,
      owner_project: ownerProject(rec),
      owner_path: ownerPath(rec),
      // projects[] is this register's ownership dimension on all three scopes; the
      // vulnerableAsset.tags fallback is what keeps gas/'s tags_json fixture live for SCA,
      // whose nodes come off the same connection the OS register reads.
      tags_json: (_a = projectsJson(rec)) != null ? _a : tagsJson(rec)
    };
    if (scope === "sast") {
      const parts2 = splitRepoBranch(str(rec, "resource.name"), str(rec, "resource.type"));
      return {
        ...empty,
        // brick/devsecops/metrics.py:365 puts the weakness TITLE here ("SQL Injection"), not
        // an identifier — it is what every panel groups on to answer "what kind of thing is
        // this". The identifier-shaped value lives in `cwe`.
        identifier: (_b = clean(rec["name"])) != null ? _b : null,
        // DIVERGENCE (brick): brick/devsecops/metrics.py:362 aliases `filePath` as `component`
        // for SAST. This register has a dedicated `file_path` column, so writing the path into
        // both would store the same string twice under two names; `component` stays null for
        // sast and secrets per the D2 brief. Reported, not papered over.
        component: null,
        repo_id: str(rec, "resource.id"),
        repo_name: parts2.repo,
        branch: parts2.branch,
        // Q_SAST's `resource { id name type }` selects no cloudPlatform — an honest gap, not a
        // dropped mapping. There is nothing on the SAST node to fill `platform` from.
        platform: null,
        cwe: joinedCwes(rec),
        ai_verdict: (_d = (_c = str(rec, "aiAnalysis.verdict")) == null ? void 0 : _c.trim().toUpperCase()) != null ? _d : null,
        language: firstLanguage(dottedRaw(rec, "codeLibraryLanguage")),
        file_path: str(rec, "filePath"),
        start_line: num(rec, "startLine"),
        origin: str(rec, "origin")
      };
    }
    if (scope === "secrets") {
      const parts2 = splitRepoBranch(str(rec, "resource.name"), str(rec, "resource.type"));
      return {
        ...empty,
        // identifier <- secretDataId: it names the CREDENTIAL, and is what a rotation decision
        // groups by. It is deliberately NOT the row key (that is the (secretDataId, path,
        // lineNumber) hash in lifecycle.findingKey) — the same credential in five files is
        // five findings and one rotation.
        identifier: (_e = clean(rec["secretDataId"])) != null ? _e : null,
        component: null,
        repo_id: str(rec, "resource.id"),
        repo_name: parts2.repo,
        branch: parts2.branch,
        platform: str(rec, "resource.cloudPlatform"),
        secret_kind: str(rec, "type"),
        confidence: str(rec, "confidence"),
        file_path: str(rec, "path"),
        start_line: num(rec, "lineNumber")
      };
    }
    const parts = splitRepoBranch(
      str(rec, "vulnerableAsset.name"),
      str(rec, "vulnerableAsset.type")
    );
    return {
      ...empty,
      identifier: (_f = clean(rec["name"])) != null ? _f : null,
      // The package, per brick/devsecops/metrics.py:269 — `detailedName` is "braces" on the
      // live probe sample where `name` is "CVE-2024-4068".
      component: str(rec, "detailedName"),
      repo_id: str(rec, "vulnerableAsset.id"),
      repo_name: parts.repo,
      branch: parts.branch,
      platform: str(rec, "vulnerableAsset.cloudPlatform"),
      fixed_version: str(rec, "fixedVersion"),
      // Filled for sca as well as sast, following brick's `_first_language`: Q_SCA selects
      // `artifactType { codeLibraryLanguage }` and brick's asset_profile groups the SCA
      // register by exactly this value. Leaving it null here would make every SCA asset group
      // read UNKNOWN downstream.
      language: firstLanguage(dottedRaw(rec, "artifactType.codeLibraryLanguage"))
    };
  }
  function emptyRiskSignals() {
    return { has_kev: null, has_exploit: null, epss: null, risk_observed_at: null };
  }
  function coerceRiskSignals(r) {
    var _a;
    const obs = observeRiskSignals({
      hasCisaKevExploit: r["has_kev"],
      hasExploit: r["has_exploit"],
      epssProbability: r["epss"]
    });
    return {
      has_kev: obs.kev,
      has_exploit: obs.exploit,
      epss: obs.epss,
      risk_observed_at: (_a = clean(r["risk_observed_at"])) != null ? _a : null
    };
  }
  function observeRiskSignals(rec) {
    const bool = (v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") {
        const s2 = v.trim().toUpperCase();
        if (s2 === "TRUE") return true;
        if (s2 === "FALSE") return false;
      }
      return null;
    };
    const rawEpss = clean(rec["epssProbability"]);
    const n2 = typeof rawEpss === "number" ? rawEpss : rawEpss === null ? NaN : Number(rawEpss);
    return {
      kev: bool(rec["hasCisaKevExploit"]),
      exploit: bool(rec["hasExploit"]),
      epss: Number.isFinite(n2) ? n2 : null
    };
  }
  function mergeRiskSignals(row, rec, scanTsIso) {
    const obs = observeRiskSignals(rec);
    if (obs.kev !== null && (row.has_kev == null || obs.kev)) row.has_kev = obs.kev;
    if (obs.exploit !== null && (row.has_exploit == null || obs.exploit)) {
      row.has_exploit = obs.exploit;
    }
    if (obs.epss !== null && (row.epss == null || obs.epss > row.epss)) row.epss = obs.epss;
    const witnessed = obs.kev !== null || obs.exploit !== null || obs.epss !== null;
    if (!witnessed) return;
    if (row.risk_observed_at == null || scanTsIso < row.risk_observed_at) {
      row.risk_observed_at = scanTsIso;
    }
  }
  function emptyTwinStats() {
    return { keys: 0, folded: 0, medianGapDays: null };
  }
  function foldSecretTwins(nodes) {
    const groups = /* @__PURE__ */ new Map();
    const order = [];
    for (const n2 of nodes) {
      const key = findingKey("secrets", n2);
      const bucket = groups.get(key);
      if (bucket) bucket.push(n2);
      else {
        groups.set(key, [n2]);
        order.push(key);
      }
    }
    const out = [];
    const gaps = [];
    let keys = 0;
    let folded = 0;
    for (const key of order) {
      const bucket = groups.get(key);
      if (bucket.length === 1) {
        out.push(bucket[0]);
        continue;
      }
      keys += 1;
      folded += bucket.length - 1;
      const births = [];
      for (const n2 of bucket) {
        const t = parseTs(n2["firstSeenAt"]);
        if (t !== null) births.push(t);
      }
      if (births.length > 1) gaps.push((maxNum(births) - minNum(births)) / DAY_MS2);
      let base = bucket[0];
      let baseSeen = parseTs(base["lastSeenAt"]);
      for (let i = 1; i < bucket.length; i += 1) {
        const cand = bucket[i];
        const t = parseTs(cand["lastSeenAt"]);
        if (t !== null && (baseSeen === null || t > baseSeen)) {
          base = cand;
          baseSeen = t;
        }
      }
      const merged = { ...base };
      if (births.length) merged["firstSeenAt"] = toIso(minNum(births));
      const branchTwin = bucket.find(
        (n2) => {
          var _a;
          return ((_a = str(n2, "resource.type")) != null ? _a : "").toUpperCase() === RESOURCE_BRANCH;
        }
      );
      if (branchTwin !== void 0 && branchTwin !== base) {
        for (const k of Object.keys(merged)) {
          if (k === "resource" || k.startsWith("resource.")) delete merged[k];
        }
        for (const [k, v] of Object.entries(branchTwin)) {
          if (k === "resource" || k.startsWith("resource.")) merged[k] = v;
        }
      }
      out.push(merged);
    }
    return {
      nodes: out,
      stats: { keys, folded, medianGapDays: gaps.length ? median(gaps) : null }
    };
  }
  function makeRow(key, scope, attrs, sev2, firstSeen, scanId, scanTs, fixDate, fixObservedAt) {
    return {
      finding_key: key,
      scope,
      identifier: attrs.identifier,
      component: attrs.component,
      severity: sev2,
      repo_id: attrs.repo_id,
      repo_name: attrs.repo_name,
      branch: attrs.branch,
      platform: attrs.platform,
      first_seen: firstSeen,
      last_seen: scanTs,
      status: STATUS_OPEN,
      resolved_at: null,
      resolution_src: null,
      reopened_count: 0,
      first_scan_id: scanId,
      last_scan_id: scanId,
      fix_date: fixDate,
      fix_observed_at: fixObservedAt,
      fixed_version: attrs.fixed_version,
      // Left null here and filled by mergeRiskSignals() after the branch, which runs identically
      // for new, reopened and persisting rows.
      ...emptyRiskSignals(),
      cwe: attrs.cwe,
      ai_verdict: attrs.ai_verdict,
      language: attrs.language,
      file_path: attrs.file_path,
      start_line: attrs.start_line,
      origin: attrs.origin,
      secret_kind: attrs.secret_kind,
      rotated_at: null,
      removed_at: null,
      // Left null here and filled by applyValidation() after the branch, for the same reason
      // the risk merge is: the rule is identical in all three branches.
      validation_state: null,
      validated_at: null,
      confidence: attrs.confidence,
      owner_project: attrs.owner_project,
      owner_path: attrs.owner_path,
      tags_json: attrs.tags_json
    };
  }
  function applyValidation(row, rec, scanTsIso) {
    var _a, _b;
    const observedState = ((_a = str(rec, "validationStatus")) != null ? _a : "").trim().toUpperCase();
    if (observedState === "") return;
    const observedAt = present(rec["lastValidatedAt"]) ? toIso(parseTs(rec["lastValidatedAt"])) : null;
    const observedMeasured = MEASURED_VALIDATION.has(observedState);
    const currentMeasured = MEASURED_VALIDATION.has(((_b = row.validation_state) != null ? _b : "").toUpperCase());
    if (observedMeasured || !currentMeasured) {
      row.validation_state = observedState;
      row.validated_at = observedAt;
    }
    if (observedState === "INVALID" && row.rotated_at == null) {
      row.rotated_at = observedAt != null ? observedAt : scanTsIso;
    }
  }
  function reconcile(currentRecords, existingLedger, scanId, scanTs, prevScanId, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B;
    const {
      scope,
      disappearanceMode = "scan_ts",
      prevScanTs = null,
      scannedSeverities = null,
      prevScanIdBySeverity: prevScanIdBySeverity2 = null
    } = options;
    const updated = {};
    for (const [key, row] of Object.entries(existingLedger)) updated[key] = { ...row };
    const seen = /* @__PURE__ */ new Set();
    const observations = [];
    let newCount = 0;
    let resolvedCount = 0;
    let reopenedCount = 0;
    const scanTsIso = (_a = toIso(parseTs(scanTs))) != null ? _a : String(scanTs);
    const folded = scope === "secrets" ? foldSecretTwins(currentRecords) : { nodes: currentRecords, stats: emptyTwinStats() };
    for (const rec of folded.nodes) {
      const key = findingKey(scope, rec);
      if (seen.has(key)) continue;
      seen.add(key);
      const sev2 = normalizeSeverity(
        scope === "sast" ? (_b = clean(rec["severity"])) != null ? _b : clean(rec["originalSeverity"]) : clean(rec["severity"])
      );
      const apiFirst = (_d = (_c = clean(rec["firstDetectedAt"])) != null ? _c : clean(rec["firstSeenAt"])) != null ? _d : clean(rec["createdAt"]);
      const apiStatus = String((_e = clean(rec["status"])) != null ? _e : "").toUpperCase();
      const apiResolved = (_g = (_f = clean(rec["resolvedAt"])) != null ? _f : clean(rec["remediatedAt"])) != null ? _g : clean(rec["fixedAt"]);
      const apiSaysResolved = present(apiResolved) || RESOLVED_STATUSES.has(apiStatus);
      const attrs = attributes(rec, scope);
      const fixSignal = present(rec["fixedVersion"]) || present(rec["fixDate"]);
      const recFixDate = present(rec["fixDate"]) ? toIso(parseTs(rec["fixDate"])) : null;
      const seedFix = (r) => {
        if (r.fix_date == null && recFixDate !== null) r.fix_date = recFixDate;
        if (r.fix_observed_at == null && fixSignal) r.fix_observed_at = scanTsIso;
      };
      let row = updated[key];
      if (row === void 0) {
        const firstSeen = (_h = minIso(apiFirst, scanTsIso)) != null ? _h : scanTsIso;
        row = makeRow(
          key,
          scope,
          attrs,
          sev2,
          firstSeen,
          scanId,
          scanTsIso,
          recFixDate,
          fixSignal ? scanTsIso : null
        );
        updated[key] = row;
        newCount += 1;
      } else if (row.status === STATUS_RESOLVED && !apiSaysResolved) {
        row.status = STATUS_OPEN;
        row.resolved_at = null;
        row.resolution_src = null;
        row.reopened_count = Number((_i = row.reopened_count) != null ? _i : 0) + 1;
        row.first_seen = (_j = minIso(apiFirst, scanTsIso)) != null ? _j : scanTsIso;
        row.last_seen = scanTsIso;
        row.last_scan_id = scanId;
        row.fix_date = null;
        row.fix_observed_at = null;
        row.removed_at = null;
        row.rotated_at = null;
        seedFix(row);
        reopenedCount += 1;
      } else {
        if (row.status === STATUS_OPEN) {
          row.first_seen = (_k = minIso(row.first_seen, apiFirst)) != null ? _k : row.first_seen;
        }
        row.last_seen = scanTsIso;
        row.last_scan_id = scanId;
        seedFix(row);
      }
      mergeRiskSignals(row, rec, scanTsIso);
      if (scope === "secrets") applyValidation(row, rec, scanTsIso);
      row.scope = scope;
      row.severity = sev2;
      row.identifier = attrs.identifier;
      row.component = attrs.component;
      row.repo_id = (_l = attrs.repo_id) != null ? _l : row.repo_id;
      row.repo_name = (_m = attrs.repo_name) != null ? _m : row.repo_name;
      row.branch = (_n = attrs.branch) != null ? _n : row.branch;
      row.platform = (_o = attrs.platform) != null ? _o : row.platform;
      row.fixed_version = (_p = attrs.fixed_version) != null ? _p : row.fixed_version;
      row.cwe = (_q = attrs.cwe) != null ? _q : row.cwe;
      row.ai_verdict = (_r = attrs.ai_verdict) != null ? _r : row.ai_verdict;
      row.language = (_s = attrs.language) != null ? _s : row.language;
      row.file_path = (_t = attrs.file_path) != null ? _t : row.file_path;
      row.start_line = (_u = attrs.start_line) != null ? _u : row.start_line;
      row.origin = (_v = attrs.origin) != null ? _v : row.origin;
      row.secret_kind = (_w = attrs.secret_kind) != null ? _w : row.secret_kind;
      row.confidence = (_x = attrs.confidence) != null ? _x : row.confidence;
      row.owner_project = (_y = attrs.owner_project) != null ? _y : row.owner_project;
      row.owner_path = (_z = attrs.owner_path) != null ? _z : row.owner_path;
      row.tags_json = (_A = attrs.tags_json) != null ? _A : row.tags_json;
      if (apiSaysResolved && row.status === STATUS_OPEN) {
        row.status = STATUS_RESOLVED;
        row.resolved_at = present(apiResolved) ? toIso(parseTs(apiResolved)) : scanTsIso;
        row.resolution_src = RESOLUTION_API;
        if (scope === "secrets" && row.removed_at == null) row.removed_at = row.resolved_at;
        resolvedCount += 1;
      }
      observations.push({
        scan_id: scanId,
        finding_key: key,
        present: 1,
        severity: sev2,
        status: row.status
      });
    }
    if (prevScanId !== null) {
      const inScope = scannedSeverities !== null ? new Set(scannedSeverities) : null;
      for (const [key, row] of Object.entries(updated)) {
        if (seen.has(key) || row.status === STATUS_RESOLVED) continue;
        const sevRow = row.severity;
        if (inScope !== null && (sevRow === null || !inScope.has(sevRow))) {
          continue;
        }
        const expectedPrev = (_B = (prevScanIdBySeverity2 != null ? prevScanIdBySeverity2 : {})[sevRow != null ? sevRow : ""]) != null ? _B : prevScanId;
        if (row.last_scan_id !== expectedPrev) continue;
        if (disappearanceMode === "midpoint" && prevScanTs) {
          row.resolved_at = midpointIso(prevScanTs, scanTsIso);
        } else {
          row.resolved_at = scanTsIso;
        }
        row.status = STATUS_RESOLVED;
        row.resolution_src = RESOLUTION_DISAPPEARED;
        if (scope === "secrets" && row.removed_at == null) row.removed_at = row.resolved_at;
        resolvedCount += 1;
        observations.push({
          scan_id: scanId,
          finding_key: key,
          present: 0,
          severity: row.severity,
          status: STATUS_RESOLVED
        });
      }
    }
    return {
      ledger: updated,
      observations,
      deltas: {
        new_count: newCount,
        resolved_count: resolvedCount,
        reopened_count: reopenedCount
      },
      twinStats: folded.stats
    };
  }

  // src/domain/ledgerCore.ts
  var DAY_MS3 = 864e5;
  var COMPACTED_ASSET = "(compacted)";
  function emptyState() {
    return { scans: [], ledger: {}, episodes: [] };
  }
  function scansAsc(scans, scope) {
    const rows = scope === void 0 ? [...scans] : scans.filter((r) => r.scope === scope);
    return rows.sort((a, b) => {
      var _a, _b;
      const ta = (_a = parseTs(a.ts)) != null ? _a : 0;
      const tb = (_b = parseTs(b.ts)) != null ? _b : 0;
      if (ta !== tb) return ta - tb;
      return cmp(a.scan_id, b.scan_id);
    });
  }
  function latestScan(scans, scope) {
    const asc = scansAsc(scans, scope);
    return asc.length ? asc[asc.length - 1] : null;
  }
  function prevScanIdBySeverity(scans, scope) {
    const remaining = new Set(SEVERITY_ORDER);
    const mapping = {};
    const desc = scansAsc(scans, scope).reverse();
    for (const r of desc) {
      const sevScope = parseSeverities(r.severities);
      const covered = sevScope === null ? [...remaining] : [...remaining].filter((s2) => sevScope.includes(s2));
      for (const sev2 of covered) mapping[sev2] = r.scan_id;
      covered.forEach((s2) => remaining.delete(s2));
      if (!remaining.size) break;
    }
    return Object.keys(mapping).length ? mapping : null;
  }
  function existingScanDeltas(scans, scanId, scope) {
    const row = scans.find(
      (r) => r.scan_id === scanId && (scope === void 0 || r.scope === scope)
    );
    if (!row) return null;
    return {
      new_count: row.new_count,
      resolved_count: row.resolved_count,
      reopened_count: row.reopened_count
    };
  }
  function reconcileEpisodeCollisions(state, updated, existingLedger, deltas, scanId) {
    var _a;
    const newKeys = Object.keys(updated).filter((k) => !(k in existingLedger));
    if (!newKeys.length) return;
    const newKeySet = new Set(newKeys);
    const episodeReopens = /* @__PURE__ */ new Map();
    for (const e of state.episodes) {
      if (e.superseded_by_scan === null && newKeySet.has(e.finding_key)) {
        episodeReopens.set(e.finding_key, e);
      }
    }
    for (const [key, episode] of episodeReopens) {
      const row = updated[key];
      if (row.status === "OPEN") {
        row.reopened_count = Number((_a = episode.reopened_count) != null ? _a : 0) + 1;
        deltas.new_count -= 1;
        deltas.reopened_count += 1;
        episode.superseded_by_scan = scanId;
      } else {
        if (!episode.owner_project && row.owner_project) episode.owner_project = row.owner_project;
        delete updated[key];
        deltas.new_count -= 1;
        deltas.resolved_count -= 1;
      }
    }
  }
  function persistFlatScan(state, records, options) {
    var _a, _b, _c, _d;
    const scope = options.scope;
    const scanId = options.scanId || nowIso(options.now);
    const scanTs = scanId;
    const disappearanceMode = (_a = options.disappearanceMode) != null ? _a : DISAPPEARANCE_RESOLUTION;
    const severitiesText = serializeSeverities((_b = options.scannedSeverities) != null ? _b : null);
    const sevScope = parseSeverities(severitiesText);
    const existing = existingScanDeltas(state.scans, scanId, scope);
    if (existing !== null) {
      return { deltas: existing, observations: [], scanRow: null, twinStats: emptyTwinStats() };
    }
    const prev = latestScan(state.scans, scope);
    const prevScanId = prev ? prev.scan_id : null;
    const prevScanTs = prev ? prev.ts : null;
    const prevBySev = prevScanId !== null ? prevScanIdBySeverity(state.scans, scope) : null;
    const prefix = `${scope}:`;
    const existingLedger = {};
    const otherScopes = {};
    for (const [key, row] of Object.entries(state.ledger)) {
      if (key.startsWith(prefix)) existingLedger[key] = row;
      else otherScopes[key] = row;
    }
    const { ledger: updated, observations, deltas, twinStats } = reconcile(
      records,
      existingLedger,
      scanId,
      scanTs,
      prevScanId,
      {
        scope,
        disappearanceMode,
        prevScanTs,
        scannedSeverities: sevScope,
        prevScanIdBySeverity: prevBySev
      }
    );
    reconcileEpisodeCollisions(state, updated, existingLedger, deltas, scanId);
    const scanRow = {
      scan_id: scanId,
      ts: scanTs,
      scope,
      mode: options.mode,
      severities: severitiesText,
      total: records.length,
      new_count: deltas.new_count,
      resolved_count: deltas.resolved_count,
      reopened_count: deltas.reopened_count,
      raw_ref: (_c = options.rawRef) != null ? _c : null,
      obs_ref: (_d = options.obsRef) != null ? _d : null,
      sealed: 0
    };
    state.scans.push(scanRow);
    state.ledger = { ...otherScopes, ...updated };
    return { deltas, observations, scanRow, twinStats };
  }
  function withDerived(row, nowMs) {
    var _a, _b;
    const first = parseTs(row.first_seen);
    const resolved = parseTs(row.resolved_at);
    const open = row.status === "OPEN";
    const isSca = row.scope === "sca";
    const fixAvailableAt = isSca ? (_b = (_a = row.fix_date) != null ? _a : row.fix_observed_at) != null ? _b : null : row.first_seen;
    const fixAvailMs = parseTs(fixAvailableAt);
    const actionableMs = fixAvailMs === null ? null : first === null ? fixAvailMs : Math.max(first, fixAvailMs);
    const actionableFrom = actionableMs === null ? null : toIso(actionableMs);
    return {
      ...row,
      mttr_days: first !== null && resolved !== null ? (resolved - first) / DAY_MS3 : null,
      age_days: resolved === null && first !== null ? (nowMs - first) / DAY_MS3 : null,
      fix_available_at: fixAvailableAt,
      actionable_from: actionableFrom,
      mttr_actionable_days: resolved !== null && actionableMs !== null ? (resolved - actionableMs) / DAY_MS3 : null,
      actionable_age_days: open && actionableMs !== null ? (nowMs - actionableMs) / DAY_MS3 : null,
      // `isSca &&` is the flag's DEFINITION, not a shortcut: "awaiting a vendor fix" names a
      // state only a dependency finding can be in. On sast/secrets it is false even for the
      // degenerate row whose first_seen is missing — that row cannot be measured (its actionable
      // fields are null above), which is a different and true statement about it.
      awaiting_vendor_fix: isSca && open && fixAvailableAt === null
    };
  }
  function rowFromEpisode(e) {
    return {
      finding_key: e.finding_key,
      scope: e.scope,
      identifier: e.identifier,
      component: e.component,
      severity: e.severity,
      repo_id: null,
      // gas/'s COMPACTED_ASSET placeholder, on this register's asset column.
      repo_name: COMPACTED_ASSET,
      branch: null,
      platform: null,
      first_seen: e.first_seen,
      last_seen: e.resolved_at,
      status: "RESOLVED",
      resolved_at: e.resolved_at,
      resolution_src: e.resolution_src,
      reopened_count: e.reopened_count,
      first_scan_id: null,
      last_scan_id: null,
      // Carried through compaction (ledgerTypes.EpisodeRow) so a sealed sca episode keeps its
      // actionable-clock inputs; null on sast/secrets episodes, where withDerived does not read
      // them anyway.
      fix_date: e.fix_date,
      fix_observed_at: e.fix_observed_at,
      fixed_version: null,
      has_kev: e.has_kev,
      has_exploit: e.has_exploit,
      epss: e.epss,
      risk_observed_at: null,
      cwe: e.cwe,
      ai_verdict: null,
      language: e.language,
      file_path: null,
      start_line: null,
      origin: null,
      secret_kind: null,
      rotated_at: null,
      removed_at: null,
      validation_state: null,
      validated_at: null,
      confidence: null,
      owner_project: e.owner_project,
      owner_path: null,
      tags_json: null
    };
  }
  function baseRows(state, options = {}) {
    var _a;
    const nowMs = (_a = options.now) != null ? _a : Date.now();
    const scope = options.scope;
    const out = [];
    for (const row of Object.values(state.ledger)) {
      if (scope !== void 0 && row.scope !== scope) continue;
      out.push(withDerived(row, nowMs));
    }
    for (const e of state.episodes) {
      if (e.superseded_by_scan !== null) continue;
      if (e.finding_key in state.ledger) continue;
      if (scope !== void 0 && e.scope !== scope) continue;
      out.push(withDerived(rowFromEpisode(e), nowMs));
    }
    return out;
  }
  function severityCountsFromObservations(observations) {
    var _a;
    const counts = {};
    for (const o of observations) {
      if (o.present !== 1) continue;
      const sev2 = normalizeSeverity(o.severity);
      counts[sev2] = ((_a = counts[sev2]) != null ? _a : 0) + 1;
    }
    return counts;
  }

  // src/domain/program.ts
  var DAY_MS4 = 864e5;
  function isOpen(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function isSastRule(rule) {
    return "cwe" in rule;
  }
  var SIGNAL_NAMES = [
    "kev",
    "exploit",
    "epss",
    "cwe",
    "aiVerdict",
    "critical"
  ];
  function ruleIsEmpty(rule) {
    return isSastRule(rule) ? !rule.cwe && !rule.aiVerdict && !rule.critical : !rule.kev && !rule.exploit && !rule.epss;
  }
  function ruleSentence(rule) {
    const parts = [];
    if (isSastRule(rule)) {
      if (rule.cwe) parts.push("CWE in the Top 25");
      if (rule.aiVerdict) parts.push("AI triage says exploitable");
      if (rule.critical) parts.push("severity CRITICAL");
    } else {
      if (rule.kev) parts.push("CISA KEV");
      if (rule.exploit) parts.push("public exploit");
      if (rule.epss) parts.push("EPSS >= " + rule.epssThreshold.toFixed(2));
    }
    return parts.length ? parts.join(" or ") : "no signal enabled";
  }
  function resolveRule(row, rule) {
    const forScope = ruleForScope(row.scope);
    if (forScope === null) {
      throw new Error(
        `program metrics have no meaning for scope "${row.scope}": coverage and efficiency are rates over a high-risk population, and that scope has no high-risk rule (config.ruleForScope returns null). Segment secrets by validation_state and confidence instead.`
      );
    }
    return rule != null ? rule : forScope;
  }
  function cweMatchesExploited(cwe) {
    const top = CWE_TOP_25_2024;
    for (const raw of cwe.split(",")) {
      const id = raw.trim();
      if (!id) continue;
      if (top.includes(id)) return true;
      const parent = CWE_ANCESTORS[id];
      if (parent !== void 0 && top.includes(parent)) return true;
    }
    return false;
  }
  function cveClauses(row, rule) {
    const epssObserved = typeof row.epss === "number" && Number.isFinite(row.epss);
    const out = [];
    if (rule.kev) {
      out.push({ name: "kev", fired: row.has_kev === true, observed: row.has_kev != null });
    }
    if (rule.exploit) {
      out.push({
        name: "exploit",
        fired: row.has_exploit === true,
        observed: row.has_exploit != null
      });
    }
    if (rule.epss) {
      out.push({
        name: "epss",
        fired: epssObserved && row.epss >= rule.epssThreshold,
        observed: epssObserved
      });
    }
    return out;
  }
  function sastClauses(row, rule) {
    const cwe = typeof row.cwe === "string" ? row.cwe : "";
    const cweObserved = cwe.trim().length > 0;
    const verdictRaw = typeof row.ai_verdict === "string" ? row.ai_verdict.trim() : "";
    const verdictObserved = verdictRaw.length > 0;
    const severity = normalizeSeverity(row.severity);
    const severityObserved = severity !== "UNKNOWN";
    const out = [];
    if (rule.cwe) {
      out.push({ name: "cwe", fired: cweObserved && cweMatchesExploited(cwe), observed: cweObserved });
    }
    if (rule.aiVerdict) {
      out.push({
        name: "aiVerdict",
        fired: verdictObserved && AI_VERDICTS_HIGH.has(verdictRaw.toUpperCase()),
        observed: verdictObserved
      });
    }
    if (rule.critical) {
      out.push({
        name: "critical",
        fired: severityObserved && severity === "CRITICAL",
        observed: severityObserved
      });
    }
    return out;
  }
  function ruleClauses(row, rule) {
    return isSastRule(rule) ? sastClauses(row, rule) : cveClauses(row, rule);
  }
  function firedSignals(row, rule) {
    const r = resolveRule(row, rule);
    return ruleClauses(row, r).filter((c) => c.fired).map((c) => c.name);
  }
  function classifyRisk(row, rule) {
    const r = resolveRule(row, rule);
    if (ruleIsEmpty(r)) return "unknown";
    const clauses = ruleClauses(row, r);
    if (clauses.some((c) => c.fired)) return "high";
    if (clauses.some((c) => !c.observed)) return "unknown";
    return "low";
  }
  var RISK_TIER_ORDER = [...SIGNAL_NAMES, "none", "unknown"];
  function riskTier(row, rule) {
    const cls = classifyRisk(row, rule);
    if (cls !== "high") return cls === "low" ? "none" : "unknown";
    return firedSignals(row, rule)[0];
  }
  var NO_RATE = { point: null, lo: null, hi: null };
  function pct(num2, den) {
    return den > 0 ? num2 / den * 100 : null;
  }
  function emptyMatrix() {
    return {
      tp: 0,
      fp: 0,
      fn: 0,
      tn: 0,
      unknownRemediated: 0,
      unknownOpen: 0,
      classified: 0,
      unknown: 0,
      total: 0,
      remediated: 0,
      open: 0,
      highRisk: 0,
      notHighRisk: 0,
      coverage: NO_RATE,
      efficiency: NO_RATE,
      prevalence: null,
      signalCoveragePct: null
    };
  }
  function finalize(m) {
    m.classified = m.tp + m.fp + m.fn + m.tn;
    m.unknown = m.unknownRemediated + m.unknownOpen;
    m.total = m.classified + m.unknown;
    m.remediated = m.tp + m.fp + m.unknownRemediated;
    m.open = m.fn + m.tn + m.unknownOpen;
    m.highRisk = m.tp + m.fn;
    m.notHighRisk = m.fp + m.tn;
    m.coverage = {
      point: pct(m.tp, m.tp + m.fn),
      lo: pct(m.tp, m.tp + m.fn + m.unknownOpen),
      hi: pct(m.tp + m.unknownRemediated, m.tp + m.unknownRemediated + m.fn)
    };
    m.efficiency = {
      point: pct(m.tp, m.tp + m.fp),
      lo: pct(m.tp, m.tp + m.fp + m.unknownRemediated),
      hi: pct(m.tp + m.unknownRemediated, m.tp + m.fp + m.unknownRemediated)
    };
    m.prevalence = pct(m.highRisk, m.classified);
    m.signalCoveragePct = pct(m.classified, m.total);
    return m;
  }
  function tallyRow(m, row, rule) {
    const open = isOpen(row.status);
    switch (classifyRisk(row, rule)) {
      case "high":
        if (open) m.fn += 1;
        else m.tp += 1;
        break;
      case "low":
        if (open) m.tn += 1;
        else m.fp += 1;
        break;
      default:
        if (open) m.unknownOpen += 1;
        else m.unknownRemediated += 1;
    }
  }
  function confusionMatrix(rows, rule) {
    const m = emptyMatrix();
    for (const row of rows) tallyRow(m, row, rule);
    return finalize(m);
  }
  function confusionBySeverity(rows, rule) {
    var _a;
    const bySev = {};
    const overall = emptyMatrix();
    for (const row of rows) {
      const s2 = normalizeSeverity(row.severity);
      const m = (_a = bySev[s2]) != null ? _a : bySev[s2] = emptyMatrix();
      tallyRow(m, row, rule);
      tallyRow(overall, row, rule);
    }
    const perSev = {};
    for (const s2 of SEVERITY_ORDER) if (bySev[s2]) perSev[s2] = finalize(bySev[s2]);
    return { perSev, overall: finalize(overall) };
  }
  function zeroCounts() {
    return { kev: 0, exploit: 0, epss: 0, cwe: 0, aiVerdict: 0, critical: 0 };
  }
  function signalBreakdown(rows, rule) {
    const out = {
      fired: zeroCounts(),
      missing: zeroCounts(),
      anyOf: 0,
      cweUnmapped: 0
    };
    for (const row of rows) {
      const r = resolveRule(row, rule);
      const clauses = ruleClauses(row, r);
      for (const c of clauses) {
        if (c.fired) out.fired[c.name] += 1;
        if (!c.observed) out.missing[c.name] += 1;
        if (c.name === "cwe" && c.observed && !c.fired) out.cweUnmapped += 1;
      }
      if (classifyRisk(row, r) === "high") out.anyOf += 1;
    }
    return out;
  }
  var RULE_SUBSETS = [
    ["KEV only", true, false, false],
    ["Exploit only", false, true, false],
    ["EPSS only", false, false, true],
    ["KEV or exploit", true, true, false],
    ["KEV or EPSS", true, false, true],
    ["Exploit or EPSS", false, true, true],
    ["All three", true, true, true]
  ];
  var SAST_RULE_SUBSETS = [
    ["CWE only", true, false, false],
    ["AI verdict only", false, true, false],
    ["CRITICAL only", false, false, true],
    ["CWE or AI verdict", true, true, false],
    ["CWE or CRITICAL", true, false, true],
    ["AI verdict or CRITICAL", false, true, true],
    ["All three", true, true, true]
  ];
  function ruleSensitivity(rows, active) {
    if (isSastRule(active)) {
      return SAST_RULE_SUBSETS.map(([label, cwe, aiVerdict, critical]) => {
        const rule = { cwe, aiVerdict, critical };
        return point(
          label,
          rule,
          rows,
          cwe === active.cwe && aiVerdict === active.aiVerdict && critical === active.critical
        );
      });
    }
    return RULE_SUBSETS.map(([label, kev, exploit, epss]) => {
      const rule = { kev, exploit, epss, epssThreshold: active.epssThreshold };
      return point(
        label,
        rule,
        rows,
        kev === active.kev && exploit === active.exploit && epss === active.epss
      );
    });
  }
  function point(label, rule, rows, active) {
    const matrix = confusionMatrix(rows, rule);
    return {
      label,
      rule,
      sentence: ruleSentence(rule),
      active,
      coverage: matrix.coverage.point,
      efficiency: matrix.efficiency.point,
      highRisk: matrix.highRisk,
      unknown: matrix.unknown,
      matrix
    };
  }
  function monthKey(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
  }
  function monthStartMs(key) {
    const [y, m] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, 1);
  }
  function nextMonthKey(key) {
    const [y, m] = key.split("-").map(Number);
    return m === 12 ? y + 1 + "-01" : y + "-" + String(m + 1).padStart(2, "0");
  }
  function verdictOf(netPct) {
    if (netPct === null || Math.abs(netPct) <= NET_CAPACITY_BAND_PCT) return "keeping-up";
    return netPct > 0 ? "gaining" : "falling-behind";
  }
  function capacityByMonth(rows, scans, options = {}) {
    var _a, _b, _c, _d, _e, _f;
    const nowMs = (_a = options.now) != null ? _a : Date.now();
    const parsed = [];
    for (const row of rows) {
      if (options.highRiskOnly && classifyRisk(row, options.rule) !== "high") continue;
      const first = parseTs(row.first_seen);
      if (first === null) continue;
      parsed.push({ first, resolved: parseTs(row.resolved_at) });
    }
    const scanMs = scans.filter((s2) => s2["shape"] !== "grouped").map((s2) => parseTs(s2["ts"])).filter((t) => t !== null);
    const firstScanMs = scanMs.length ? minNum(scanMs) : null;
    const observedFromMs = options.observedFrom !== void 0 ? parseTs(options.observedFrom) : firstScanMs;
    const observedMonth = observedFromMs === null ? null : monthKey(observedFromMs);
    const scanClosedByMonth = {};
    if (options.closedObserved !== void 0) {
      for (const [k, v] of Object.entries((_b = options.closedObserved) != null ? _b : {})) {
        const t = parseTs(k);
        const key = t === null ? k : monthKey(t);
        scanClosedByMonth[key] = ((_c = scanClosedByMonth[key]) != null ? _c : 0) + Number(v != null ? v : 0);
      }
    } else {
      for (const s2 of scans) {
        if (s2["shape"] === "grouped") continue;
        const t = parseTs(s2["ts"]);
        if (t === null) continue;
        if (firstScanMs !== null && t === firstScanMs) continue;
        const k = monthKey(t);
        scanClosedByMonth[k] = ((_d = scanClosedByMonth[k]) != null ? _d : 0) + Number((_e = s2["resolved_count"]) != null ? _e : 0);
      }
    }
    if (!parsed.length) {
      return { months: [], mmcrMean: null, oneInN: null, netTotal: 0, verdict: null, monthsCounted: 0 };
    }
    const earliest = minNum(parsed.map((p) => p.first));
    const months = [];
    const lastKey = monthKey(nowMs);
    for (let key = monthKey(earliest); ; key = nextMonthKey(key)) {
      const start = monthStartMs(key);
      const end = monthStartMs(nextMonthKey(key));
      let openAtStart = 0;
      let opened = 0;
      let closed = 0;
      for (const p of parsed) {
        if (p.first < start && (p.resolved === null || p.resolved >= start)) openAtStart += 1;
        if (p.first >= start && p.first < end) opened += 1;
        if (p.resolved !== null && p.resolved >= start && p.resolved < end) closed += 1;
      }
      const netPct = openAtStart > 0 ? (closed - opened) / openAtStart * 100 : null;
      months.push({
        month: key,
        openAtStart,
        opened,
        closed,
        mmcr: openAtStart > 0 ? closed / openAtStart * 100 : null,
        net: closed - opened,
        netPct,
        verdict: verdictOf(netPct),
        // The first month is partial only in the sense that the register begins mid-month; it
        // still fully observes its own closures, so only the current month is excluded.
        partial: key === lastKey,
        reconstructed: observedMonth !== null && key < observedMonth,
        scanClosed: (_f = scanClosedByMonth[key]) != null ? _f : null
      });
      if (key === lastKey) break;
      if (months.length > 600) break;
    }
    const counted = months.filter((m) => !m.partial && !m.reconstructed && m.mmcr !== null);
    const mmcrMean = counted.length ? counted.reduce((a, m) => a + m.mmcr, 0) / counted.length : null;
    const netTotal = months.reduce((a, m) => a + m.net, 0);
    const netPctOverall = counted.length ? counted.reduce((a, m) => {
      var _a2;
      return a + ((_a2 = m.netPct) != null ? _a2 : 0);
    }, 0) / counted.length : null;
    const trimmed = options.maxMonths !== void 0 && months.length > options.maxMonths ? months.slice(months.length - options.maxMonths) : months;
    return {
      months: trimmed,
      mmcrMean,
      oneInN: mmcrMean !== null && mmcrMean > 0 ? 100 / mmcrMean : null,
      netTotal,
      verdict: counted.length ? verdictOf(netPctOverall) : null,
      monthsCounted: counted.length
    };
  }
  function observationWindowDays(rows, now) {
    const nowMs = now != null ? now : Date.now();
    const firsts = rows.map((r) => parseTs(r.first_seen)).filter((t) => t !== null);
    if (!firsts.length) return null;
    return (nowMs - minNum(firsts)) / DAY_MS4;
  }

  // src/domain/insights.ts
  function isOpen2(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function sev(r) {
    return normalizeSeverity(r["severity"]);
  }
  function byScope(rows, scope) {
    return scope ? rows.filter((r) => r.scope === scope) : rows;
  }
  function severityStats(records, scope) {
    var _a;
    const rows = scope ? records.filter((r) => r["scope"] === scope) : records;
    const out = {};
    for (const r of rows) {
      const s2 = sev(r);
      const stat = (_a = out[s2]) != null ? _a : out[s2] = { total: 0, open: 0, resolved: 0 };
      stat.total += 1;
      if (isOpen2(r["status"])) stat.open += 1;
      else stat.resolved += 1;
    }
    return out;
  }
  var AGE_BUCKET_EDGES = [7, 30, 90];
  function ageBuckets(rows, scope) {
    const { perKey, totalOpen } = ageBucketsBy(rows, (r) => normalizeSeverity(r.severity), scope);
    return { perSev: perKey, totalOpen };
  }
  function ageBucketsBy(rowsIn, keyOf2, scope) {
    const rows = byScope(rowsIn, scope);
    const perKey = {};
    let totalOpen = 0;
    for (const row of rows) {
      if (!isOpen2(row.status)) continue;
      const age = row.age_days;
      if (typeof age !== "number" || !Number.isFinite(age)) continue;
      const bucket = age <= AGE_BUCKET_EDGES[0] ? 0 : age <= AGE_BUCKET_EDGES[1] ? 1 : age <= AGE_BUCKET_EDGES[2] ? 2 : 3;
      const k = keyOf2(row);
      if (!perKey[k]) perKey[k] = [0, 0, 0, 0];
      perKey[k][bucket] += 1;
      totalOpen += 1;
    }
    return { perKey, totalOpen };
  }
  var AGED_OPEN_EDGE = AGE_BUCKET_EDGES[2];
  function openAge(row) {
    if (!isOpen2(row.status)) return null;
    const age = row.age_days;
    return typeof age === "number" && Number.isFinite(age) ? age : null;
  }
  function rankGroups(rows, keyFn, topN, meta) {
    const groups = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const age = openAge(row);
      if (age === null) continue;
      const raw = keyFn(row);
      const key = raw && raw.trim() !== "" ? raw : "(none)";
      let g = groups.get(key);
      if (!g) groups.set(key, g = { key, agedCount: 0, openCount: 0, oldestDays: 0, ...meta ? meta(row) : {} });
      g.openCount += 1;
      if (age > AGED_OPEN_EDGE) g.agedCount += 1;
      if (age > g.oldestDays) g.oldestDays = age;
    }
    return [...groups.values()].sort((a, b) => b.agedCount - a.agedCount || b.oldestDays - a.oldestDays || a.key.localeCompare(b.key)).slice(0, topN);
  }
  function oldestOpen(rows, topN = 7, scope) {
    const scoped = byScope(rows, scope);
    const findings = scoped.map((r) => ({ r, age: openAge(r) })).filter((x) => x.age !== null).sort((a, b) => b.age - a.age).slice(0, topN).map(({ r, age }) => ({
      identifier: r.identifier,
      repo: r.repo_name,
      ownerProject: r.owner_project,
      severity: normalizeSeverity(r.severity),
      ageDays: age
    }));
    return {
      findings,
      byRepo: rankGroups(scoped, (r) => {
        var _a;
        return String((_a = r.repo_name) != null ? _a : "");
      }, topN, (r) => {
        var _a;
        return {
          ownerProject: String((_a = r.owner_project) != null ? _a : "")
        };
      })
    };
  }
  function movement(baseRowsIn, latestFlatScan, scanCount, scope) {
    if (!latestFlatScan) {
      return { newCount: 0, resolvedCount: 0, reopenedCount: 0, persisting: 0, hasPrevious: scanCount > 1 };
    }
    const baseRows2 = byScope(baseRowsIn, scope);
    let persisting = 0;
    for (const row of baseRows2) {
      if (!isOpen2(row.status)) continue;
      if (row.last_scan_id === latestFlatScan.scan_id && row.first_scan_id !== latestFlatScan.scan_id) {
        persisting += 1;
      }
    }
    return {
      newCount: latestFlatScan.new_count,
      resolvedCount: latestFlatScan.resolved_count,
      reopenedCount: latestFlatScan.reopened_count,
      persisting,
      hasPrevious: scanCount > 1
    };
  }
  var GROUP_COLUMNS = {
    repo: "repo_name",
    language: "language",
    owner_project: "owner_project",
    secret_kind: "secret_kind",
    cwe: "cwe"
  };
  function riskTierStats(rowsIn, rule, scope) {
    var _a;
    const rows = byScope(rowsIn, scope);
    const perTier = {};
    for (const t of RISK_TIER_ORDER) perTier[t] = 0;
    let open = 0;
    let excludedSecrets = 0;
    for (const row of rows) {
      if (!isOpen2(row.status)) continue;
      if (row.scope === "secrets") {
        excludedSecrets += 1;
        continue;
      }
      open += 1;
      perTier[riskTier(row, rule)] += 1;
    }
    return { perTier, open, unclassified: (_a = perTier["unknown"]) != null ? _a : 0, excludedSecrets };
  }
  function triageFunnel(rowsIn, rule, exposedKeys, exposureKnown, scope) {
    const rows = byScope(rowsIn, scope);
    const out = {
      open: 0,
      intel: 0,
      exploitable: 0,
      exposed: 0,
      overdue: 0,
      unclassified: 0,
      exposureKnown,
      excludedSecrets: 0
    };
    for (const row of rows) {
      if (!isOpen2(row.status)) continue;
      if (row.scope === "secrets") {
        out.excludedSecrets += 1;
        continue;
      }
      out.open += 1;
      const tier = riskTier(row, rule);
      if (tier === "unknown") {
        out.unclassified += 1;
        continue;
      }
      out.intel += 1;
      if (tier !== "kev" && tier !== "exploit") continue;
      out.exploitable += 1;
      if (!exposureKnown || !exposedKeys.has(row.finding_key)) continue;
      out.exposed += 1;
      const target = SLA_TARGETS[normalizeSeverity(row.severity)];
      const age = row.actionable_age_days;
      if (typeof target === "number" && typeof age === "number" && Number.isFinite(age) && age > target) {
        out.overdue += 1;
      }
    }
    return out;
  }
  function concentration(records, dims, topN = 5, scope) {
    var _a;
    const rows = scope ? records.filter((r) => r["scope"] === scope) : records;
    const perDim = {};
    const moreDim = {};
    for (const dim of dims) {
      const column = GROUP_COLUMNS[dim];
      if (!column) continue;
      const buckets = /* @__PURE__ */ new Map();
      for (const r of rows) {
        if (!isOpen2(r["status"])) continue;
        const raw = r[column];
        const k = raw === null || raw === void 0 || String(raw).trim() === "" ? "(none)" : String(raw);
        let b = buckets.get(k);
        if (!b) buckets.set(k, b = { open: 0, repos: /* @__PURE__ */ new Set(), kev: 0 });
        b.open += 1;
        const a = String((_a = r["repo_name"]) != null ? _a : "");
        if (a) b.repos.add(a);
        if (r["has_kev"] === true) b.kev += 1;
      }
      const rowsRanked = [...buckets.entries()].map(([key, b]) => ({ key, open: b.open, repos: b.repos.size, kev: b.kev })).sort((a, b) => b.open - a.open || a.key.localeCompare(b.key));
      perDim[dim] = rowsRanked.slice(0, topN);
      moreDim[dim] = Math.max(0, rowsRanked.length - topN);
    }
    return { perDim, moreDim };
  }

  // src/domain/remediation.ts
  var DAY_MS5 = 864e5;
  function isOpen3(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function resolvedMttr(row) {
    const m = row.mttr_days;
    return typeof m === "number" && Number.isFinite(m) ? m : null;
  }
  function openAge2(row) {
    if (!isOpen3(row.status)) return null;
    const a = row.age_days;
    return typeof a === "number" && Number.isFinite(a) ? a : null;
  }
  function kmCurve(events, times) {
    const curve = [];
    let s2 = 1;
    for (const t of [...new Set(events)].sort((a, b) => a - b)) {
      const atRisk = times.filter((x) => x >= t).length;
      if (atRisk === 0) continue;
      const d = events.filter((x) => x === t).length;
      s2 *= 1 - d / atRisk;
      curve.push({ t, s: s2, atRisk, events: d });
    }
    return curve;
  }
  function kmQuantileFromCurve(curve, q) {
    const threshold = 1 - q;
    for (const p of curve) if (p.s <= threshold) return p.t;
    return null;
  }
  function kmMedianFromCurve(curve) {
    return kmQuantileFromCurve(curve, 0.5);
  }
  function kaplanMeier(rows) {
    const events = [];
    const censored = [];
    for (const row of rows) {
      const m = resolvedMttr(row);
      if (m !== null) {
        events.push(m);
        continue;
      }
      const c = openAge2(row);
      if (c !== null) censored.push(c);
    }
    const times = events.concat(censored);
    const total = events.length + censored.length;
    const restrictionTime = times.length ? maxNum(times) : null;
    const naiveMean = mean(events);
    const naiveMedian = median(events);
    if (!events.length) {
      return {
        curve: [],
        median: null,
        medianLowerBound: restrictionTime,
        mean: null,
        restrictionTime,
        meanTruncated: false,
        naiveMean,
        naiveMedian,
        events: 0,
        censored: censored.length,
        total
      };
    }
    const curve = kmCurve(events, times);
    const median_ = kmMedianFromCurve(curve);
    const tau = restrictionTime;
    let rmst = 0;
    let prevT = 0;
    let prevS = 1;
    for (const p of curve) {
      rmst += prevS * (p.t - prevT);
      prevT = p.t;
      prevS = p.s;
    }
    rmst += prevS * (tau - prevT);
    return {
      curve,
      median: median_,
      medianLowerBound: median_ === null ? restrictionTime : null,
      mean: rmst,
      restrictionTime,
      meanTruncated: prevS > 0,
      // S(τ) = S_m > 0
      naiveMean,
      naiveMedian,
      events: events.length,
      censored: censored.length,
      total
    };
  }
  function filterScope(rows, scope) {
    return scope ? rows.filter((r) => r.scope === void 0 || r.scope === scope) : rows;
  }
  var RESOLUTION_BUCKET_EDGES = [1, 7, 30, 90];
  var RESOLUTION_BUCKET_LABELS = ["\u22641d", "2\u20137d", "8\u201330d", "31\u201390d", "90+d"];
  function mttrPercentiles(rows, opts) {
    var _a;
    const filtered = filterScope(rows, opts == null ? void 0 : opts.scope);
    const bySev = {};
    const all = [];
    for (const row of filtered) {
      const m = resolvedMttr(row);
      if (m === null) continue;
      const s2 = normalizeSeverity(row.severity);
      ((_a = bySev[s2]) != null ? _a : bySev[s2] = []).push(m);
      all.push(m);
    }
    const perSev = {};
    for (const s2 of SEVERITY_ORDER) {
      const vals = bySev[s2];
      if (!vals) continue;
      perSev[s2] = { p50: quantile(vals, 0.5), p90: quantile(vals, 0.9), count: vals.length };
    }
    return {
      perSev,
      overall: { p50: quantile(all, 0.5), p90: quantile(all, 0.9), count: all.length }
    };
  }
  function resolutionBuckets(rows, opts) {
    const filtered = filterScope(rows, opts == null ? void 0 : opts.scope);
    const perSev = {};
    let total = 0;
    for (const row of filtered) {
      const m = resolvedMttr(row);
      if (m === null) continue;
      const bucket = m <= RESOLUTION_BUCKET_EDGES[0] ? 0 : m <= RESOLUTION_BUCKET_EDGES[1] ? 1 : m <= RESOLUTION_BUCKET_EDGES[2] ? 2 : m <= RESOLUTION_BUCKET_EDGES[3] ? 3 : 4;
      const s2 = normalizeSeverity(row.severity);
      if (!perSev[s2]) perSev[s2] = [0, 0, 0, 0, 0];
      perSev[s2][bucket] += 1;
      total += 1;
    }
    return { perSev, labels: RESOLUTION_BUCKET_LABELS, total };
  }
  function openPastSla(rows, opts) {
    var _a, _b;
    const filtered = filterScope(rows, opts == null ? void 0 : opts.scope);
    const perSev = {};
    let totalOpen = 0;
    let totalBreached = 0;
    for (const row of filtered) {
      const age = openAge2(row);
      if (age === null) continue;
      const s2 = normalizeSeverity(row.severity);
      const target = (_a = SLA_TARGETS[s2]) != null ? _a : null;
      const stat = (_b = perSev[s2]) != null ? _b : perSev[s2] = { open: 0, breached: 0, pct: null, target };
      stat.open += 1;
      totalOpen += 1;
      if (target !== null && age > target) {
        stat.breached += 1;
        totalBreached += 1;
      }
    }
    for (const stat of Object.values(perSev)) {
      stat.pct = stat.open ? stat.breached / stat.open * 100 : null;
    }
    return {
      perSev,
      overall: {
        open: totalOpen,
        breached: totalBreached,
        pct: totalOpen ? totalBreached / totalOpen * 100 : null
      }
    };
  }
  function actionableView(rows) {
    return rows.map((r) => ({
      severity: r.severity,
      status: r.status,
      mttr_days: r.mttr_actionable_days,
      age_days: r.actionable_age_days
    }));
  }
  function awaitingVendorFix(rows, opts) {
    var _a;
    const filtered = filterScope(rows, opts == null ? void 0 : opts.scope);
    const perSev = {};
    let overall = 0;
    let openTotal = 0;
    let notApplicable = 0;
    for (const row of filtered) {
      if (!isOpen3(row.status)) continue;
      openTotal += 1;
      if (row.scope !== void 0 && row.scope !== "sca") {
        if (row.awaiting_vendor_fix) notApplicable += 1;
        continue;
      }
      if (!row.awaiting_vendor_fix) continue;
      const s2 = normalizeSeverity(row.severity);
      perSev[s2] = ((_a = perSev[s2]) != null ? _a : 0) + 1;
      overall += 1;
    }
    return {
      perSev,
      overall,
      openTotal,
      pctOfOpen: openTotal ? overall / openTotal * 100 : null,
      notApplicable
    };
  }
  function latencyObservation(row, nowMs) {
    const first = parseTs(row.first_seen);
    if (first === null) return null;
    const fixAvail = parseTs(row.fix_available_at);
    if (fixAvail !== null) {
      const raw = fixAvail - first;
      return { t: Math.max(0, raw) / DAY_MS5, event: true, closedBeforeFix: false };
    }
    const resolved = parseTs(row.resolved_at);
    if (resolved !== null) {
      return { t: Math.max(0, resolved - first) / DAY_MS5, event: false, closedBeforeFix: true };
    }
    if (isOpen3(row.status)) {
      return { t: Math.max(0, nowMs - first) / DAY_MS5, event: false, closedBeforeFix: false };
    }
    return null;
  }
  function latencyView(rows, origin, now, opts) {
    const nowMs = now != null ? now : Date.now();
    const filtered = filterScope(rows, opts == null ? void 0 : opts.scope);
    const out = [];
    for (const row of filtered) {
      const obs = latencyObservation(row, nowMs);
      if (obs === null) continue;
      out.push({
        severity: row.severity,
        status: obs.event ? "RESOLVED" : "OPEN",
        mttr_days: obs.event ? obs.t : null,
        age_days: obs.event ? null : obs.t
      });
    }
    return out;
  }
  function latencySegments(rows, origin, now, opts) {
    const nowMs = now != null ? now : Date.now();
    const filtered = filterScope(rows, opts == null ? void 0 : opts.scope);
    const seg = {
      events: 0,
      censored: 0,
      closedBeforeFix: 0,
      zeroAtOrigin: 0,
      unmeasured: 0,
      total: 0
    };
    for (const row of filtered) {
      seg.total += 1;
      const obs = latencyObservation(row, nowMs);
      if (obs === null) {
        seg.unmeasured += 1;
      } else if (obs.event) {
        seg.events += 1;
        if (obs.t === 0) seg.zeroAtOrigin += 1;
      } else if (obs.closedBeforeFix) {
        seg.closedBeforeFix += 1;
      } else {
        seg.censored += 1;
      }
    }
    return seg;
  }
  function baseRowNoFix(row) {
    return row.scope === "sca" && row.awaiting_vendor_fix === true;
  }

  // src/domain/trend.ts
  var DAY_MS6 = 864e5;
  var round1 = (v) => v === null ? null : Math.round(v * 10) / 10;
  var round3 = (v) => v === null ? null : Math.round(v * 1e3) / 1e3;
  function byScope2(rows, scope) {
    return scope ? rows.filter((r) => r["scope"] === scope) : rows;
  }
  function bySeverity(rows, severities) {
    if (severities === null || !rows.length) return rows;
    const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
    return rows.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  function scopeRows(base, severities, scope) {
    return bySeverity(byScope2(base, scope), severities);
  }
  function pointTimes(scans, scope) {
    return byScope2(scans, scope).map((s2) => ({ iso: String(s2["ts"]), ms: parseTs(s2["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
  }
  function mttrOf(r) {
    const m = r["mttr_days"];
    return typeof m === "number" && !Number.isNaN(m) ? m : null;
  }
  function awaitingFixAsOf(firstMs, resolvedMs, fixAvailMs, d) {
    const openAsOfD = firstMs !== null && firstMs <= d && (resolvedMs === null || resolvedMs > d);
    return openAsOfD && (fixAvailMs === null || fixAvailMs > d);
  }
  function trendFromFrames(scans, base, severities = null, opts = {}) {
    var _a;
    const hideNoFix = (_a = opts.hideNoFix) != null ? _a : false;
    const rows = scopeRows(base, severities, opts.scope);
    if (!scans.length || !rows.length) return [];
    const times = pointTimes(scans, opts.scope);
    if (!times.length) return [];
    const parsed = rows.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      mttr: mttrOf(r),
      sev: normalizeSeverity(r["severity"]),
      fixAvail: parseTs(r["fix_available_at"])
    }));
    const out = [];
    for (const ts of times) {
      const resolvedMask = parsed.map((r) => r.resolvedAt !== null && r.resolvedAt <= ts.ms);
      const openMask = parsed.map(
        (r) => r.first !== null && r.first <= ts.ms && (r.resolvedAt === null || r.resolvedAt > ts.ms) && !(hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms))
      );
      const resolvedMttr2 = parsed.filter((_, i) => resolvedMask[i]).map((r) => r.mttr).filter((m) => m !== null);
      const med = median(resolvedMttr2);
      const denom = resolvedMttr2.length;
      const within = parsed.filter(
        (r, i) => resolvedMask[i] && r.mttr !== null && SLA_TARGETS[r.sev] !== void 0 && r.mttr <= SLA_TARGETS[r.sev]
      ).length;
      const slaPct = denom ? within / denom * 100 : null;
      const p90s = [];
      for (const sev2 of SEVERITY_ORDER) {
        const ages = parsed.filter((r, i) => openMask[i] && r.sev === sev2).map((r) => (ts.ms - r.first) / DAY_MS6);
        if (ages.length) {
          const p = quantile(ages, 0.9);
          if (p !== null) p90s.push(p);
        }
      }
      const oldest = p90s.length ? maxNum(p90s) : null;
      out.push({
        date: ts.iso,
        open: openMask.filter(Boolean).length,
        resolved: resolvedMask.filter(Boolean).length,
        median_days: round3(med),
        sla_pct: round1(slaPct),
        oldest_open_days: round3(oldest)
      });
    }
    return out;
  }
  function trendFromBase(scans, base, severities = null, opts = {}) {
    var _a;
    const hideNoFix = (_a = opts.hideNoFix) != null ? _a : false;
    const scope = opts.scope;
    const tag = (points, synthetic2) => points.map((p) => ({ ...p, reconstructed: synthetic2.has(p.date) }));
    if (!opts.backfill) {
      return tag(trendFromFrames(scans, base, severities, { hideNoFix, scope }), /* @__PURE__ */ new Set());
    }
    const rows = scopeRows(base, severities, scope);
    const realMs = pointTimes(scans, scope).map((t) => t.ms);
    const firstSeenMs = rows.map((r) => parseTs(r["first_seen"])).filter((t) => t !== null);
    const synthetic = [];
    const syntheticIso = /* @__PURE__ */ new Set();
    if (realMs.length && firstSeenMs.length) {
      const firstScanDay = Math.floor(minNum(realMs) / DAY_MS6) * DAY_MS6;
      const startDay = Math.floor(minNum(firstSeenMs) / DAY_MS6) * DAY_MS6;
      for (let day = startDay; day < firstScanDay; day += DAY_MS6) {
        const iso = toIso(day);
        if (iso === null) continue;
        synthetic.push(scope ? { ts: iso, scope } : { ts: iso });
        syntheticIso.add(iso);
      }
    }
    return tag(
      trendFromFrames(synthetic.concat(scans), base, severities, { hideNoFix, scope }),
      syntheticIso
    );
  }
  function kmSkipMask(points, max) {
    if (max === void 0 || max < 0) return null;
    const reconIdx = [];
    points.forEach((p, i) => {
      if (p.reconstructed) reconIdx.push(i);
    });
    if (reconIdx.length <= max) return null;
    const skip = new Array(points.length).fill(false);
    for (const i of reconIdx) skip[i] = true;
    if (max > 0) {
      const last = reconIdx.length - 1;
      const denom = max === 1 ? 1 : max - 1;
      for (let k = 0; k < max; k++) {
        skip[reconIdx[Math.round(k * last / denom)]] = false;
      }
    }
    return skip;
  }
  function withKmMedian(points, base, severities = null, opts = {}) {
    var _a;
    const hideNoFix = (_a = opts.hideNoFix) != null ? _a : false;
    const rows = scopeRows(base, severities, opts.scope);
    const parsed = rows.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      mttr: mttrOf(r),
      fixAvail: parseTs(r["fix_available_at"])
    }));
    const skip = kmSkipMask(points, opts.maxReconstructed);
    return points.map((p, i) => {
      if (skip !== null && skip[i]) return { ...p, km_median_days: null };
      const d = parseTs(p.date);
      let med = null;
      if (d !== null) {
        const events = [];
        const risk = [];
        for (const r of parsed) {
          if (r.resolvedAt !== null && r.resolvedAt <= d) {
            if (r.mttr !== null) {
              events.push(r.mttr);
              risk.push(r.mttr);
            }
          } else if (r.first !== null && r.first <= d) {
            if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, d)) continue;
            risk.push((d - r.first) / DAY_MS6);
          }
        }
        med = kmMedianFromCurve(kmCurve(events, risk));
      }
      return { ...p, km_median_days: round3(med) };
    });
  }
  function kmMedianAsOf(base, severities, d, opts = {}) {
    var _a;
    if (d === null || !base.length) return null;
    const hideNoFix = (_a = opts.hideNoFix) != null ? _a : false;
    const rows = scopeRows(base, severities, opts.scope);
    const events = [];
    const risk = [];
    for (const r of rows) {
      const resolvedAt = parseTs(r["resolved_at"]);
      if (resolvedAt !== null && resolvedAt <= d) {
        const mttr = mttrOf(r);
        if (mttr !== null) {
          events.push(mttr);
          risk.push(mttr);
        }
        continue;
      }
      const first = parseTs(r["first_seen"]);
      if (first !== null && first <= d) {
        if (hideNoFix && awaitingFixAsOf(first, resolvedAt, parseTs(r["fix_available_at"]), d)) {
          continue;
        }
        risk.push((d - first) / DAY_MS6);
      }
    }
    return round3(kmMedianFromCurve(kmCurve(events, risk)));
  }
  function withOpenPastSla(points, base, severities = null, fromField = "first_seen", opts = {}) {
    const rows = scopeRows(base, severities, opts.scope);
    const parsed = rows.map((r) => ({
      origin: parseTs(r[fromField]),
      resolvedAt: parseTs(r["resolved_at"]),
      sev: normalizeSeverity(r["severity"])
    }));
    return points.map((p) => {
      const d = parseTs(p.date);
      let breached = 0;
      if (d !== null) {
        for (const r of parsed) {
          const open = r.origin !== null && r.origin <= d && (r.resolvedAt === null || r.resolvedAt > d);
          if (!open) continue;
          const target = SLA_TARGETS[r.sev];
          if (target !== void 0 && (d - r.origin) / DAY_MS6 > target) breached += 1;
        }
      }
      return { ...p, open_past_sla: breached };
    });
  }
  function slaDeadlineRows(base, severities, scope) {
    const out = [];
    for (const r of scopeRows(base, severities, scope)) {
      const actionable = parseTs(r["actionable_from"]);
      const target = SLA_TARGETS[normalizeSeverity(r["severity"])];
      if (actionable === null || target === void 0) continue;
      out.push({ deadline: actionable + target * DAY_MS6, resolvedAt: parseTs(r["resolved_at"]) });
    }
    return out;
  }
  function withSlaBurn(points, base, severities = null, opts = {}) {
    const parsed = slaDeadlineRows(base, severities, opts.scope);
    let prevMs = null;
    return points.map((p, i) => {
      const d = parseTs(p.date);
      let entered = null;
      let cleared = null;
      if (i > 0 && prevMs !== null && d !== null) {
        entered = 0;
        cleared = 0;
        for (const r of parsed) {
          if (r.deadline > prevMs && r.deadline <= d && (r.resolvedAt === null || r.resolvedAt > r.deadline)) {
            entered += 1;
          }
          if (r.resolvedAt !== null && r.resolvedAt > prevMs && r.resolvedAt <= d && r.resolvedAt > r.deadline) {
            cleared += 1;
          }
        }
      }
      prevMs = d;
      return {
        ...p,
        sla_entered: entered,
        sla_cleared: cleared,
        sla_net: entered !== null && cleared !== null ? entered - cleared : null
      };
    });
  }
  function cohortSlaAttainment(points, base, severities = null, opts = {}) {
    const parsed = slaDeadlineRows(base, severities, opts.scope);
    return points.map((p) => {
      const d = parseTs(p.date);
      let cohort = 0;
      let met = 0;
      if (d !== null) {
        for (const r of parsed) {
          if (r.deadline > d) continue;
          cohort += 1;
          if (r.resolvedAt !== null && r.resolvedAt <= r.deadline) met += 1;
        }
      }
      return { ...p, sla_attainment_pct: cohort ? round1(met / cohort * 100) : null };
    });
  }
  function withCoverageEfficiency(points, base, rule, severities = null, opts = {}) {
    const rows = scopeRows(base, severities, opts.scope);
    const secrets = rows.filter((r) => r["scope"] === "secrets");
    const classifiable = rows.filter((r) => r["scope"] !== "secrets");
    const parsed = classifiable.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      cls: classifyRisk(r, rule)
    }));
    const secretFirst = secrets.map((r) => parseTs(r["first_seen"]));
    return points.map((p) => {
      const d = parseTs(p.date);
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let unknown = 0;
      let counted = 0;
      let excluded = 0;
      if (d !== null) {
        for (const r of parsed) {
          if (r.first === null || r.first > d) continue;
          const remediated = r.resolvedAt !== null && r.resolvedAt <= d;
          counted += 1;
          if (r.cls === "unknown") {
            unknown += 1;
            continue;
          }
          if (r.cls === "high") {
            if (remediated) tp += 1;
            else fn += 1;
          } else if (remediated) {
            fp += 1;
          }
        }
        for (const first of secretFirst) if (first !== null && first <= d) excluded += 1;
      }
      return {
        ...p,
        coverage_pct: round1(tp + fn > 0 ? tp / (tp + fn) * 100 : null),
        efficiency_pct: round1(tp + fp > 0 ? tp / (tp + fp) * 100 : null),
        high_risk_open: fn,
        high_risk_remediated: tp,
        unknown_pct: round1(counted > 0 ? unknown / counted * 100 : null),
        secrets_excluded: excluded
      };
    });
  }

  // src/domain/maintenance.ts
  var RETENTION_MIN_DAYS = 30;
  var CHECKPOINT_VERSION = 1;
  var LedgerRebuildError = class extends Error {
  };
  var SealedScanError = class extends LedgerRebuildError {
  };
  function recordsFromPayload(payload) {
    return extractNodes(payload);
  }
  function coerceResults(results) {
    if (results === null || results === void 0) return results;
    if (typeof results === "object") return results;
    if (typeof results === "string") {
      try {
        return JSON.parse(results.trim());
      } catch {
        return results;
      }
    }
    return results;
  }
  function extractNodes(results) {
    var _a, _b;
    const coerced = coerceResults(results);
    if (!coerced) return [];
    if (Array.isArray(coerced) && coerced.length && typeof coerced[0] === "object") {
      const merged = [];
      let ok = false;
      for (const page of coerced) {
        if (page && typeof page === "object" && !Array.isArray(page)) {
          const sub = extractNodes(page);
          if (sub.length) {
            pushAll(merged, sub);
            ok = true;
          }
        }
      }
      if (ok) return merged;
    }
    if (coerced && typeof coerced === "object" && !Array.isArray(coerced)) {
      const obj = coerced;
      const data = obj["data"];
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const v of Object.values(data)) {
          if (v && typeof v === "object" && !Array.isArray(v) && "nodes" in v) {
            return (_a = v["nodes"]) != null ? _a : [];
          }
        }
      }
      if ("nodes" in obj) return (_b = obj["nodes"]) != null ? _b : [];
    }
    if (Array.isArray(coerced)) return coerced;
    return [coerced];
  }
  function loadReplayPayloads(rows, readPayload, missingMsg) {
    const replay = [];
    for (const r of rows) {
      if (r.sealed) continue;
      const payload = readPayload(r);
      if (payload === null) {
        throw new LedgerRebuildError(missingMsg(r.scan_id));
      }
      replay.push({ row: r, payload });
    }
    return replay;
  }
  function replayScans(rebuilt, replay) {
    const observationsByScan = {};
    for (const { row, payload } of replay) {
      const { observations } = persistFlatScan(rebuilt, recordsFromPayload(payload), {
        scope: row.scope,
        mode: row.mode,
        scanId: row.scan_id,
        scannedSeverities: parseSeverities(row.severities),
        rawRef: row.raw_ref,
        obsRef: row.obs_ref
      });
      observationsByScan[row.scan_id] = observations;
    }
    return observationsByScan;
  }
  function settledEpisodeRows(checkpointLedger, ledger, sealedIds) {
    var _a;
    const episodes = [];
    for (const cpRow of checkpointLedger) {
      if (cpRow.status !== "RESOLVED") continue;
      const live = ledger[cpRow.finding_key];
      if (live === void 0 || live.status !== "RESOLVED" || live.resolved_at !== cpRow.resolved_at || !sealedIds.has((_a = live.last_scan_id) != null ? _a : "")) {
        continue;
      }
      episodes.push(live);
    }
    return episodes;
  }
  function toEpisodeRow(live, compactionId) {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
      finding_key: live.finding_key,
      scope: live.scope,
      identifier: live.identifier,
      component: live.component,
      severity: live.severity,
      first_seen: live.first_seen,
      resolved_at: live.resolved_at,
      resolution_src: live.resolution_src,
      reopened_count: Number((_a = live.reopened_count) != null ? _a : 0),
      compaction_id: compactionId,
      superseded_by_scan: null,
      fix_date: live.fix_date,
      fix_observed_at: live.fix_observed_at,
      has_kev: (_b = live.has_kev) != null ? _b : null,
      has_exploit: (_c = live.has_exploit) != null ? _c : null,
      epss: (_d = live.epss) != null ? _d : null,
      cwe: (_e = live.cwe) != null ? _e : null,
      language: (_f = live.language) != null ? _f : null,
      owner_project: (_g = live.owner_project) != null ? _g : null
    };
  }
  function deleteScansCore(state, scanIds, readPayload, checkpoint, now) {
    var _a;
    const targets = new Set([...scanIds].filter(Boolean));
    const zero = { deleted: 0, scans: 0, tracked: 0 };
    if (!targets.size) {
      return { state, result: zero, observationsByScan: {} };
    }
    const rows = scansAsc(state.scans);
    const present2 = new Set(rows.filter((r) => targets.has(r.scan_id)).map((r) => r.scan_id));
    if (!present2.size) {
      return { state, result: zero, observationsByScan: {} };
    }
    const sealedTargets = rows.filter((r) => present2.has(r.scan_id) && r.sealed).map((r) => r.scan_id).sort();
    if (sealedTargets.length) {
      throw new SealedScanError(
        `Cannot delete sealed scan(s) ${sealedTargets.join(", ")}: they are part of the compacted baseline (their raw archives were pruned), so their effects can no longer be un-replayed.`
      );
    }
    const survivors = rows.filter((r) => !present2.has(r.scan_id));
    const replay = loadReplayPayloads(
      survivors,
      readPayload,
      (scanId) => `Cannot delete: the archived payload for surviving scan ${scanId} is missing, so the ledger can't be rebuilt.`
    );
    const rebuilt = {
      scans: survivors.filter((r) => r.sealed).map((r) => ({ ...r })),
      ledger: {},
      episodes: state.episodes.map((e) => ({ ...e, superseded_by_scan: null }))
    };
    if (checkpoint !== null) {
      const episodeKeys = new Set(state.episodes.map((e) => e.finding_key));
      for (const row of (_a = checkpoint.ledger) != null ? _a : []) {
        if (!episodeKeys.has(row.finding_key)) rebuilt.ledger[row.finding_key] = { ...row };
      }
    }
    const observationsByScan = replayScans(rebuilt, replay);
    return {
      state: rebuilt,
      result: {
        deleted: present2.size,
        scans: rebuilt.scans.length,
        tracked: baseRows(rebuilt, { now }).length
      },
      observationsByScan
    };
  }
  function buildCheckpoint(rows, newly, prevCheckpoint, floorRow, readPayload) {
    var _a;
    const tmp = emptyState();
    if (prevCheckpoint !== null) {
      for (const row of (_a = prevCheckpoint.ledger) != null ? _a : []) tmp.ledger[row.finding_key] = { ...row };
    }
    for (const r of rows) {
      if (r.sealed) tmp.scans.push({ ...r });
    }
    for (const r of newly) {
      const payload = readPayload(r);
      if (payload === null) {
        throw new LedgerRebuildError(
          `Cannot compact: the archived payload for scan ${r.scan_id} is missing or unreadable.`
        );
      }
      persistFlatScan(tmp, recordsFromPayload(payload), {
        scope: r.scope,
        mode: r.mode,
        scanId: r.scan_id,
        scannedSeverities: parseSeverities(r.severities)
      });
    }
    return {
      version: CHECKPOINT_VERSION,
      floor_scan_id: floorRow ? floorRow.scan_id : null,
      floor_ts: floorRow ? floorRow.ts : null,
      ledger: Object.values(tmp.ledger)
    };
  }
  function openAndResolved(state) {
    const out = [];
    for (const row of Object.values(state.ledger)) {
      out.push({
        finding_key: row.finding_key,
        scope: row.scope,
        severity: row.severity,
        first_seen: row.first_seen,
        status: row.status,
        resolved_at: row.resolved_at
      });
    }
    for (const e of state.episodes) {
      if (e.superseded_by_scan !== null || e.finding_key in state.ledger) continue;
      out.push({
        finding_key: e.finding_key,
        scope: e.scope,
        severity: e.severity,
        first_seen: e.first_seen,
        status: "RESOLVED",
        resolved_at: e.resolved_at
      });
    }
    return out;
  }
  function coverageOf(state, now) {
    const rows = baseRows(state, { now });
    const out = {};
    for (const scope of SCOPES) {
      if (ruleForScope(scope) === null) continue;
      const scoped = [];
      for (const r of rows) {
        if (r.scope !== scope) continue;
        scoped.push({
          scope: r.scope,
          severity: r.severity,
          status: r.status,
          has_kev: r.has_kev,
          has_exploit: r.has_exploit,
          epss: r.epss,
          cwe: r.cwe,
          ai_verdict: r.ai_verdict
        });
      }
      out[scope] = confusionMatrix(scoped);
    }
    return out;
  }
  function trendOf(state, now) {
    return trendFromFrames(
      state.scans.map((s2) => ({ ts: s2.ts, scope: s2.scope })),
      baseRows(state, { now }).map((r) => ({
        severity: r.severity,
        first_seen: r.first_seen,
        resolved_at: r.resolved_at,
        mttr_days: r.mttr_days,
        fix_available_at: r.fix_available_at
      }))
    );
  }
  function compactLedgerCore(state, retentionDays, prevCheckpoint, readPayload, options) {
    var _a, _b, _c, _d;
    const dryRun = Boolean(options.dryRun);
    const result = {
      no_op: true,
      dry_run: dryRun,
      scans_sealed: 0,
      episodes_created: 0,
      observations_pruned: 0,
      archive_bytes_freed: 0,
      db_bytes_freed: 0,
      floor_scan_id: null,
      floor_ts: null
    };
    const noOp = {
      result,
      checkpoint: null,
      newly: [],
      state: null,
      compactionId: null
    };
    if (retentionDays === null) return noOp;
    const days = Math.max(Math.trunc(retentionDays), RETENTION_MIN_DAYS);
    const nowMs = (_a = options.now) != null ? _a : Date.now();
    const cutoff = nowMs - days * 864e5;
    const rows = scansAsc(state.scans);
    if (!rows.length) return noOp;
    const candidates = selectSealCandidates(rows, cutoff);
    const sealedPrefix = rows.filter((r) => r.sealed);
    const candidatePrefixIds = candidates.slice(0, sealedPrefix.length).map((r) => r.scan_id);
    if (JSON.stringify(candidatePrefixIds) !== JSON.stringify(sealedPrefix.map((r) => r.scan_id))) {
      return noOp;
    }
    const newly = candidates.filter((r) => !r.sealed);
    if (!newly.length) return noOp;
    const floorRow = candidates.length ? candidates[candidates.length - 1] : null;
    const checkpoint = buildCheckpoint(rows, newly, prevCheckpoint, floorRow, readPayload);
    const sealedIds = new Set(candidates.map((r) => r.scan_id));
    const episodes = settledEpisodeRows(checkpoint.ledger, state.ledger, sealedIds);
    const newlyIds = newly.map((r) => r.scan_id);
    let obsCount = 0;
    for (const id of newlyIds) obsCount += (_c = (_b = options.obsCountByScan) == null ? void 0 : _b[id]) != null ? _c : 0;
    result.no_op = false;
    result.scans_sealed = newly.length;
    result.episodes_created = episodes.length;
    result.observations_pruned = obsCount;
    result.archive_bytes_freed = (_d = options.archiveBytes) != null ? _d : 0;
    result.floor_scan_id = checkpoint.floor_scan_id;
    result.floor_ts = checkpoint.floor_ts;
    if (dryRun) return { result, checkpoint, newly, state: null, compactionId: null };
    const beforeMttr = mttrFromLedger(openAndResolved(state), { now: nowMs });
    const beforeTrend = trendOf(state, nowMs);
    const beforeCoverage = coverageOf(state, nowMs);
    const newlyIdSet = new Set(newlyIds);
    const applied = {
      scans: state.scans.map(
        (r) => newlyIdSet.has(r.scan_id) ? { ...r, sealed: 1, raw_ref: null, obs_ref: null } : { ...r }
      ),
      ledger: {},
      episodes: [
        ...state.episodes.map((e) => ({ ...e })),
        ...episodes.map((e) => toEpisodeRow(e, options.compactionId))
      ]
    };
    const converted = new Set(episodes.map((e) => e.finding_key));
    for (const [key, row] of Object.entries(state.ledger)) {
      if (!converted.has(key)) applied.ledger[key] = { ...row };
    }
    const afterMttr = mttrFromLedger(openAndResolved(applied), { now: nowMs });
    const afterTrend = trendOf(applied, nowMs);
    if (!statsEqual(
      { perSev: beforeMttr.perSev, overall: beforeMttr.overall },
      { perSev: afterMttr.perSev, overall: afterMttr.overall }
    ) || !statsEqual(beforeTrend, afterTrend)) {
      throw new LedgerRebuildError(
        "Compaction aborted: MTTR/SLA/trend stats would change \u2014 rolled back."
      );
    }
    if (!statsEqual(beforeCoverage, coverageOf(applied, nowMs))) {
      throw new LedgerRebuildError(
        "Compaction aborted: coverage/efficiency would change \u2014 rolled back."
      );
    }
    return { result, checkpoint, newly, state: applied, compactionId: options.compactionId };
  }
  function compactionRow(plan, checkpointRef, now) {
    return {
      compaction_id: plan.compactionId,
      ts: nowIso(now),
      floor_scan_id: plan.result.floor_scan_id,
      floor_ts: plan.result.floor_ts,
      scans_sealed: plan.result.scans_sealed,
      episodes_created: plan.result.episodes_created,
      archive_bytes_freed: plan.result.archive_bytes_freed,
      checkpoint_ref: checkpointRef
    };
  }

  // src/domain/settingsLogic.ts
  var DEFAULT_SYNC_HOUR = 5;
  var DEFAULT_SETTINGS = {
    scopes: [...SCOPES],
    fetchSeverities: {
      sca: [...DEFAULT_FETCH_SEVERITIES.sca],
      sast: [...DEFAULT_FETCH_SEVERITIES.sast],
      secrets: [...DEFAULT_FETCH_SEVERITIES.secrets]
    },
    slaTargets: { ...SLA_TARGETS },
    showExperimental: false,
    syncSchedule: DEFAULT_SYNC_HOUR,
    autoCompact: false,
    retentionDays: DEFAULT_RETENTION_DAYS
  };
  function asList(v, allowed) {
    if (!Array.isArray(v)) return null;
    const seen = /* @__PURE__ */ new Set();
    for (const x of v) {
      const s2 = String(x).trim().toUpperCase();
      if (allowed.includes(s2)) seen.add(s2);
    }
    return [...seen];
  }
  function cleanFetchSeverities(raw) {
    var _a, _b;
    const out = {};
    if (Array.isArray(raw)) {
      const shared = (_a = asList(raw, SEVERITY_ORDER)) != null ? _a : [];
      for (const scope of SCOPES) {
        out[scope] = shared.length ? [...shared] : [...DEFAULT_FETCH_SEVERITIES[scope]];
      }
      return out;
    }
    const rec = raw != null ? raw : {};
    for (const scope of SCOPES) {
      out[scope] = (_b = asList(rec[scope], SEVERITY_ORDER)) != null ? _b : [...DEFAULT_FETCH_SEVERITIES[scope]];
    }
    return out;
  }
  function numericOrNull(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim() !== "") {
      const n2 = Number(v);
      return Number.isFinite(n2) ? n2 : null;
    }
    return null;
  }
  function cleanHourOfDay(v, fallback) {
    const n2 = numericOrNull(v);
    if (n2 === null) return fallback;
    return Number.isInteger(n2) && n2 >= 0 && n2 <= 23 ? n2 : fallback;
  }
  function cleanRetentionDays(v) {
    const n2 = numericOrNull(v);
    if (n2 === null) return DEFAULT_RETENTION_DAYS;
    return Math.max(Math.floor(n2), RETENTION_MIN_DAYS);
  }
  function cleanSettings(raw) {
    const r = raw || {};
    const scopes = (Array.isArray(r.scopes) ? r.scopes : []).map((x) => String(x).trim().toLowerCase()).filter((x) => SCOPES.includes(x));
    const sla = { ...SLA_TARGETS };
    const rawSla = r.slaTargets || {};
    for (const sev2 of SEVERITY_ORDER) {
      const v = Number(rawSla[sev2]);
      if (Number.isFinite(v) && v > 0) sla[sev2] = Math.floor(v);
    }
    return {
      // An empty list would collect nothing while looking configured, so it falls back
      // rather than persisting a register that can never fill.
      scopes: scopes.length ? scopes : [...SCOPES],
      fetchSeverities: cleanFetchSeverities(r.fetchSeverities),
      slaTargets: sla,
      showExperimental: r.showExperimental === true,
      syncSchedule: cleanHourOfDay(r.syncSchedule, DEFAULT_SYNC_HOUR),
      // Junk (a string, a number, undefined) coerces to false, same as showExperimental above —
      // only a literal boolean true turns compaction on.
      autoCompact: r.autoCompact === true,
      retentionDays: cleanRetentionDays(r.retentionDays)
    };
  }

  // src/server/sheetsDb.ts
  var TABS = {
    // The ledger. One row per finding_key, MERGED per scan and never truncated — the only
    // non-append table here. Carries all three scopes; `scope` is part of the identity.
    ledger: "finding_ledger",
    // Sealed lifecycles, compacted out of the ledger once their scan is sealed.
    episodes: "resolved_episodes",
    // The scan log, and it is load-bearing: it makes a re-run of one scan a no-op, it records
    // WHICH severities each scan actually covered (so a severity that was not requested is
    // never resolved-by-disappearance), and its first row dates the observation window.
    scans: "scans",
    // Repositories and their owning project hierarchy — the register's asset dimension.
    repos: "repos",
    compactions: "compactions",
    settings: "settings",
    jobs: "jobs",
    meta: "schema_meta"
  };
  var TAB_HEADERS = {
    // Three update disciplines coexist here and they are NOT interchangeable — the same
    // split brick/devsecops arrived at, and the reason its ledger tests read the way they do:
    //   latest-wins            severity, status, the asset columns
    //   sticky-first-wins      fix_date / fix_observed_at, reset only by a reopen
    //   monotone, never reset  has_kev / has_exploit (null -> false -> true), epss keeps the peak
    [TABS.ledger]: [
      // ALL THREE SCOPES. `identifier` is the register-facing name of the thing found, and it
      // is a different field per scope — SCA's CVE, SAST's weakness, and for secrets the
      // CREDENTIAL id: identifier <- secretDataId. `component` is what it was found in.
      "finding_key",
      "scope",
      "identifier",
      "component",
      "severity",
      // All three: the asset dimension. Latest-wins.
      "repo_id",
      "repo_name",
      "branch",
      "platform",
      // All three: the lifecycle the whole product measures.
      "first_seen",
      "last_seen",
      "status",
      "resolved_at",
      "resolution_src",
      "reopened_count",
      "first_scan_id",
      "last_scan_id",
      // SCA ONLY — the second clock's inputs; SAST and secrets have no vendor to wait on.
      // Written from day one even though nothing derives fix_available_at yet — capturing them
      // later would leave a hole no backfill can close.
      "fix_date",
      "fix_observed_at",
      "fixed_version",
      // SCA ONLY. Tri-state forever: Wiz returns null for a signal it never evaluated, and
      // collapsing that to false is what makes an unassessed finding look clean.
      "has_kev",
      "has_exploit",
      "epss",
      "risk_observed_at",
      // SAST fills cwe / ai_verdict / language / origin. SAST AND SECRETS SHARE THE LOCATION
      // PAIR: file_path <- filePath on SAST and <- path on secrets, start_line <- startLine and
      // <- lineNumber. That is not a convenience — lineNumber is part of the secrets row key
      // (above), so the column it lands in has to be the one the key is read back from.
      // ai_verdict <- aiAnalysis.verdict, which Q_SAST already selects and nothing stored:
      // it is the register's only signal about whether a weakness is real, and dropping it on
      // the floor for a phase would leave a column of nulls no backfill can date.
      "cwe",
      "ai_verdict",
      "language",
      "file_path",
      "start_line",
      "origin",
      // Secrets carry their own lifecycle: removal from HEAD is not rotation.
      //
      // FOUR COLUMNS, NOT TWO, and the extra pair is not optional. `rotated_at IS NULL`
      // cannot tell a credential that is still live from one nobody has ever checked, and in
      // this tenant 393,443 of 394,927 secret instances have validationStatus UNKNOWN —
      // 99.6% never checked. Publishing that null as "not rotated" would be the absent-is-
      // never-zero failure at scale, so the state travels in its own column:
      //
      //   validation_state  UNKNOWN | VALID | INVALID | ERROR, from SecretInstanceValidationStatus.
      //                     VALID means the credential still works — a live secret, measured.
      //                     INVALID means it does not — dead, and the evidence for rotation.
      //                     UNKNOWN / ERROR mean unmeasured, which is neither.
      //   validated_at      when that check was last made (lastValidatedAt), so a stale VALID
      //                     can be told from a fresh one.
      //
      // rotated_at then means "the credential was observed dead at this time" and is set from
      // validated_at only where validation_state is INVALID. removed_at is the other axis
      // entirely: the string left HEAD. PROBE_FINDINGS.md §3.
      //
      // IDENTITY IS `(secretDataId, path, lineNumber)`, AND THE CLOCK IS THE EARLIEST
      // `firstSeenAt` ACROSS THE TWINS. Two earlier revisions of this comment were wrong in
      // opposite directions. The first said the pair (secretDataId, path) — which collides
      // 2.27:1. The second said `externalId`, on the evidence that it is unique across the
      // register. It still is. It is unique FOR THE WRONG REASON, and keying on it would
      // silently double the ledger (PROBE_FINDINGS.md §10.6 / §10.7, measured with the
      // severity gate off, over all 1,958 rows rather than §9.5's gated 843):
      //
      //     rows 1,958            REPOSITORY 1,359 · REPOSITORY_BRANCH 599
      //     (secretDataId, path, lineNumber) keys spanning BOTH resource types:  187
      //     identical externalId across the twin:  0          different:  187
      //
      // Wiz builds `externalId` from the resource, and the branch form inserts a branch segment:
      //     REPOSITORY         github.com##<repo>##<path>##<contentHash>##<lineIndex>
      //     REPOSITORY_BRANCH  github.com##<repo>##main##<path>##<contentHash>##<lineIndex>
      // So it does not resolve the duplicate, it PRESERVES it — one credential, in one file, at
      // one line, recorded as two findings with two clocks.
      //
      // AND THE TWO CLOCKS DISAGREE, which is why the tie-break is written down rather than
      // left to whichever row arrives first. Across the 187 twins the earlier `firstSeenAt`
      // belongs to the BRANCH row 135 times and to the REPOSITORY row 52 times — never the same
      // instant — median gap 19.9 days, max 285.3, and 83 of 187 over 30 days. So there is no
      // resource type to prefer: taking REPOSITORY because it is the majority (1,359 of 1,958)
      // would misdate 135 secrets by a median of three weeks. Dedupe on the triple, take the
      // earliest birth date — the clock convention the OS ledger already uses.
      //
      // secretDataId still names the CREDENTIAL and is what rotation groups by — one decision
      // per credential across however many occurrences it has. It is just not the row key.
      //
      // TWO CAVEATS, neither resolved, both of which the ledger depends on:
      //   * A LINE MOVE LOOKS LIKE A NEW FINDING. This key encodes lineNumber, and so does
      //     every other unique candidate — `externalId` and (secretDataId, path, lineNumber,
      //     resource.id) — so there is no line-stable identity on offer. Reformatting a file
      //     closes one finding and opens another, and the MTTR clock believes it.
      //   * UUID STABILITY IS INFERRED, NOT MEASURED. id and secretDataId carry a version-5
      //     nibble, i.e. name-based UUIDs derived from content, which WOULD make them stable
      //     across scans. Re-fetching the sampled rows found both unchanged, but `lastUpdatedAt`
      //     shows no rescan intervened (§10.8), so it is still not the two-scan test the
      //     question asks for. A key that is not stable across scans resolves every row on
      //     every sync.
      //
      // DO NOT ADD isDefaultBranch TO THE SECRETS FILTER TO DEDUPLICATE. There is real
      // duplication — 18 of 176 (secretDataId, path) pairs appear under both REPOSITORY and
      // REPOSITORY_BRANCH, about 10% — and the obvious fix is wrong. Measured (§8.6):
      //     app filter, as shipped                691
      //     + isDefaultBranch {equals:true}       245
      //     + isDefaultBranch {equals:false}        0
      // 245 + 0 != 691. The missing 446 are REPOSITORY-level entities where the flag is
      // ABSENT rather than false — a repository is not a branch, so the predicate does not
      // apply to it. Copying SCA's {equals:true} would cut the register by 65% while reading
      // as deduplication: absent collapsed to false, which is the failure the AI register
      // already has a name for. The duplication is real and wants deduplication on the
      // resource entity, after the rows are keyed — not a filter that drops two-thirds of the
      // register on the way in.
      //
      // SECRETS ONLY. `confidence` <- SecretInstance.confidence, selected by Q_SECRETS and
      // until now dropped: with the severity gate off (config.ts) it is one of the two axes
      // that replaces severity as this register's volume control — severity grades a
      // detection, `validation_state` says whether the credential is dead, and `confidence`
      // says how sure the detector is that it is a credential at all.
      "secret_kind",
      "rotated_at",
      "removed_at",
      "validation_state",
      "validated_at",
      "confidence",
      // All three: ownership, from projects[].
      "owner_project",
      "owner_path",
      "tags_json"
    ],
    [TABS.episodes]: [
      "finding_key",
      "scope",
      "identifier",
      "component",
      "severity",
      "first_seen",
      "resolved_at",
      "resolution_src",
      "reopened_count",
      "compaction_id",
      "superseded_by_scan",
      "fix_date",
      "fix_observed_at",
      "has_kev",
      "has_exploit",
      "epss",
      "cwe",
      "language",
      "owner_project"
    ],
    [TABS.scans]: [
      // `raw_ref` addresses the scan's archived pages; `obs_ref` addresses its OBSERVATION SET
      // — the finding_keys this scan actually saw. Two refs because they answer two questions,
      // and the second is the one resolve-by-disappearance rests on: a key absent from the
      // latest scan's observations is resolved, and without the set persisted the only way to
      // recompute that is to re-read every raw page. Both are Drive ids: internal storage
      // addresses, never client-facing.
      "scan_id",
      "ts",
      "scope",
      "mode",
      "severities",
      "total",
      "new_count",
      "resolved_count",
      "reopened_count",
      "raw_ref",
      "obs_ref",
      "sealed"
    ],
    [TABS.repos]: [
      "repo_id",
      "repo_name",
      "branch",
      "platform",
      "default_branch",
      "owner_project",
      "owner_path",
      "projects_json",
      "first_seen",
      "last_seen"
    ],
    [TABS.compactions]: [
      "compaction_id",
      "ts",
      "floor_scan_id",
      "floor_ts",
      "scans_sealed",
      "episodes_created",
      "archive_bytes_freed",
      "checkpoint_ref"
    ],
    [TABS.settings]: ["key", "value_json"],
    [TABS.jobs]: [
      "job_id",
      "kind",
      "phase",
      "scan_id",
      "scope",
      "cursor",
      "page",
      "findings_so_far",
      "page_size",
      "total_count",
      "params_json",
      "journal_ref",
      "error",
      "started_at",
      "updated_at"
    ],
    [TABS.meta]: ["version"]
  };
  var SCHEMA_VERSION = 2;
  var spreadsheetCache = null;
  function ledgerSpreadsheet() {
    if (spreadsheetCache === null) {
      spreadsheetCache = SpreadsheetApp.openById(requireProp(PROP_KEYS.ledgerSpreadsheetId));
    }
    return spreadsheetCache;
  }
  function sheet(tab) {
    const sh = ledgerSpreadsheet().getSheetByName(tab);
    if (!sh) throw new Error(`Missing tab ${tab} \u2014 run setup().`);
    return sh;
  }
  function ensureTabs(ss) {
    ss.setSpreadsheetTimeZone("Etc/UTC");
    for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
      let sh = ss.getSheetByName(tab);
      if (!sh) {
        sh = ss.insertSheet(tab);
        sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat("@");
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        sh.setFrozenRows(1);
      } else {
        ensureHeaders(sh, tab);
      }
    }
    const dflt = ss.getSheetByName("Sheet1");
    if (dflt && ss.getSheets().length > 1) ss.deleteSheet(dflt);
  }
  function fromCell(v) {
    if (v === "" || v === null || v === void 0) return null;
    if (v instanceof Date) return toIso(v.getTime());
    return v;
  }
  function toCell(v) {
    if (v === null || v === void 0) return "";
    return v;
  }
  var READ_BLOCK_CELLS = 2e5;
  function readGrid(sh, tab, lastRow, lastCol) {
    const out = [];
    let block = Math.max(1, Math.floor(READ_BLOCK_CELLS / Math.max(1, lastCol)));
    let row = 1;
    while (row <= lastRow) {
      const take = Math.min(block, lastRow - row + 1);
      try {
        for (const values of sh.getRange(row, 1, take, lastCol).getValues()) out.push(values);
        row += take;
      } catch (e) {
        if (take <= 1) {
          throw new Error(
            `Reading ${tab} stopped at row ${row} of ${lastRow} (${lastCol} columns): ${e instanceof Error ? e.message : String(e)}`
          );
        }
        block = Math.floor(take / 2);
      }
    }
    return out;
  }
  function mapRows(headers, rows) {
    const out = [];
    for (const values of rows) {
      const row = {};
      let empty = true;
      for (let j = 0; j < headers.length; j++) {
        const h = headers[j];
        if (!h) continue;
        const v = fromCell(values[j]);
        row[h] = v;
        if (v !== null) empty = false;
      }
      if (!empty) out.push(row);
    }
    return out;
  }
  function readAll(tab) {
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];
    const values = readGrid(sh, tab, lastRow, lastCol);
    return mapRows(values[0].map(String), values.slice(1));
  }
  function readTail(tab, n2) {
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    const first = Math.max(2, lastRow - Math.max(1, n2) + 1);
    const values = sh.getRange(first, 1, lastRow - first + 1, lastCol).getValues();
    return mapRows(headers, values);
  }
  function ensureHeaders(sh, tab) {
    var _a, _b;
    const width = Math.max(sh.getLastColumn(), 1);
    const raw = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
    let lastNamed = -1;
    for (let i = 0; i < raw.length; i++) if (raw[i]) lastNamed = i;
    for (let i = 0; i < lastNamed; i++) {
      if (raw[i]) continue;
      throw new Error(
        `Tab "${tab}" has a blank header at column ${i + 1}, between named columns ("${(_a = raw.slice(0, i).filter(Boolean).pop()) != null ? _a : "?"}" and "${raw[lastNamed]}"). Every read and write maps columns by header name, so a gap silently misfiles every value after it. Name the column or delete it, then retry \u2014 no data was written.`
      );
    }
    const existing = raw.slice(0, lastNamed + 1);
    const missing = ((_b = TAB_HEADERS[tab]) != null ? _b : []).filter((h) => !existing.includes(h));
    if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }
    return [...existing, ...missing];
  }
  function writeGrid(sh, headers, startRow, rows) {
    if (!rows.length) return;
    const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
    const range = sh.getRange(startRow, 1, grid.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(grid);
  }
  function overwrite(tab, rows) {
    const sh = sheet(tab);
    const headers = ensureHeaders(sh, tab);
    const lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, headers.length).clearContent();
    writeGrid(sh, headers, 2, rows);
  }
  function appendRows(tab, rows) {
    if (!rows.length) return;
    const sh = sheet(tab);
    writeGrid(sh, ensureHeaders(sh, tab), sh.getLastRow() + 1, rows);
  }
  function dataRowCount(tab) {
    return Math.max(0, sheet(tab).getLastRow() - 1);
  }
  var TRIM_BUFFER_ROWS = 1e3;
  function trimSurplusRows(tab, bufferRows = TRIM_BUFFER_ROWS) {
    const sh = sheet(tab);
    const keep = Math.max(sh.getLastRow(), 1) + Math.max(0, bufferRows);
    const surplus = sh.getMaxRows() - keep;
    if (surplus <= 0) return 0;
    sh.deleteRows(keep + 1, surplus);
    return surplus;
  }
  function updateWhere(tab, keyColumn, keyValue, patch) {
    const sh = sheet(tab);
    if (sh.getLastRow() < 2) return false;
    const headers = ensureHeaders(sh, tab);
    const lastRow = sh.getLastRow();
    const lastCol = headers.length;
    const values = readGrid(sh, tab, lastRow, lastCol);
    const keyIdx = headers.indexOf(keyColumn);
    if (keyIdx < 0) return false;
    for (let i = 1; i < values.length; i++) {
      if (fromCell(values[i][keyIdx]) === keyValue) {
        const rowVals = values[i].slice();
        for (const [k, v] of Object.entries(patch)) {
          const idx = headers.indexOf(k);
          if (idx >= 0) rowVals[idx] = toCell(v);
        }
        sh.getRange(i + 1, 1, 1, lastCol).setValues([rowVals]);
        return true;
      }
    }
    return false;
  }
  function gridSize(tab) {
    const sh = sheet(tab);
    return { rows: sh.getMaxRows(), cols: sh.getMaxColumns() };
  }
  function cellCount() {
    return ledgerSpreadsheet().getSheets().reduce((acc, sh) => acc + sh.getMaxRows() * sh.getMaxColumns(), 0);
  }

  // src/server/setup.ts
  var DAILY_SYNC_HANDLER = "trigger_dailySync";
  var DAILY_SYNC_HOUR = DEFAULT_SYNC_HOUR;
  var WARM_HANDLER = "trigger_warmReadModels";
  var WARM_READY_BY_HOURS = [9, 13, 17];
  var WARM_TRIGGER_HOURS = WARM_READY_BY_HOURS.map((h) => (h + 23) % 24);
  var WARM_TRIGGER_NEAR_MINUTE = 30;
  var WARM_TRIGGER_TZ = "Europe/Paris";
  function warmTriggerSchedule() {
    return `${WARM_TRIGGER_TZ}|${WARM_TRIGGER_HOURS.join(",")}@${WARM_TRIGGER_NEAR_MINUTE}`;
  }
  function setup() {
    const notes = [];
    let ssId = getProp(PROP_KEYS.ledgerSpreadsheetId);
    let ss;
    if (ssId) {
      ss = SpreadsheetApp.openById(ssId);
      notes.push(`Ledger: reusing ${ssId}`);
    } else {
      ss = SpreadsheetApp.create("Wiz Sidekick DevSecOps \u2014 ledger");
      ssId = ss.getId();
      setProp(PROP_KEYS.ledgerSpreadsheetId, ssId);
      notes.push(`Ledger: created ${ssId}`);
    }
    ensureTabs(ss);
    notes.push("Tabs: ensured (headers appended where missing)");
    let folderId = getProp(PROP_KEYS.archiveFolderId);
    if (!folderId) {
      folderId = DriveApp.createFolder("Wiz Sidekick DevSecOps \u2014 archive").getId();
      setProp(PROP_KEYS.archiveFolderId, folderId);
      notes.push(`Archive: created ${folderId}`);
    } else {
      notes.push(`Archive: reusing ${folderId}`);
    }
    if (!getProp(PROP_KEYS.wizAuthUrl)) setProp(PROP_KEYS.wizAuthUrl, DEFAULT_WIZ_AUTH_URL);
    if (!getProp(PROP_KEYS.allowedUsers)) {
      const owner = Session.getEffectiveUser().getEmail();
      if (owner) {
        setProp(PROP_KEYS.allowedUsers, owner);
        notes.push(`Access: seeded ALLOWED_USERS with ${owner}`);
      }
    }
    const dailyExisting = ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === DAILY_SYNC_HANDLER);
    if (!dailyExisting.length) {
      ScriptApp.newTrigger(DAILY_SYNC_HANDLER).timeBased().everyDays(1).atHour(DAILY_SYNC_HOUR).create();
      notes.push(`Daily sync trigger: installed (${DAILY_SYNC_HOUR}:00 script-local)`);
    } else {
      notes.push("Daily sync trigger: already installed");
    }
    const warmExisting = ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === WARM_HANDLER);
    const wantSchedule = warmTriggerSchedule();
    if (warmExisting.length === WARM_TRIGGER_HOURS.length && getProp(PROP_KEYS.warmTriggerSchedule) === wantSchedule) {
      notes.push(`Warm triggers: already installed (${wantSchedule})`);
    } else {
      for (const t of warmExisting) ScriptApp.deleteTrigger(t);
      for (const hour of WARM_TRIGGER_HOURS) {
        ScriptApp.newTrigger(WARM_HANDLER).timeBased().everyDays(1).atHour(hour).nearMinute(WARM_TRIGGER_NEAR_MINUTE).inTimezone(WARM_TRIGGER_TZ).create();
      }
      setProp(PROP_KEYS.warmTriggerSchedule, wantSchedule);
      notes.push(
        `Warm triggers: installed ${WARM_TRIGGER_HOURS.length}x daily, warm by ${WARM_READY_BY_HOURS.map((h) => `${h}:00`).join(", ")} ${WARM_TRIGGER_TZ}` + (warmExisting.length ? ` (replaced ${warmExisting.length})` : "")
      );
    }
    return notes.join("\n");
  }

  // src/server/settingsStore.ts
  var settingsMemo;
  function loadSettings() {
    var _a, _b;
    if (settingsMemo) return settingsMemo;
    const raw = {};
    for (const row of readAll(TABS.settings)) {
      const key = String((_a = row.key) != null ? _a : "");
      if (!key) continue;
      try {
        raw[key] = JSON.parse(String((_b = row.value_json) != null ? _b : "null"));
      } catch {
        raw[key] = null;
      }
    }
    settingsMemo = cleanSettings(raw);
    return settingsMemo;
  }
  function saveSettings(next) {
    const cleaned = cleanSettings(next);
    const rows = Object.entries(cleaned).map(([key, value]) => ({
      key,
      value_json: JSON.stringify(value)
    }));
    overwrite(TABS.settings, rows);
    settingsMemo = cleaned;
    bumpDataVersion();
    return cleaned;
  }

  // src/server/diagnostics.ts
  function deploymentDiagnostic() {
    const out = [];
    const ok = (label, value) => out.push(`  OK    ${label}: ${value}`);
    const bad = (label, value) => out.push(`  FAIL  ${label}: ${value}`);
    out.push(`Wiz Sidekick DevSecOps \u2014 deployment diagnostic`);
    out.push(`Build ${BUILD_ID}, schema v${SCHEMA_VERSION}`);
    out.push("");
    const ssId = getProp(PROP_KEYS.ledgerSpreadsheetId);
    if (ssId) {
      try {
        const ss = ledgerSpreadsheet();
        ok("Ledger spreadsheet", `${ss.getName()} (${ssId})`);
        for (const tab of Object.values(TABS)) {
          const rows = dataRowCount(tab);
          out.push(`        ${tab}: ${rows} row${rows === 1 ? "" : "s"}`);
        }
        ok("Cells used", String(cellCount()));
      } catch (e) {
        bad("Ledger spreadsheet", `${ssId} exists as a property but could not be opened: ${e}`);
      }
    } else {
      bad("Ledger spreadsheet", "not created \u2014 run setup()");
    }
    const folderId = getProp(PROP_KEYS.archiveFolderId);
    if (folderId) ok("Archive folder", folderId);
    else bad("Archive folder", "not created \u2014 run setup()");
    if (hasWizCredentials()) ok("Wiz credentials", "present");
    else bad("Wiz credentials", "absent \u2014 set WIZ_API_TOKEN, or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET");
    const users = getProp(PROP_KEYS.allowedUsers);
    if (users) ok("Allowlist", `${users.split(/[,;\s]+/).filter(Boolean).length} address(es)`);
    else bad("Allowlist", "empty \u2014 the app is owner-only until ALLOWED_USERS is set");
    const s2 = loadSettings();
    ok("Scopes collected", s2.scopes.join(", ") || "(none)");
    ok("Scopes available", SCOPES.join(", "));
    for (const scope of SCOPES) {
      ok(`Severities requested (${scope})`, s2.fetchSeverities[scope].join(", ") || "(all)");
    }
    out.push("");
    out.push("Sync battery: not installed. This build ships the interface base and the page");
    out.push("composition; collection is Phase 2 (see README.md).");
    return out.join("\n");
  }

  // src/server/api.ts
  var api_exports = {};
  __export(api_exports, {
    bootstrap: () => bootstrap,
    cancelSync: () => cancelSync2,
    compact: () => compact,
    deleteScans: () => deleteScans2,
    getChartsBundle: () => getChartsBundle,
    getExecutivePage: () => getExecutivePage,
    getExportCsv: () => getExportCsv,
    getJobStatus: () => getJobStatus,
    getMttrPage: () => getMttrPage,
    getProgramPage: () => getProgramPage,
    getRecentErrors: () => getRecentErrors,
    getRegisterPage: () => getRegisterPage,
    getRegisterRows: () => getRegisterRows,
    getReposPage: () => getReposPage,
    getScanHistory: () => getScanHistory,
    getSecretsPage: () => getSecretsPage,
    getSettings: () => getSettings,
    getStorageStats: () => getStorageStats,
    putSettings: () => putSettings,
    resetLedger: () => resetLedger2,
    runSync: () => runSync
  });

  // src/domain/pagePayload.ts
  function execMttrSlice(mttr) {
    var _a, _b;
    if (!mttr || typeof mttr !== "object") return null;
    const m = mttr;
    const overall = (_a = m["overall"]) != null ? _a : {};
    const km = ((_b = m["remediation"]) != null ? _b : {})["km"];
    return {
      rowCount: m["rowCount"],
      overall: { resolved: overall["resolved"], open: overall["open"] },
      remediation: km ? { km: { median: km["median"], medianLowerBound: km["medianLowerBound"] } } : {}
    };
  }
  function execGroupSlice(byGroup) {
    if (!byGroup || typeof byGroup !== "object") return null;
    const b = byGroup;
    const rows = Array.isArray(b["rows"]) ? b["rows"] : [];
    return {
      dimension: b["dimension"],
      rows: rows.map((r) => {
        var _a;
        return {
          group: (_a = r["group"]) != null ? _a : r["domain"],
          kmMedian: r["kmMedian"],
          open: r["open"]
        };
      })
    };
  }
  function pickRows(rows, keys) {
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const out = {};
      for (const k of keys) if (k in r) out[k] = r[k];
      return out;
    });
  }
  var MTTR_TREND_KEYS = [
    "date",
    "reconstructed",
    "open",
    "resolved",
    "median_days",
    "km_median_days",
    "open_past_sla",
    "sla_net",
    "sla_attainment_pct"
  ];
  var HISTORY_TREND_KEYS = ["date", "reconstructed", "open", "resolved", "km_median_days"];
  var PROGRAM_TREND_KEYS = ["date", "reconstructed", "coverage_pct", "efficiency_pct"];
  function mttrPageTrendSlice(trends) {
    var _a;
    if (!trends || typeof trends !== "object") return null;
    const t = trends;
    return { history: (_a = t["history"]) != null ? _a : [], trend: pickRows(t["trend"], MTTR_TREND_KEYS) };
  }
  function historyTrendSlice(trends) {
    if (!trends || typeof trends !== "object") return null;
    return { trend: pickRows(trends["trend"], HISTORY_TREND_KEYS) };
  }
  function programTrendSlice(trends) {
    if (!trends || typeof trends !== "object") return null;
    return { trend: pickRows(trends["trend"], PROGRAM_TREND_KEYS) };
  }
  var SCAN_ROW_KEYS = [
    "scan_id",
    "ts",
    "scope",
    "mode",
    "total",
    "new_count",
    "resolved_count",
    "reopened_count",
    "severities",
    "sealed"
  ];
  function scanRowsSlice(scans) {
    return pickRows(scans, SCAN_ROW_KEYS);
  }
  function latestScanSlice(scan) {
    var _a;
    if (!scan || typeof scan !== "object") return null;
    return (_a = scanRowsSlice([scan])[0]) != null ? _a : null;
  }
  function mttrGroupTableSlice(byGroup) {
    if (!byGroup || typeof byGroup !== "object") return null;
    const b = byGroup;
    return { dimension: b["dimension"], rows: Array.isArray(b["rows"]) ? b["rows"] : [] };
  }
  var JOB_KEYS = [
    // `page_size` rides along with `page` and `total_count` because the three are the only
    // honest per-scope progress fraction on offer: `findings_so_far` is cumulative across the
    // whole sync while `total_count` is one scope's, so their ratio is wrong from the second
    // register onward. All three are per-scope (scanJobs resets page/page_size on advance) and
    // none is sensitive — a page size is a constant of this app, not a fact about the tenant.
    "job_id",
    "kind",
    "phase",
    "scope",
    "page",
    "page_size",
    "findings_so_far",
    "total_count",
    "started_at",
    "updated_at",
    "error"
  ];
  function jobSummarySlice(job, stale) {
    var _a, _b;
    if (!job || typeof job !== "object") return null;
    const j = job;
    const out = { stale };
    for (const k of JOB_KEYS) out[k] = (_a = j[k]) != null ? _a : null;
    let incremental = null;
    try {
      const raw = j["params_json"];
      if (typeof raw === "string" && raw) incremental = Boolean((_b = JSON.parse(raw)) == null ? void 0 : _b.incremental);
    } catch {
      incremental = null;
    }
    out["incremental"] = incremental;
    return out;
  }
  var REGISTER_ROW_COLUMNS = {
    sca: [
      "identifier",
      "component",
      "severity",
      "status",
      "repo_name",
      "branch",
      "first_seen",
      "last_seen",
      "fixed_version",
      "fix_available_at",
      "awaiting_vendor_fix",
      "has_kev",
      "has_exploit",
      "epss",
      "mttr_days",
      "age_days"
    ],
    sast: [
      "identifier",
      "cwe",
      "file_path",
      "start_line",
      "language",
      "origin",
      "ai_verdict",
      "severity",
      "status",
      "repo_name",
      "first_seen",
      "last_seen",
      "age_days"
    ],
    secrets: [
      "identifier",
      "secret_kind",
      "confidence",
      "file_path",
      "start_line",
      "validation_state",
      "validated_at",
      "rotated_at",
      "removed_at",
      "repo_name",
      "branch",
      "first_seen",
      "last_seen"
    ]
  };
  var REGISTER_ROW_KEY = "finding_key";
  var REGISTER_ROW_DEFAULT_SORT = {
    sca: { sort: "age_days", dir: "desc" },
    sast: { sort: "age_days", dir: "desc" },
    secrets: { sort: "first_seen", dir: "asc" }
  };
  var REGISTER_ROWS_PAGE_SIZE_CAP = 250;
  var REGISTER_ROWS_DEFAULT_PAGE_SIZE = 50;
  function registerRowColumns(scope) {
    var _a;
    return (_a = REGISTER_ROW_COLUMNS[scope]) != null ? _a : [];
  }
  function registerRowsSlice(rows, scope) {
    const cols = registerRowColumns(scope);
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const key = r[REGISTER_ROW_KEY];
      const out = { [REGISTER_ROW_KEY]: key === void 0 ? null : key };
      for (const k of cols) out[k] = r[k] === void 0 ? null : r[k];
      return out;
    });
  }
  function compareRegisterValues(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
    const sa = String(a).toLowerCase();
    const sb = String(b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  function nullsLastOrder(a, b) {
    const na = a === null || a === void 0;
    const nb = b === null || b === void 0;
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    return null;
  }
  function sortRegisterRows(rows, spec) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const value = spec && spec.value;
    if (typeof value !== "function") return list;
    const descending = Boolean(spec.descending);
    const tiebreak = typeof spec.tiebreak === "function" ? spec.tiebreak : null;
    return list.sort((ra, rb) => {
      const va = value(ra);
      const vb = value(rb);
      const order = nullsLastOrder(va, vb);
      if (order === null) {
        const d = compareRegisterValues(va, vb);
        if (d !== 0) return descending ? -d : d;
      } else if (order !== 0) {
        return order;
      }
      if (!tiebreak) return 0;
      const ta = tiebreak(ra);
      const tb = tiebreak(rb);
      const tie = nullsLastOrder(ta, tb);
      return tie === null ? compareRegisterValues(ta, tb) : tie;
    });
  }
  function pageOfRegisterRows(rows, page, pageSize) {
    const size = Math.max(1, Math.floor(pageSize));
    const pageCount = Math.max(1, Math.ceil(rows.length / size));
    const clamped = Math.min(Math.max(Math.floor(page) || 0, 0), pageCount - 1);
    return {
      rows: rows.slice(clamped * size, (clamped + 1) * size),
      page: clamped,
      pageCount
    };
  }
  var DATE_SORT_COLUMNS = /* @__PURE__ */ new Set([
    "first_seen",
    "last_seen",
    "fix_available_at",
    "validated_at",
    "rotated_at",
    "removed_at"
  ]);
  var NUMBER_SORT_COLUMNS = /* @__PURE__ */ new Set(["start_line", "epss", "mttr_days", "age_days"]);
  function severityRank(v) {
    const s2 = normalizeSeverity(v);
    const i = SEVERITY_ORDER.indexOf(s2);
    return i === -1 ? SEVERITY_ORDER.length : i;
  }
  function orNull(v) {
    return v === null || v === void 0 || v === "" ? null : v;
  }
  function registerSortValue(column) {
    if (column === "severity") return (r) => severityRank(r["severity"]);
    if (DATE_SORT_COLUMNS.has(column)) return (r) => parseTs(r[column]);
    if (NUMBER_SORT_COLUMNS.has(column)) {
      return (r) => {
        const raw = orNull(r[column]);
        if (raw === null) return null;
        const n2 = Number(raw);
        return Number.isFinite(n2) ? n2 : null;
      };
    }
    return (r) => orNull(r[column]);
  }

  // src/server/jobsStore.ts
  var ACTIVE_JOB_PROP = "ACTIVE_JOB_ID";
  function normError(v) {
    const s2 = v == null ? "" : String(v).trim();
    return s2 === "" || s2 === "null" || s2 === "undefined" ? null : s2;
  }
  function newJobId(kind, now) {
    return `${kind}-${nowIso(now).replace(/[:]/g, "")}`;
  }
  function createJob(row, now) {
    const full = { ...row, started_at: nowIso(now), updated_at: nowIso(now) };
    appendRows(TABS.jobs, [full]);
    setProp(ACTIVE_JOB_PROP, full.job_id);
    return full;
  }
  function updateJob(jobId, patch, now) {
    updateWhere(TABS.jobs, "job_id", jobId, {
      ...patch,
      updated_at: nowIso(now)
    });
    if (patch.phase && isTerminalPhase(patch.phase)) deleteProp(ACTIVE_JOB_PROP);
  }
  function rowToJob(r) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    return {
      job_id: String((_a = r["job_id"]) != null ? _a : ""),
      kind: (_b = r["kind"]) != null ? _b : "sync",
      phase: (_c = r["phase"]) != null ? _c : "FAILED",
      scan_id: (_d = r["scan_id"]) != null ? _d : null,
      scope: (_e = r["scope"]) != null ? _e : null,
      cursor: (_f = r["cursor"]) != null ? _f : null,
      page: Number((_g = r["page"]) != null ? _g : 0),
      findings_so_far: Number((_h = r["findings_so_far"]) != null ? _h : 0),
      page_size: Number((_i = r["page_size"]) != null ? _i : 0),
      total_count: Number((_j = r["total_count"]) != null ? _j : 0),
      params_json: (_k = r["params_json"]) != null ? _k : null,
      journal_ref: (_l = r["journal_ref"]) != null ? _l : null,
      error: normError(r["error"]),
      started_at: String((_m = r["started_at"]) != null ? _m : ""),
      updated_at: String((_n = r["updated_at"]) != null ? _n : "")
    };
  }
  function listJobs() {
    return readAll(TABS.jobs).map(rowToJob);
  }
  var JOB_TAIL_ROWS = 25;
  function getJob(jobId) {
    var _a, _b;
    const recent = readTail(TABS.jobs, JOB_TAIL_ROWS).map(rowToJob);
    return (_b = (_a = recent.find((j) => j.job_id === jobId)) != null ? _a : listJobs().find((j) => j.job_id === jobId)) != null ? _b : null;
  }
  var TERMINAL = ["DONE", "FAILED", "CANCELLED"];
  function isTerminalPhase(phase) {
    return TERMINAL.includes(phase);
  }
  var STALE_JOB_MS = 30 * 6e4;
  function isStaleJob(job, now) {
    const updated = parseTs(job.updated_at);
    if (updated === null) return false;
    return (now != null ? now : Date.now()) - updated >= STALE_JOB_MS;
  }
  function clearTriggers(handlerName) {
    for (const t of ScriptApp.getProjectTriggers()) {
      if (t.getHandlerFunction() === handlerName) ScriptApp.deleteTrigger(t);
    }
  }
  var CONTINUE_HANDLERS = {
    sync: "trigger_continueSync"
  };
  var WATCHDOG_HANDLERS = {
    sync: "trigger_watchdogSync"
  };
  function reclaimIfStale(job, now) {
    if (!isStaleJob(job, now)) return false;
    for (const handler of [CONTINUE_HANDLERS[job.kind], WATCHDOG_HANDLERS[job.kind]]) {
      if (handler) clearTriggers(handler);
    }
    updateJob(job.job_id, {
      phase: "FAILED",
      error: "Reclaimed: the job stalled with no progress."
    });
    return true;
  }
  function activeJob() {
    var _a;
    if (!getProp(ACTIVE_JOB_PROP)) return null;
    const job = (_a = listJobs().find((j) => !isTerminalPhase(j.phase))) != null ? _a : null;
    if (!job) deleteProp(ACTIVE_JOB_PROP);
    return job;
  }

  // src/server/archiveStore.ts
  function looksLikeLedgerState(v) {
    return Array.isArray(v["scans"]) && Array.isArray(v["episodes"]) && typeof v["ledger"] === "object" && v["ledger"] !== null && !Array.isArray(v["ledger"]);
  }
  var rootFolderMemo;
  var subfolderMemo = /* @__PURE__ */ new Map();
  var scanFolderMemo = /* @__PURE__ */ new Map();
  function rootFolder() {
    if (!rootFolderMemo) {
      rootFolderMemo = DriveApp.getFolderById(requireProp(PROP_KEYS.archiveFolderId));
    }
    return rootFolderMemo;
  }
  function childFolder(parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }
  function subfolder(name) {
    const hit = subfolderMemo.get(name);
    if (hit) return hit;
    const folder = childFolder(rootFolder(), name);
    subfolderMemo.set(name, folder);
    return folder;
  }
  function safeName(id) {
    return id.replace(/[^0-9A-Za-z._-]/g, "") || "scan";
  }
  function writeGzJson(folder, name, payload) {
    const json = JSON.stringify(payload);
    const blob = Utilities.gzip(Utilities.newBlob(json, "application/json"), name);
    const existing = folder.getFilesByName(name);
    while (existing.hasNext()) existing.next().setTrashed(true);
    return folder.createFile(blob);
  }
  function parseGzBlob(blob, name) {
    const bytes = blob.getBytes();
    const isGzip = bytes.length > 2 && (bytes[0] & 255) === 31 && (bytes[1] & 255) === 139;
    const text = isGzip ? Utilities.ungzip(blob).getDataAsString("UTF-8") : blob.getDataAsString("UTF-8");
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`Unparseable archive file ${name}: ${e}`);
    }
  }
  function readGzJson(folder, name) {
    const it = folder.getFilesByName(name);
    if (!it.hasNext()) return null;
    return parseGzBlob(it.next().getBlob(), name);
  }
  function readGzJsonNamed(folder, name) {
    return readGzJson(subfolder(folder), name);
  }
  function listNames(folder) {
    const out = [];
    const it = subfolder(folder).getFiles();
    while (it.hasNext()) out.push(it.next().getName());
    return out;
  }
  function trashNamed(folder, name) {
    const it = subfolder(folder).getFilesByName(name);
    while (it.hasNext()) it.next().setTrashed(true);
  }
  function pageFileName(pageIndex) {
    return `page-${String(pageIndex).padStart(4, "0")}.json.gz`;
  }
  var PAGE_NAME_RE = /^page-\d{4}\.json\.gz$/;
  function scanFolder(scanId) {
    const key = safeName(scanId);
    const hit = scanFolderMemo.get(key);
    if (hit) return hit;
    const folder = childFolder(subfolder("scans"), key);
    scanFolderMemo.set(key, folder);
    return folder;
  }
  function writeScanPage(scanId, pageIndex, payload) {
    return writeGzJson(scanFolder(scanId), pageFileName(pageIndex), payload).getId();
  }
  function readScanPages(scanId) {
    const pages = [];
    const files = scanFolder(scanId).getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      if (!PAGE_NAME_RE.test(name)) continue;
      pages.push({ name, payload: parseGzBlob(f.getBlob(), name) });
    }
    pages.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return pages.map((p) => p.payload);
  }
  var SLIM_NAME = "slim.json.gz";
  function writeSlim(scanId, records) {
    return writeGzJson(scanFolder(scanId), SLIM_NAME, records).getId();
  }
  function readSlim(scanId) {
    const parsed = readGzJson(scanFolder(scanId), SLIM_NAME);
    return Array.isArray(parsed) ? parsed : null;
  }
  var PAGE_RUNS_NAME = "pageruns.json.gz";
  function writePageRuns(scanId, runs) {
    writeGzJson(scanFolder(scanId), PAGE_RUNS_NAME, runs);
  }
  function readPageRuns(scanId) {
    const parsed = readGzJson(scanFolder(scanId), PAGE_RUNS_NAME);
    return Array.isArray(parsed) ? parsed : null;
  }
  function obsFileName(scanId) {
    return `${safeName(scanId)}.json.gz`;
  }
  function writeObservations(scanId, keys) {
    return writeGzJson(subfolder("obs"), obsFileName(scanId), keys).getId();
  }
  function readObservations(scanId) {
    const parsed = readGzJson(subfolder("obs"), obsFileName(scanId));
    return Array.isArray(parsed) ? parsed : [];
  }
  function trashScan(scanId) {
    try {
      scanFolder(scanId).setTrashed(true);
    } catch (e) {
      console.warn(`Couldn't trash scan ${scanId}: ${e}`);
    } finally {
      scanFolderMemo.delete(safeName(scanId));
    }
    trashNamed("obs", obsFileName(scanId));
  }
  var SNAPSHOT_NAME = "ledger-snapshot.json.gz";
  function writeLedgerSnapshot(state) {
    const snap = {
      version: 1,
      scans: state.scans,
      ledger: state.ledger,
      episodes: state.episodes
    };
    writeGzJson(subfolder("snapshots"), SNAPSHOT_NAME, snap);
  }
  function readLedgerSnapshot() {
    const parsed = readGzJson(subfolder("snapshots"), SNAPSHOT_NAME);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed;
    return looksLikeLedgerState(obj) ? obj : null;
  }
  function backupFileName(jobId) {
    return `backup-${safeName(jobId)}.json.gz`;
  }
  function writeBackup(jobId, state) {
    return writeGzJson(subfolder("backups"), backupFileName(jobId), state).getId();
  }
  function readBackup(jobId) {
    const parsed = readGzJson(subfolder("backups"), backupFileName(jobId));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed;
    return looksLikeLedgerState(obj) ? obj : null;
  }
  function trashBackup(jobId) {
    trashNamed("backups", backupFileName(jobId));
  }

  // src/server/ledgerStore.ts
  function scanIdFor(syncId, scope) {
    return `${syncId}-${scope}`;
  }
  function archiveIdOf(row) {
    return scanIdFor(row.scan_id, row.scope);
  }
  function s(r, k) {
    const v = r[k];
    return v === null || v === void 0 || v === "" ? null : String(v);
  }
  function n(r, k) {
    const v = s(r, k);
    if (v === null) return null;
    const num2 = Number(v);
    return Number.isFinite(num2) ? num2 : null;
  }
  function scopeOf(key, raw) {
    if (raw === "sca" || raw === "sast" || raw === "secrets") return raw;
    const head = key.slice(0, key.indexOf(":"));
    return head === "sast" || head === "secrets" ? head : "sca";
  }
  function rowToScan(r) {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
      scan_id: String((_a = r["scan_id"]) != null ? _a : ""),
      ts: String((_b = r["ts"]) != null ? _b : ""),
      // A scans row has no key to fall back on, so an unreadable scope defaults to sca the way
      // scopeOf does — but the column is written by this file on every row it appends.
      scope: scopeOf("", s(r, "scope")),
      mode: String((_c = r["mode"]) != null ? _c : ""),
      severities: s(r, "severities"),
      total: Number((_d = r["total"]) != null ? _d : 0),
      new_count: Number((_e = r["new_count"]) != null ? _e : 0),
      resolved_count: Number((_f = r["resolved_count"]) != null ? _f : 0),
      reopened_count: Number((_g = r["reopened_count"]) != null ? _g : 0),
      raw_ref: s(r, "raw_ref"),
      obs_ref: s(r, "obs_ref"),
      sealed: r["sealed"] === 1 || r["sealed"] === "1" || r["sealed"] === true ? 1 : 0
    };
  }
  function rowToLedger(r) {
    var _a, _b, _c;
    const key = String((_a = r["finding_key"]) != null ? _a : "");
    return {
      finding_key: key,
      scope: scopeOf(key, s(r, "scope")),
      identifier: s(r, "identifier"),
      component: s(r, "component"),
      severity: s(r, "severity"),
      repo_id: s(r, "repo_id"),
      repo_name: s(r, "repo_name"),
      branch: s(r, "branch"),
      platform: s(r, "platform"),
      first_seen: s(r, "first_seen"),
      last_seen: s(r, "last_seen"),
      status: String((_b = r["status"]) != null ? _b : "OPEN"),
      resolved_at: s(r, "resolved_at"),
      resolution_src: s(r, "resolution_src"),
      reopened_count: Number((_c = r["reopened_count"]) != null ? _c : 0),
      first_scan_id: s(r, "first_scan_id"),
      last_scan_id: s(r, "last_scan_id"),
      fix_date: s(r, "fix_date"),
      fix_observed_at: s(r, "fix_observed_at"),
      fixed_version: s(r, "fixed_version"),
      // Tri-state, via the domain's own coercion: blank stays null, and the plain-text grid's
      // "TRUE"/"FALSE" round-trip is understood there rather than re-implemented here.
      ...coerceRiskSignals(r),
      cwe: s(r, "cwe"),
      ai_verdict: s(r, "ai_verdict"),
      language: s(r, "language"),
      file_path: s(r, "file_path"),
      start_line: n(r, "start_line"),
      origin: s(r, "origin"),
      secret_kind: s(r, "secret_kind"),
      rotated_at: s(r, "rotated_at"),
      removed_at: s(r, "removed_at"),
      validation_state: s(r, "validation_state"),
      validated_at: s(r, "validated_at"),
      confidence: s(r, "confidence"),
      owner_project: s(r, "owner_project"),
      owner_path: s(r, "owner_path"),
      tags_json: s(r, "tags_json")
    };
  }
  function rowToEpisode(r) {
    var _a, _b, _c;
    const key = String((_a = r["finding_key"]) != null ? _a : "");
    const risk = coerceRiskSignals(r);
    return {
      finding_key: key,
      scope: scopeOf(key, s(r, "scope")),
      identifier: s(r, "identifier"),
      component: s(r, "component"),
      severity: s(r, "severity"),
      first_seen: s(r, "first_seen"),
      resolved_at: s(r, "resolved_at"),
      resolution_src: s(r, "resolution_src"),
      reopened_count: Number((_b = r["reopened_count"]) != null ? _b : 0),
      compaction_id: String((_c = r["compaction_id"]) != null ? _c : ""),
      superseded_by_scan: s(r, "superseded_by_scan"),
      fix_date: s(r, "fix_date"),
      fix_observed_at: s(r, "fix_observed_at"),
      has_kev: risk.has_kev,
      has_exploit: risk.has_exploit,
      epss: risk.epss,
      cwe: s(r, "cwe"),
      language: s(r, "language"),
      owner_project: s(r, "owner_project")
    };
  }
  var scanRowsMemo;
  var stateMemo;
  function invalidateLedgerMemos() {
    scanRowsMemo = void 0;
    stateMemo = void 0;
    bumpDataVersion();
  }
  function loadScanRows() {
    if (scanRowsMemo === void 0) {
      scanRowsMemo = scansAsc(readAll(TABS.scans).map(rowToScan));
    }
    return scanRowsMemo;
  }
  function syncCommitted(syncId) {
    if (!syncId) return false;
    return loadScanRows().some((r) => r.scan_id === syncId);
  }
  function loadState(useSnapshot = true) {
    if (useSnapshot && stateMemo !== void 0) return stateMemo;
    const state = emptyState();
    state.scans = loadScanRows().slice();
    if (useSnapshot) {
      const snap = readLedgerSnapshot();
      if (snap) {
        state.ledger = snap.ledger;
        state.episodes = snap.episodes;
        stateMemo = state;
        return state;
      }
    }
    for (const r of readAll(TABS.ledger)) {
      const row = rowToLedger(r);
      state.ledger[row.finding_key] = row;
    }
    state.episodes = readAll(TABS.episodes).map(rowToEpisode);
    if (useSnapshot) stateMemo = state;
    return state;
  }
  function writeStateTables(state) {
    overwrite(TABS.ledger, Object.values(state.ledger));
    overwrite(TABS.episodes, state.episodes);
    overwrite(TABS.scans, scansAsc(state.scans));
    overwrite(TABS.repos, repoRows(state));
    writeLedgerSnapshot(state);
    invalidateLedgerMemos();
  }
  function repoRows(state) {
    const byRepo = /* @__PURE__ */ new Map();
    const rows = Object.values(state.ledger).slice().sort((a, b) => {
      var _a, _b;
      const ta = (_a = parseTs(a.last_seen)) != null ? _a : 0;
      const tb = (_b = parseTs(b.last_seen)) != null ? _b : 0;
      if (ta !== tb) return ta - tb;
      return a.finding_key < b.finding_key ? -1 : a.finding_key > b.finding_key ? 1 : 0;
    });
    for (const row of rows) {
      const id = row.repo_id;
      if (!id) continue;
      let acc = byRepo.get(id);
      if (!acc) {
        acc = {
          repo_id: id,
          repo_name: null,
          branch: null,
          platform: null,
          owner_project: null,
          owner_path: null,
          first_seen: null,
          last_seen: null
        };
        byRepo.set(id, acc);
      }
      if (row.repo_name !== null) acc.repo_name = row.repo_name;
      if (row.branch !== null) acc.branch = row.branch;
      if (row.platform !== null) acc.platform = row.platform;
      if (row.owner_project !== null) acc.owner_project = row.owner_project;
      if (row.owner_path !== null) acc.owner_path = row.owner_path;
      acc.first_seen = earlier(acc.first_seen, row.first_seen);
      acc.last_seen = later(acc.last_seen, row.last_seen);
    }
    return [...byRepo.values()].sort((a, b) => a.repo_id < b.repo_id ? -1 : a.repo_id > b.repo_id ? 1 : 0).map((a) => ({
      repo_id: a.repo_id,
      repo_name: a.repo_name,
      branch: a.branch,
      platform: a.platform,
      default_branch: null,
      owner_project: a.owner_project,
      owner_path: a.owner_path,
      projects_json: null,
      first_seen: a.first_seen,
      last_seen: a.last_seen
    }));
  }
  function earlier(a, b) {
    const ta = parseTs(a);
    const tb = parseTs(b);
    if (ta === null) return tb === null ? a != null ? a : b : b;
    if (tb === null) return a;
    return tb < ta ? b : a;
  }
  function later(a, b) {
    const ta = parseTs(a);
    const tb = parseTs(b);
    if (ta === null) return tb === null ? a != null ? a : b : b;
    if (tb === null) return a;
    return tb > ta ? b : a;
  }
  function persistSync(jobId, syncId, perScope) {
    var _a, _b;
    const state = loadState();
    const outcomes = [];
    const todo = [];
    for (const entry of perScope) {
      const stored = existingScanDeltas(state.scans, syncId, entry.scope);
      if (stored !== null) {
        outcomes.push({
          scope: entry.scope,
          scan_id: syncId,
          deltas: stored,
          total: 0,
          twins: null,
          written: false
        });
        continue;
      }
      todo.push({ entry });
    }
    if (!todo.length) {
      return { sync_id: syncId, scopes: outcomes, committed_scopes: [] };
    }
    const journalRef = writeBackup(jobId, state);
    updateJob(jobId, { phase: "PERSISTING", scan_id: syncId, journal_ref: journalRef });
    const newRows = [];
    const pendingObs = [];
    for (const { entry } of todo) {
      const out = persistFlatScan(state, entry.records, {
        scope: entry.scope,
        mode: entry.mode,
        // The syncId, which is also the scan's `ts`. See scanIdFor.
        scanId: syncId,
        scannedSeverities: (_a = entry.scannedSeverities) != null ? _a : null,
        rawRef: (_b = entry.rawRef) != null ? _b : null
      });
      outcomes.push({
        scope: entry.scope,
        scan_id: syncId,
        deltas: out.deltas,
        total: entry.records.length,
        twins: out.twinStats,
        written: out.scanRow !== null
      });
      if (out.scanRow) {
        newRows.push(out.scanRow);
        pendingObs.push({
          archiveId: archiveIdOf(out.scanRow),
          keys: observedKeys(out.observations),
          row: out.scanRow
        });
      }
    }
    overwrite(TABS.ledger, Object.values(state.ledger));
    overwrite(TABS.episodes, state.episodes);
    trimSurplusRows(TABS.ledger);
    trimSurplusRows(TABS.episodes);
    for (const obs of pendingObs) {
      obs.row.obs_ref = writeObservations(obs.archiveId, obs.keys);
    }
    writeLedgerSnapshot(state);
    overwrite(TABS.repos, repoRows(state));
    appendRows(TABS.scans, newRows);
    invalidateLedgerMemos();
    updateJob(jobId, { journal_ref: null });
    trashBackup(jobId);
    bumpWizDataVersion();
    return {
      sync_id: syncId,
      scopes: outcomes,
      committed_scopes: newRows.map((r) => r.scope)
    };
  }
  function observedKeys(observations) {
    const keys = [];
    for (const o of observations) if (o.present === 1) keys.push(o.finding_key);
    return keys;
  }
  var readPayloadForRow = (row) => {
    const id = archiveIdOf(row);
    const slim = readSlim(id);
    if (slim !== null) return slim;
    const pages = readScanPages(id);
    return pages.length ? pages : null;
  };
  function loadBaseRows(options = {}) {
    return baseRows(loadState(), options);
  }
  var KM_TREND_MAX_RECONSTRUCTED = 48;
  function loadTrend(options = {}) {
    var _a, _b, _c;
    const state = loadState();
    const severities = (_a = options.severities) != null ? _a : null;
    const scope = options.scope;
    const hideNoFix = !((_b = options.showNoFix) != null ? _b : true);
    const base = ((_c = options.base) != null ? _c : baseRows(state)).map((r) => ({
      scope: r.scope,
      severity: r.severity,
      first_seen: r.first_seen,
      resolved_at: r.resolved_at,
      mttr_days: r.mttr_days,
      actionable_from: r.actionable_from,
      fix_available_at: r.fix_available_at
    }));
    const points = trendFromBase(
      state.scans.map((sc) => ({ ts: sc.ts, scope: sc.scope })),
      base,
      severities,
      { backfill: true, hideNoFix, scope }
    );
    const withSla = withOpenPastSla(points, base, severities, "actionable_from", { scope });
    const withBurn = withSlaBurn(withSla, base, severities, { scope });
    const withAttainment = cohortSlaAttainment(withBurn, base, severities, { scope });
    return withKmMedian(withAttainment, base, severities, {
      hideNoFix,
      maxReconstructed: KM_TREND_MAX_RECONSTRUCTED,
      scope
    });
  }
  function loadProgramTrend(rule, options = {}) {
    var _a, _b;
    const state = loadState();
    const severities = (_a = options.severities) != null ? _a : null;
    const scope = options.scope;
    const base = ((_b = options.base) != null ? _b : baseRows(state)).map((r) => ({
      scope: r.scope,
      severity: r.severity,
      status: r.status,
      first_seen: r.first_seen,
      resolved_at: r.resolved_at,
      mttr_days: r.mttr_days,
      has_kev: r.has_kev,
      has_exploit: r.has_exploit,
      epss: r.epss
    }));
    const points = trendFromBase(
      state.scans.map((sc) => ({ ts: sc.ts, scope: sc.scope })),
      base,
      severities,
      { backfill: true, scope }
    );
    return withCoverageEfficiency(points, base, rule, severities, { scope });
  }
  function previousSeverityCounts(scope) {
    const rows = scansAsc(loadScanRows(), scope);
    if (rows.length < 2) return {};
    const prev = rows[rows.length - 2];
    const ledger = loadState().ledger;
    const observations = readObservations(archiveIdOf(prev)).map((key) => {
      var _a, _b;
      return {
        present: 1,
        severity: (_b = (_a = ledger[key]) == null ? void 0 : _a.severity) != null ? _b : null
      };
    });
    return severityCountsFromObservations(observations);
  }
  function latestScanRow(scope) {
    return latestScan(loadScanRows(), scope);
  }
  function checkpointName(compactionId) {
    return `checkpoint-${compactionId.replace(/[^0-9A-Za-z._-]/g, "")}.json.gz`;
  }
  function readCheckpointRef(ref) {
    if (!ref) return null;
    const parsed = readGzJson(subfolder("checkpoints"), ref);
    return parsed && typeof parsed === "object" ? parsed : null;
  }
  function latestCheckpoint() {
    const rows = readAll(TABS.compactions).filter((r) => r["checkpoint_ref"]);
    if (!rows.length) return null;
    rows.sort((a, b) => String(a["ts"]) < String(b["ts"]) ? 1 : -1);
    return readCheckpointRef(String(rows[0]["checkpoint_ref"]));
  }
  function openJournaledJob(jobId, state, params) {
    const jid = jobId != null ? jobId : newJobId("sync");
    const journalRef = writeBackup(jid, state);
    if (jobId) {
      updateJob(jid, { phase: "PERSISTING", journal_ref: journalRef });
    } else {
      createJob({
        job_id: jid,
        kind: "sync",
        phase: "PERSISTING",
        scan_id: null,
        scope: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: params,
        journal_ref: journalRef,
        error: null
      });
    }
    return jid;
  }
  function closeJournaledJob(jobId, now) {
    updateJob(jobId, { phase: "DONE", journal_ref: null }, now);
    trashBackup(jobId);
  }
  function deleteScans(scanIds, jobId) {
    const state = loadState();
    const checkpoint = latestCheckpoint();
    const { state: rebuilt, result } = deleteScansCore(
      state,
      scanIds,
      readPayloadForRow,
      checkpoint
    );
    if (!result.deleted) return result;
    const jid = openJournaledJob(jobId, state, JSON.stringify({ deleteScans: scanIds.length }));
    writeStateTables(rebuilt);
    closeJournaledJob(jid);
    bumpWizDataVersion();
    const survivors = new Set(rebuilt.scans.map(archiveIdOf));
    for (const r of state.scans) {
      const id = archiveIdOf(r);
      if (!survivors.has(id)) trashScan(id);
    }
    return result;
  }
  function resetLedger() {
    const counts = {
      scans: loadScanRows().length,
      findings: dataRowCount(TABS.ledger),
      episodes: dataRowCount(TABS.episodes),
      repos: dataRowCount(TABS.repos),
      compactions: readAll(TABS.compactions).length
    };
    overwrite(TABS.scans, []);
    overwrite(TABS.ledger, []);
    overwrite(TABS.episodes, []);
    overwrite(TABS.repos, []);
    overwrite(TABS.compactions, []);
    overwrite(TABS.jobs, []);
    writeLedgerSnapshot(emptyState());
    invalidateLedgerMemos();
    return counts;
  }
  function previewMaintenance(retentionDays, now) {
    const state = loadState();
    const nowMs = now != null ? now : Date.now();
    const plan = compactLedgerCore(state, retentionDays, latestCheckpoint(), readPayloadForRow, {
      dryRun: true,
      now: nowMs,
      compactionId: compactionIdFor(nowMs)
    });
    return {
      compaction: plan.result,
      scans: state.scans.length,
      findings: Object.keys(state.ledger).length,
      episodes: state.episodes.length
    };
  }
  function compactionIdFor(nowMs) {
    return `cmp-${nowIso(nowMs).replace(/[:]/g, "")}`;
  }
  function compactLedger(retentionDays, dryRun = false, now) {
    const state = loadState();
    const prevCheckpoint = latestCheckpoint();
    const nowMs = now != null ? now : Date.now();
    const compactionId = compactionIdFor(nowMs);
    const probe = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
      dryRun: true,
      now: nowMs,
      compactionId
    });
    if (probe.result.no_op) return probe.result;
    const obsCountByScan = {};
    let archiveBytes = 0;
    for (const r of probe.newly) {
      obsCountByScan[r.scan_id] = readObservations(archiveIdOf(r)).length;
      archiveBytes += scanFolderBytes(archiveIdOf(r));
    }
    const plan = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
      dryRun,
      now: nowMs,
      compactionId,
      obsCountByScan,
      archiveBytes
    });
    if (dryRun || plan.state === null) return plan.result;
    const jobId = openJournaledJob(void 0, state, JSON.stringify({ retentionDays }));
    const ref = checkpointName(compactionId);
    writeGzJson(subfolder("checkpoints"), ref, plan.checkpoint);
    const compactions = readAll(TABS.compactions).map((r) => ({
      ...r,
      checkpoint_ref: null
    }));
    compactions.push(compactionRow(plan, ref, nowMs));
    overwrite(TABS.compactions, compactions);
    writeStateTables(plan.state);
    closeJournaledJob(jobId, nowMs);
    let freed = 0;
    for (const r of plan.newly) {
      const id = archiveIdOf(r);
      freed += scanFolderBytes(id);
      trashScan(id);
    }
    plan.result.archive_bytes_freed = freed;
    return plan.result;
  }
  function scanFolderBytes(scanId) {
    let total = 0;
    try {
      const files = scanFolder(scanId).getFiles();
      while (files.hasNext()) total += files.next().getSize();
    } catch {
      return 0;
    }
    return total;
  }

  // src/server/locks.ts
  var LedgerBusyError = class extends Error {
  };
  function withScriptLock(fn, timeoutMs = 3e4) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(timeoutMs)) {
      throw new LedgerBusyError(
        "The data store is busy (a sync is writing). Try again shortly."
      );
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }
  function recoverIfNeeded(now) {
    const job = activeJob();
    if (!job) return;
    if (job.phase === "PERSISTING") {
      if (!job.journal_ref) {
        updateJob(job.job_id, {
          phase: "FAILED",
          error: "Recovered: execution died mid-sync; the last committed snapshot is unchanged."
        });
        return;
      }
      if (syncCommitted(job.scan_id)) {
        updateJob(job.job_id, {
          phase: "FAILED",
          journal_ref: null,
          error: "Recovered: execution died after the commit landed; the scan is saved and the journal was discarded."
        });
        trashBackup(job.job_id);
        invalidateLedgerMemos();
        return;
      }
      const backup = readBackup(job.job_id);
      if (backup) {
        writeStateTables(backup);
        updateJob(job.job_id, {
          phase: "FAILED",
          journal_ref: null,
          error: "Recovered: execution died mid-rewrite; the ledger was RESTORED from the journal and the scan was not saved."
        });
        trashBackup(job.job_id);
        return;
      }
      updateJob(job.job_id, {
        phase: "FAILED",
        journal_ref: null,
        error: "Recovered: execution died mid-rewrite and the journal could not be read, so the ledger was left as written. Re-run the sync to reconcile it."
      });
      return;
    }
    if (isStaleJob(job, now)) {
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Recovered: execution died mid-sync; the last committed snapshot is unchanged."
      });
    }
  }

  // src/server/readModels.ts
  var readModels_exports = {};
  __export(readModels_exports, {
    WARM_BUDGET_MS: () => WARM_BUDGET_MS,
    __resetModelMemosForTest: () => __resetModelMemosForTest,
    executiveModel: () => executiveModel,
    historyModel: () => historyModel,
    mttrModel: () => mttrModel,
    programModel: () => programModel,
    registerModel: () => registerModel,
    registerRowsModel: () => registerRowsModel,
    reposModel: () => reposModel,
    secretsModel: () => secretsModel,
    signalCoverage: () => signalCoverage,
    storageModel: () => storageModel,
    warmReadModels: () => warmReadModels
  });

  // src/domain/assets.ts
  var DAY_MS7 = 864e5;
  var DAYS_PER_MONTH = 30.4375;
  function isOpen4(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function safePct(numerator, denominator) {
    if (numerator === null || denominator === null) return null;
    return denominator > 0 ? numerator / denominator * 100 : null;
  }
  function verdictOf2(netPct) {
    if (Math.abs(netPct) <= NET_CAPACITY_BAND_PCT) return "keeping-up";
    return netPct > 0 ? "gaining" : "falling-behind";
  }
  function blank(v) {
    return v === null || v === void 0 || String(v).trim() === "";
  }
  function assetGroupOf(value) {
    return blank(value) ? ASSET_GROUP_UNKNOWN : String(value);
  }
  function perAsset(rows, windowStart, groupBy) {
    const byKey = /* @__PURE__ */ new Map();
    for (const { row, risk } of rows) {
      const assetId = String(row.repo_id).trim();
      const group = groupBy === "repo" ? assetId : assetGroupOf(row.language);
      const key = assetId + "\0" + group;
      let a = byKey.get(key);
      if (!a) {
        a = {
          assetId,
          group,
          label: null,
          density: 0,
          hasFoothold: false,
          tp: 0,
          fn: 0,
          opened: windowStart === null ? null : 0,
          closed: windowStart === null ? null : 0,
          openAtStart: windowStart === null ? null : 0,
          coveragePct: null,
          netPct: null,
          verdict: null
        };
        byKey.set(key, a);
      }
      if (a.label === null && !blank(row.repo_name)) a.label = String(row.repo_name);
      const open = isOpen4(row.status);
      const high = risk === "high";
      if (open) a.density += 1;
      if (high && open) {
        a.hasFoothold = true;
        a.fn += 1;
      }
      if (high && !open) a.tp += 1;
      if (windowStart !== null) {
        const firstMs = parseTs(row.first_seen);
        const resolvedMs = parseTs(row.resolved_at);
        if (firstMs !== null && firstMs >= windowStart) a.opened += 1;
        if (resolvedMs !== null && resolvedMs >= windowStart) a.closed += 1;
        if (firstMs !== null && firstMs < windowStart && (resolvedMs === null || resolvedMs >= windowStart)) {
          a.openAtStart += 1;
        }
      }
    }
    for (const a of byKey.values()) {
      a.coveragePct = safePct(a.tp, a.tp + a.fn);
      a.netPct = a.closed === null || a.opened === null ? null : safePct(a.closed - a.opened, a.openAtStart);
      a.verdict = a.netPct === null ? null : verdictOf2(a.netPct);
    }
    return [...byKey.values()];
  }
  function aggregate(group, label, assets, windowMonths, population, km) {
    const densities = assets.map((a) => a.density);
    const coverages = [];
    for (const a of assets) if (a.coveragePct !== null) coverages.push(a.coveragePct);
    const mmcr = [];
    if (windowMonths !== null) {
      for (const a of assets) {
        const rate = safePct(a.closed, a.openAtStart);
        if (rate !== null) mmcr.push(rate / windowMonths);
      }
    }
    let footholds = 0;
    let flowing = 0;
    let fallingBehind = 0;
    let maintaining = 0;
    let gaining = 0;
    for (const a of assets) {
      if (a.hasFoothold) footholds += 1;
      if (a.verdict === null) continue;
      flowing += 1;
      if (a.verdict === "falling-behind") fallingBehind += 1;
      else if (a.verdict === "keeping-up") maintaining += 1;
      else gaining += 1;
    }
    return {
      asset_group: group,
      assets: assets.length,
      open_findings: densities.reduce((s2, d) => s2 + d, 0),
      density_p25: quantile(densities, 0.25),
      density_p50: quantile(densities, 0.5),
      density_p75: quantile(densities, 0.75),
      assets_with_high_risk_pct: safePct(footholds, assets.length),
      assets_with_high_risk: coverages.length,
      asset_coverage_p50: quantile(coverages, 0.5),
      km_median_days: km.median,
      km_median_lower_bound: km.medianLowerBound,
      mmcr_p50: quantile(mmcr, 0.5),
      falling_behind_pct: safePct(fallingBehind, flowing),
      maintaining_pct: safePct(maintaining, flowing),
      gaining_pct: safePct(gaining, flowing),
      assets_flowing: flowing,
      window_months: windowMonths,
      population,
      asset_label: label
    };
  }
  function halfLife(group, rows) {
    const projection = rows.map((r) => ({
      severity: group,
      status: r.status,
      mttr_days: r.mttr_days,
      age_days: r.age_days
    }));
    const km = kaplanMeier(projection);
    return { median: km.median, medianLowerBound: km.medianLowerBound };
  }
  function assetProfile(rows, opts) {
    var _a, _b, _c, _d;
    const groupBy = (_a = opts.groupBy) != null ? _a : "language";
    const highRiskOnly = opts.highRiskOnly === true;
    const population = highRiskOnly ? POPULATION_HIGH_RISK : POPULATION_ALL;
    const nowMs = parseTs(opts.now);
    if (nowMs === null) {
      throw new Error(`assetProfile: unparseable now (${JSON.stringify(opts.now)})`);
    }
    const observedFrom = (_b = opts.observedFrom) != null ? _b : null;
    const windowStart = observedFrom === null ? null : parseTs(observedFrom);
    if (observedFrom !== null && windowStart === null) {
      throw new Error(`assetProfile: unparseable observedFrom (${JSON.stringify(observedFrom)})`);
    }
    const windowMonths = windowStart === null ? null : Math.max((nowMs - windowStart) / (DAY_MS7 * DAYS_PER_MONTH), 1);
    let unclassifiedSecrets = 0;
    const classified = [];
    for (const row of rows) {
      if (row.scope === "secrets") {
        unclassifiedSecrets += 1;
        classified.push({ row, risk: "unknown" });
        continue;
      }
      classified.push({ row, risk: classifyRisk(row, opts.rule) });
    }
    const population_ = highRiskOnly ? classified.filter((c) => c.risk === "high") : classified;
    let droppedNoAsset = 0;
    const kept = [];
    for (const c of population_) {
      if (blank(c.row.repo_id)) {
        droppedNoAsset += 1;
        continue;
      }
      kept.push(c);
    }
    const assets = perAsset(kept, windowStart, groupBy);
    const assetsByGroup = /* @__PURE__ */ new Map();
    const labelByGroup = /* @__PURE__ */ new Map();
    for (const a of assets) {
      const list = assetsByGroup.get(a.group);
      if (list) list.push(a);
      else assetsByGroup.set(a.group, [a]);
      if (groupBy === "repo" && !labelByGroup.get(a.group)) labelByGroup.set(a.group, a.label);
    }
    const findingsByGroup = /* @__PURE__ */ new Map();
    for (const { row } of kept) {
      const g = groupBy === "repo" ? String(row.repo_id).trim() : assetGroupOf(row.language);
      const list = findingsByGroup.get(g);
      if (list) list.push(row);
      else findingsByGroup.set(g, [row]);
    }
    const allFindings = kept.map((c) => c.row);
    const out = [];
    for (const [group, list] of assetsByGroup) {
      out.push(
        aggregate(
          group,
          groupBy === "repo" ? (_c = labelByGroup.get(group)) != null ? _c : null : null,
          list,
          windowMonths,
          population,
          halfLife(group, (_d = findingsByGroup.get(group)) != null ? _d : [])
        )
      );
    }
    out.push(aggregate(OVERALL, null, assets, windowMonths, population, halfLife(OVERALL, allFindings)));
    out.sort((a, b) => {
      if (a.asset_group === OVERALL) return b.asset_group === OVERALL ? 0 : -1;
      if (b.asset_group === OVERALL) return 1;
      if (a.assets !== b.assets) return b.assets - a.assets;
      return a.asset_group < b.asset_group ? -1 : a.asset_group > b.asset_group ? 1 : 0;
    });
    return { rows: out, population, groupBy, windowMonths, droppedNoAsset, unclassifiedSecrets };
  }
  function assetProfilePopulations(rows, opts) {
    const all = assetProfile(rows, { ...opts, highRiskOnly: false });
    const highRisk = assetProfile(rows, { ...opts, highRiskOnly: true });
    return { all, highRisk, rows: all.rows.concat(highRisk.rows) };
  }

  // src/domain/secretsLifecycle.ts
  var DAY_MS8 = 864e5;
  var MEASURED_STATES = /* @__PURE__ */ new Set(["VALID", "INVALID"]);
  var SEGMENT_NONE = "(none)";
  var DEFAULT_REVOKE_SLA_DAYS = 7;
  function stateOf(row) {
    return present(row.validation_state) ? String(row.validation_state).trim().toUpperCase() : "";
  }
  function isMeasured(row) {
    return MEASURED_STATES.has(stateOf(row));
  }
  function secretsOnly(rows) {
    const kept = [];
    let ignored = 0;
    for (const row of rows) {
      if (row.scope === "secrets") kept.push(row);
      else ignored += 1;
    }
    return { rows: kept, ignoredOtherScopes: ignored };
  }
  function pct2(numerator, denominator) {
    return denominator > 0 ? numerator / denominator * 100 : null;
  }
  function validationCoverage(rows) {
    const { rows: secrets, ignoredOtherScopes } = secretsOnly(rows);
    let measured = 0;
    for (const row of secrets) if (isMeasured(row)) measured += 1;
    return {
      measured,
      unmeasured: secrets.length - measured,
      total: secrets.length,
      coveragePct: pct2(measured, secrets.length),
      ignoredOtherScopes
    };
  }
  function postDetectionValidityRate(rows) {
    const { rows: secrets } = secretsOnly(rows);
    let valid = 0;
    let invalid = 0;
    for (const row of secrets) {
      const state = stateOf(row);
      if (state === "VALID") valid += 1;
      else if (state === "INVALID") invalid += 1;
    }
    const measured = valid + invalid;
    return { valid, invalid, measured, ratePct: pct2(valid, measured) };
  }
  function timeToRevoke(rows, opts) {
    var _a;
    const { rows: secrets, ignoredOtherScopes } = secretsOnly(rows);
    const sla = (_a = opts.sla) != null ? _a : DEFAULT_REVOKE_SLA_DAYS;
    const projected = [];
    const eventDays = [];
    let excludedUnmeasured = 0;
    let excludedNoClock = 0;
    for (const row of secrets) {
      const state = stateOf(row);
      if (!MEASURED_STATES.has(state)) {
        excludedUnmeasured += 1;
        continue;
      }
      const born = parseTs(row.first_seen);
      if (born === null) {
        excludedNoClock += 1;
        continue;
      }
      const died = parseTs(row.rotated_at);
      if (died !== null) {
        const days = (died - born) / DAY_MS8;
        if (!Number.isFinite(days) || days < 0) {
          excludedNoClock += 1;
          continue;
        }
        eventDays.push(days);
        projected.push({
          severity: null,
          status: STATUS_RESOLVED,
          mttr_days: days,
          age_days: null
        });
        continue;
      }
      if (state === "INVALID") {
        excludedNoClock += 1;
        continue;
      }
      const age = (opts.now - born) / DAY_MS8;
      if (!Number.isFinite(age) || age < 0) {
        excludedNoClock += 1;
        continue;
      }
      projected.push({ severity: null, status: STATUS_OPEN, mttr_days: null, age_days: age });
    }
    const km = kaplanMeier(projected);
    let withinSla = 0;
    for (const d of eventDays) if (d <= sla) withinSla += 1;
    return {
      km,
      median: km.median,
      p90: kmQuantileFromCurve(km.curve, 0.9),
      medianLowerBound: km.medianLowerBound,
      events: km.events,
      censored: km.censored,
      excludedUnmeasured,
      excludedNoClock,
      total: secrets.length,
      withinSlaPct: pct2(withinSla, eventDays.length),
      sla,
      ignoredOtherScopes
    };
  }
  function removalVsRotation(rows) {
    const { rows: secrets } = secretsOnly(rows);
    const out = {
      removedAndRotated: 0,
      removedNotRotated: 0,
      rotatedNotRemoved: 0,
      neither: 0,
      total: secrets.length
    };
    for (const row of secrets) {
      const removed = present(row.removed_at);
      const rotated = present(row.rotated_at);
      if (removed && rotated) out.removedAndRotated += 1;
      else if (removed) out.removedNotRotated += 1;
      else if (rotated) out.rotatedNotRemoved += 1;
      else out.neither += 1;
    }
    return out;
  }
  var SEVERITY_AXIS_REFUSAL = 'bySegment: "severity" is not a valid axis for the secrets register \u2014 severity grades a detection, not whether a credential is live. Segment by validation_state, confidence or secret_kind instead.';
  function bySegment(rows, axis) {
    var _a;
    if (axis === "severity") throw new Error(SEVERITY_AXIS_REFUSAL);
    const { rows: secrets } = secretsOnly(rows);
    const buckets = /* @__PURE__ */ new Map();
    for (const row of secrets) {
      const raw = row[axis];
      const key = present(raw) ? String(raw).trim() : SEGMENT_NONE;
      let stat = buckets.get(key);
      if (!stat) {
        stat = {
          segment: key,
          total: 0,
          open: 0,
          measured: 0,
          valid: 0,
          invalid: 0,
          rotated: 0,
          removed: 0,
          removedNotRotated: 0
        };
        buckets.set(key, stat);
      }
      stat.total += 1;
      if (!RESOLVED_STATUSES.has(String((_a = row.status) != null ? _a : "").toUpperCase())) stat.open += 1;
      const state = stateOf(row);
      if (MEASURED_STATES.has(state)) stat.measured += 1;
      if (state === "VALID") stat.valid += 1;
      else if (state === "INVALID") stat.invalid += 1;
      const rotated = present(row.rotated_at);
      const removed = present(row.removed_at);
      if (rotated) stat.rotated += 1;
      if (removed) stat.removed += 1;
      if (removed && !rotated) stat.removedNotRotated += 1;
    }
    return [...buckets.values()].sort((a, b) => cmp(b.total, a.total) || cmp(a.segment, b.segment));
  }

  // src/server/historyStore.ts
  var FOLDER = "history";
  var NAME_RE = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/;
  function utcDay(now) {
    return new Date(now).toISOString().slice(0, 10);
  }
  function fileName(day) {
    return `${day}.json.gz`;
  }
  function recordDaily(stats, now = Date.now()) {
    writeGzJson(subfolder(FOLDER), fileName(utcDay(now)), stats);
  }
  function listHistory() {
    const days = listNames(FOLDER).map((n2) => {
      var _a;
      return (_a = NAME_RE.exec(n2)) == null ? void 0 : _a[1];
    }).filter((d) => Boolean(d)).sort();
    return days.map((date) => ({ date, stats: readGzJson(subfolder(FOLDER), fileName(date)) }));
  }

  // src/server/readModelStore.ts
  var FOLDER2 = "readmodels";
  var ENVELOPE_V = 1;
  var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
  var warming = false;
  var touched = null;
  function duringWarm(fn) {
    warming = true;
    touched = /* @__PURE__ */ new Set();
    try {
      return fn();
    } finally {
      warming = false;
      touched = null;
    }
  }
  var disabled = false;
  function readModelFileName(name, params) {
    return `rm-${name}-${paramsHash(params)}.json.gz`;
  }
  function l2Read(name, params, version) {
    if (disabled) return { hit: false, why: "absent" };
    try {
      const raw = readGzJsonNamed(FOLDER2, readModelFileName(name, params));
      if (!raw || typeof raw !== "object") return { hit: false, why: "absent" };
      const env = raw;
      if (env.v !== ENVELOPE_V || env.name !== name) return { hit: false, why: "stale" };
      if (env.stamp !== currentStamp(version)) return { hit: false, why: "stale" };
      if (typeof env.writtenAtMs !== "number") return { hit: false, why: "stale" };
      if (Date.now() - env.writtenAtMs > MAX_AGE_MS) return { hit: false, why: "stale" };
      return { hit: true, value: env.value };
    } catch (e) {
      disabled = true;
      console.warn(`Durable read-model read failed (${name}) \u2014 L2 disabled for this run: ${e}`);
      return { hit: false, why: "absent" };
    }
  }
  function l2Write(name, params, version, value) {
    if (disabled) return;
    try {
      const env = {
        v: ENVELOPE_V,
        stamp: currentStamp(version),
        name,
        hash: paramsHash(params),
        writtenAtMs: Date.now(),
        value
      };
      writeGzJson(subfolder(FOLDER2), readModelFileName(name, params), env);
    } catch (e) {
      disabled = true;
      console.warn(`Durable read-model write failed (${name}) \u2014 L2 disabled for this run: ${e}`);
    }
  }
  function durablyCached(name, params, compute, ttlSec, version) {
    if (warming && touched) touched.add(readModelFileName(name, params));
    return cached(name, params, () => {
      const hit = l2Read(name, params, version);
      if (hit.hit) return hit.value;
      const value = compute();
      if (warming) l2Write(name, params, version, value);
      return value;
    }, ttlSec, version);
  }
  function sweepReadModels() {
    if (disabled || !touched) return 0;
    const keep = touched;
    let trashed = 0;
    try {
      for (const name of listNames(FOLDER2)) {
        if (!keep.has(name)) {
          trashNamed(FOLDER2, name);
          trashed += 1;
        }
      }
    } catch (e) {
      console.warn(`Durable read-model sweep failed: ${e}`);
    }
    return trashed;
  }

  // src/server/readModels.ts
  var DAY_MS9 = 864e5;
  var WEEK_MS = 7 * DAY_MS9;
  var CLOCK_TTL_SEC = 3600;
  var OLDEST_TOP_N = 100;
  var WARM_BUDGET_MS = 27e4;
  function norm(p) {
    var _a, _b;
    const scopeRaw = (_a = p == null ? void 0 : p.scope) != null ? _a : null;
    const scope = scopeRaw && SCOPES.includes(scopeRaw) ? scopeRaw : null;
    const sevRaw = (_b = p == null ? void 0 : p.severities) != null ? _b : null;
    const severities = Array.isArray(sevRaw) && sevRaw.length ? sevRaw.map((s2) => normalizeSeverity(s2)).filter((s2, i, a) => a.indexOf(s2) === i).sort() : null;
    return { scope, severities, showNoFix: (p == null ? void 0 : p.showNoFix) !== false };
  }
  function keyOf(n2) {
    return { scope: n2.scope, severities: n2.severities, showNoFix: n2.showNoFix };
  }
  var baseMemo;
  function baseSnapshot() {
    const version = dataVersion();
    if (!baseMemo || baseMemo.version !== version) {
      const now = Date.now();
      baseMemo = { version, now, rows: loadBaseRows({ now }) };
    }
    return baseMemo;
  }
  function __resetModelMemosForTest() {
    baseMemo = void 0;
    clockMemo = void 0;
  }
  var clockMemo;
  function ledgerClock(scope) {
    const version = dataVersion();
    if (!clockMemo || clockMemo.version !== version) {
      clockMemo = { version, all: buildClock(null), byScope: {} };
    }
    if (scope === null) return clockMemo.all;
    const hit = clockMemo.byScope[scope];
    if (hit) return hit;
    const built = buildClock(scope);
    clockMemo.byScope[scope] = built;
    return built;
  }
  function buildClock(scope) {
    const scans = loadScanRows().filter((s2) => scope === null || s2.scope === scope);
    let newest = null;
    let earliest = null;
    let earliestIso = null;
    for (const s2 of scans) {
      const ms = parseTs(s2.ts);
      if (ms === null) continue;
      if (newest === null || ms > newest) newest = ms;
      if (earliest === null || ms < earliest) {
        earliest = ms;
        earliestIso = s2.ts;
      }
    }
    return newest === null ? { asOf: Date.now(), asOfSource: "wallClock", observedFrom: earliestIso } : { asOf: newest, asOfSource: "scan", observedFrom: earliestIso };
  }
  function isOpen5(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function scopedRows(rows, n2) {
    let out = rows;
    if (n2.scope) out = out.filter((r) => r.scope === n2.scope);
    if (n2.severities) {
      const keep = new Set(n2.severities);
      out = out.filter((r) => keep.has(normalizeSeverity(r.severity)));
    }
    return out;
  }
  function visibleRows(rows, n2) {
    const scoped = scopedRows(rows, n2);
    return n2.showNoFix ? scoped : scoped.filter((r) => !baseRowNoFix(r));
  }
  function classifiableRows(rows) {
    const kept = [];
    let excludedSecrets = 0;
    for (const r of rows) {
      if (r.scope === "secrets") excludedSecrets += 1;
      else kept.push(r);
    }
    return { rows: kept, excludedSecrets };
  }
  function atLedgerClock(rows, asOf) {
    return rows.map((r) => {
      if (!isOpen5(r.status)) return r;
      const first = parseTs(r.first_seen);
      if (first === null) return r;
      return { ...r, age_days: Math.max(0, asOf - first) / DAY_MS9 };
    });
  }
  function coverageOf2(rows, applies, measured) {
    let applicable = 0;
    let seen = 0;
    let na = 0;
    for (const r of rows) {
      if (!applies(r)) {
        na += 1;
        continue;
      }
      applicable += 1;
      if (measured(r)) seen += 1;
    }
    return {
      applicable,
      measured: seen,
      missing: applicable - seen,
      coveragePct: applicable > 0 ? seen / applicable * 100 : null,
      notApplicable: na,
      total: rows.length
    };
  }
  function signalCoverage(rows) {
    const isSca = (r) => r.scope === "sca";
    const isSast = (r) => r.scope === "sast";
    const isSecrets = (r) => r.scope === "secrets";
    return {
      has_kev: coverageOf2(rows, isSca, (r) => r.has_kev !== null),
      has_exploit: coverageOf2(rows, isSca, (r) => r.has_exploit !== null),
      epss: coverageOf2(rows, isSca, (r) => r.epss !== null),
      ai_verdict: coverageOf2(rows, isSast, (r) => r.ai_verdict !== null && String(r.ai_verdict) !== ""),
      validation_state: coverageOf2(
        rows,
        isSecrets,
        (r) => r.validation_state !== null && String(r.validation_state).trim() !== ""
      )
    };
  }
  function shipKM(km) {
    return {
      curve: km.curve.map((p) => ({ t: p.t, s: p.s })),
      median: km.median,
      medianLowerBound: km.medianLowerBound,
      p90: kmQuantileFromCurve(km.curve, 0.9),
      mean: km.mean,
      meanTruncated: km.meanTruncated,
      restrictionTime: km.restrictionTime,
      events: km.events,
      censored: km.censored,
      total: km.total
    };
  }
  function latencySummary(rows, now, scope) {
    const km = kaplanMeier(latencyView(rows, "detection", now, { scope }));
    return {
      median: km.median,
      medianLowerBound: km.medianLowerBound,
      mean: km.mean,
      meanTruncated: km.meanTruncated,
      restrictionTime: km.restrictionTime,
      events: km.events,
      censored: km.censored,
      total: km.total,
      segments: latencySegments(rows, "detection", now, { scope })
    };
  }
  function buildMttr(n2) {
    var _a;
    const snap = baseSnapshot();
    const scoped = scopedRows(snap.rows, n2);
    const rows = visibleRows(snap.rows, n2);
    const { perSev, overall } = mttrFromLedger(rows, { now: snap.now });
    const { slaPct, oldestDays } = overallSlaOldest(perSev);
    const kmMedianPerSev = {};
    const kmP90PerSev = {};
    const kmLowerBoundPerSev = {};
    {
      const bySev = {};
      for (const r of rows) {
        const s2 = normalizeSeverity(r.severity);
        ((_a = bySev[s2]) != null ? _a : bySev[s2] = []).push(r);
      }
      for (const [s2, rs] of Object.entries(bySev)) {
        const k = kaplanMeier(rs);
        kmMedianPerSev[s2] = k.median;
        kmLowerBoundPerSev[s2] = k.medianLowerBound;
        kmP90PerSev[s2] = kmQuantileFromCurve(k.curve, 0.9);
      }
    }
    const scaScoped = scoped.filter((r) => r.scope === "sca");
    const scaVisible = rows.filter((r) => r.scope === "sca");
    return {
      asOf: snap.now,
      scope: n2.scope,
      severities: n2.severities,
      showNoFix: n2.showNoFix,
      rowCount: rows.length,
      perSev,
      overall,
      slaPct,
      oldestDays,
      remediation: {
        pctiles: mttrPercentiles(rows),
        buckets: resolutionBuckets(rows),
        km: shipKM(kaplanMeier(rows)),
        kmMedianPerSev,
        kmP90PerSev,
        kmLowerBoundPerSev,
        openPastSla: openPastSla(rows),
        awaiting: awaitingVendorFix(rows),
        /**
         * The second clock, scoped and labelled. `notMeasured` is every scoped row this block
         * refused to price — sast and secrets have no vendor to wait on, so their actionable
         * clock is their detection clock and including them would inflate the sample with
         * copies of the figure above.
         */
        actionable: {
          scope: "sca",
          rowCount: scaVisible.length,
          notMeasured: rows.length - scaVisible.length,
          openPastSla: openPastSla(actionableView(scaVisible)),
          km: shipKM(kaplanMeier(actionableView(scaVisible))),
          /** How long we waited for a fix to EXIST, over the pre-toggle sca population. Pairs
           *  additively with the clock above: exposure = latency + actionable. */
          vendorLatency: latencySummary(scaScoped, snap.now, "sca")
        }
      },
      signalCoverage: signalCoverage(rows)
    };
  }
  function mttrModel(p) {
    const n2 = norm(p);
    return cached("dsMttr1", keyOf(n2), () => buildMttr(n2), CLOCK_TTL_SEC);
  }
  function buildExecutive(n2) {
    var _a;
    const snap = baseSnapshot();
    const scoped = scopedRows(snap.rows, n2);
    const rows = visibleRows(snap.rows, n2);
    const counts = {};
    let open = 0;
    for (const r of rows) {
      if (!isOpen5(r.status)) continue;
      open += 1;
      const s2 = normalizeSeverity(r.severity);
      counts[s2] = ((_a = counts[s2]) != null ? _a : 0) + 1;
    }
    const byScope3 = (n2.scope ? [n2.scope] : [...SCOPES]).map((scope) => {
      const sub = rows.filter((r) => r.scope === scope);
      const km = kaplanMeier(sub);
      return {
        group: scope,
        dimension: "scope",
        total: sub.length,
        open: sub.filter((r) => isOpen5(r.status)).length,
        resolved: sub.filter((r) => !isOpen5(r.status)).length,
        kmMedian: km.median,
        kmMedianLowerBound: km.medianLowerBound,
        awaiting: awaitingVendorFix(sub).overall
      };
    });
    return {
      asOf: snap.now,
      scope: n2.scope,
      severities: n2.severities,
      showNoFix: n2.showNoFix,
      severityCounts: { counts, open, total: rows.length },
      byScope: { dimension: "scope", rows: byScope3 },
      weekTrend: weekTrend(scoped, n2, snap.now),
      tiers: riskTierStats(scopedTierRows(rows), void 0),
      signalCoverage: signalCoverage(rows)
    };
  }
  function scopedTierRows(rows) {
    return rows;
  }
  function weekTrend(scoped, n2, now) {
    if (!scoped.length) return null;
    let earliest = Infinity;
    for (const r of scoped) {
      const f = parseTs(r.first_seen);
      if (f !== null && f < earliest) earliest = f;
    }
    const weekAgo = now - WEEK_MS;
    if (!Number.isFinite(earliest) || earliest > weekAgo) return null;
    const base = scoped;
    const opts = { hideNoFix: !n2.showNoFix, ...n2.scope ? { scope: n2.scope } : {} };
    const current = kmMedianAsOf(base, n2.severities, now, opts);
    const previous = kmMedianAsOf(base, n2.severities, weekAgo, opts);
    if (current === null || previous === null) return null;
    return {
      current,
      previous,
      deltaDays: Math.round((current - previous) * 1e3) / 1e3,
      days: 7
    };
  }
  function executiveModel(p) {
    const n2 = norm(p);
    return cached("dsExecutive1", keyOf(n2), () => buildExecutive(n2), CLOCK_TTL_SEC);
  }
  var CONCENTRATION_DIMS = {
    sca: ["repo", "language", "owner_project"],
    sast: ["repo", "cwe", "language", "owner_project"],
    secrets: ["repo", "secret_kind", "owner_project"]
  };
  function buildRegister(scope, n2) {
    const snap = baseSnapshot();
    const scoped = { ...n2, scope };
    const rows = visibleRows(snap.rows, scoped);
    const isSecrets = scope === "secrets";
    const latest = latestScanRow(scope);
    const scanCount = loadScanRows().filter((s2) => s2.scope === scope).length;
    return {
      asOf: snap.now,
      scope,
      severities: isSecrets ? null : n2.severities,
      showNoFix: n2.showNoFix,
      rowCount: rows.length,
      open: rows.filter((r) => isOpen5(r.status)).length,
      resolved: rows.filter((r) => !isOpen5(r.status)).length,
      // The severity axis, or the reason there is not one.
      severityAxis: isSecrets ? { supported: false, reason: SEVERITY_AXIS_REFUSAL } : { supported: true },
      counts: isSecrets ? null : countsOf(rows),
      sevStats: isSecrets ? null : severityStats(rows, scope),
      previousCounts: isSecrets ? null : previousSeverityCounts(scope),
      segments: isSecrets ? {
        validation_state: bySegment(rows, "validation_state"),
        confidence: bySegment(rows, "confidence"),
        secret_kind: bySegment(rows, "secret_kind")
      } : null,
      aging: ageBuckets(rows, scope),
      oldest: oldestOpen(rows, OLDEST_TOP_N, scope),
      movement: movement(rows, latest, scanCount, scope),
      // The dimensions are per scope, because `insights.GROUP_COLUMNS` maps to real ledger
      // columns and a dimension the scope never fills would rank one "(none)" bucket. Asking for
      // a name outside that table is silently DROPPED by `concentration`, so the list is spelled
      // from the table rather than from what a page might like to see.
      concentration: concentration(rows, CONCENTRATION_DIMS[scope], 5, scope),
      tiers: riskTierStats(scopedTierRows(rows), void 0, scope),
      funnel: triageFunnel(rows, void 0, /* @__PURE__ */ new Set(), false, scope),
      awaiting: awaitingVendorFix(rows, { scope }),
      latestScan: latest,
      signalCoverage: signalCoverage(rows)
    };
  }
  function countsOf(rows) {
    var _a;
    const out = {};
    for (const r of rows) {
      const s2 = normalizeSeverity(r.severity);
      out[s2] = ((_a = out[s2]) != null ? _a : 0) + 1;
    }
    return out;
  }
  function registerModel(scope, p) {
    const n2 = norm(p);
    return cached(
      "dsRegister1",
      { ...keyOf(n2), scope },
      () => buildRegister(scope, n2),
      CLOCK_TTL_SEC
    );
  }
  function normRowStatus(v) {
    const s2 = String(v != null ? v : "").toLowerCase();
    return s2 === "open" || s2 === "resolved" ? s2 : "all";
  }
  function registerRowsModel(scope, p) {
    var _a;
    const n2 = norm(p);
    const snap = baseSnapshot();
    const severityFilterSupported = scope !== "secrets";
    const severities = severityFilterSupported ? n2.severities : null;
    const scoped = visibleRows(snap.rows, { scope, severities, showNoFix: n2.showNoFix });
    const status = normRowStatus(p == null ? void 0 : p.status);
    const rows = status === "all" ? scoped : scoped.filter((r) => isOpen5(r.status) === (status === "open"));
    const def = REGISTER_ROW_DEFAULT_SORT[scope];
    const columns = registerRowColumns(scope);
    const asked = typeof (p == null ? void 0 : p.sort) === "string" ? p.sort : "";
    const sort = columns.includes(asked) ? asked : def.sort;
    const askedDir = String((_a = p == null ? void 0 : p.dir) != null ? _a : "").toLowerCase();
    const dir = askedDir === "asc" || askedDir === "desc" ? askedDir : sort === def.sort ? def.dir : "asc";
    const pageSize = clampInt(
      p == null ? void 0 : p.pageSize,
      REGISTER_ROWS_DEFAULT_PAGE_SIZE,
      1,
      REGISTER_ROWS_PAGE_SIZE_CAP
    );
    const sorted = sortRegisterRows(rows, {
      value: registerSortValue(sort),
      descending: dir === "desc",
      // The row identity, and it is unique by construction (`lifecycle.findingKey`), so the
      // arrangement is total: two requests for the same page return the same rows.
      tiebreak: (r) => r["finding_key"]
    });
    const cut = pageOfRegisterRows(sorted, clampInt(p == null ? void 0 : p.page, 0, 0, Number.MAX_SAFE_INTEGER), pageSize);
    return {
      asOf: snap.now,
      scope,
      columns: columns.slice(),
      rows: cut.rows,
      total: sorted.length,
      page: cut.page,
      pageCount: cut.pageCount,
      pageSize,
      sort,
      dir,
      status,
      severities,
      severityFilterSupported,
      showNoFix: n2.showNoFix
    };
  }
  function buildSecrets(n2) {
    const snap = baseSnapshot();
    const rows = visibleRows(snap.rows, { scope: "secrets", severities: null, showNoFix: n2.showNoFix });
    const secretRows = rows;
    return {
      asOf: snap.now,
      scope: "secrets",
      // NOT an echo of what the caller asked for. `severities` is deliberately absent from this
      // model's cache key, so ONE entry serves every selection — and a payload echoing the
      // requesting caller's list would report whichever caller happened to compute it. The
      // refusal is a property of the register, so that is all it states.
      severityAxis: { supported: false, reason: SEVERITY_AXIS_REFUSAL },
      rowCount: rows.length,
      open: rows.filter((r) => isOpen5(r.status)).length,
      coverage: validationCoverage(secretRows),
      validity: postDetectionValidityRate(secretRows),
      timeToRevoke: timeToRevoke(secretRows, { now: snap.now }),
      removalVsRotation: removalVsRotation(secretRows),
      segments: {
        validation_state: bySegment(secretRows, "validation_state"),
        confidence: bySegment(secretRows, "confidence"),
        secret_kind: bySegment(secretRows, "secret_kind")
      },
      signalCoverage: signalCoverage(rows)
    };
  }
  function secretsModel(p) {
    const n2 = norm(p);
    return cached(
      "dsSecrets1",
      { scope: "secrets", showNoFix: n2.showNoFix },
      () => buildSecrets(n2),
      CLOCK_TTL_SEC
    );
  }
  function buildProgram(n2) {
    const snap = baseSnapshot();
    const clock = ledgerClock(n2.scope);
    const visible = visibleRows(snap.rows, n2);
    const { rows, excludedSecrets } = classifiableRows(visible);
    const riskRows = rows;
    const scans = loadScanRows();
    const capacityRows = rows;
    const perScopeSensitivity = {};
    for (const scope of SCOPES) {
      if (scope === "secrets") continue;
      if (n2.scope && n2.scope !== scope) continue;
      const sub = riskRows.filter((r) => r.scope === scope);
      if (!sub.length) continue;
      const rule = ruleForScope(scope);
      perScopeSensitivity[scope] = {
        rule,
        sentence: ruleSentence(rule),
        points: ruleSensitivity(sub, rule)
      };
    }
    const { perSev, overall } = confusionBySeverity(riskRows);
    return {
      asOf: clock.asOf,
      asOfSource: clock.asOfSource,
      observedFrom: clock.observedFrom,
      scope: n2.scope,
      severities: n2.severities,
      showNoFix: n2.showNoFix,
      rowCount: rows.length,
      excludedSecrets,
      rules: {
        sca: { rule: DEFAULT_RISK_RULE, sentence: ruleSentence(DEFAULT_RISK_RULE) },
        sast: { rule: DEFAULT_SAST_RISK_RULE, sentence: ruleSentence(DEFAULT_SAST_RISK_RULE) },
        secrets: null
      },
      matrix: overall,
      perSev,
      signals: signalBreakdown(riskRows),
      sensitivity: perScopeSensitivity,
      // Whole-register capacity AND the high-risk cut. P2P v3's net remediation capacity is
      // specifically the high-risk population; the overall close rate is what the 1-in-10
      // benchmark refers to. The two routinely disagree, so both are published rather than one
      // unlabelled number.
      capacity: capacityByMonth(capacityRows, scans, {
        now: clock.asOf,
        maxMonths: 24,
        ...clock.observedFrom !== null ? { observedFrom: clock.observedFrom } : {}
      }),
      capacityHighRisk: capacityByMonth(capacityRows, scans, {
        now: clock.asOf,
        highRiskOnly: true,
        maxMonths: 24,
        closedObserved: null,
        ...clock.observedFrom !== null ? { observedFrom: clock.observedFrom } : {}
      }),
      observationDays: observationWindowDays(rows, clock.asOf),
      signalCoverage: signalCoverage(visible),
      // `pagePayload.programTrendSlice` reads exactly this key. Empty under a secrets scope —
      // coverage and efficiency are rates over a high-risk population and that scope has none,
      // so an empty series is the honest answer rather than a line of zeroes.
      trend: n2.scope === "secrets" ? [] : programTrendFor(n2, snap.rows),
      trendSupported: n2.scope !== "secrets"
    };
  }
  function programTrendFor(n2, all) {
    const { rows } = classifiableRows(scopedRows(all, n2));
    return loadProgramTrend(void 0, {
      severities: n2.severities,
      base: rows,
      ...n2.scope ? { scope: n2.scope } : {}
    });
  }
  function programModel(p) {
    const n2 = norm(p);
    return durablyCached("dsProgram1", keyOf(n2), () => buildProgram(n2));
  }
  function buildRepos(n2) {
    const snap = baseSnapshot();
    const clock = ledgerClock(n2.scope);
    const visible = visibleRows(snap.rows, n2);
    const rows = atLedgerClock(visible, clock.asOf);
    const opts = { observedFrom: clock.observedFrom, now: clock.asOf };
    return {
      asOf: clock.asOf,
      asOfSource: clock.asOfSource,
      observedFrom: clock.observedFrom,
      scope: n2.scope,
      severities: n2.severities,
      showNoFix: n2.showNoFix,
      rowCount: visible.length,
      byRepo: assetProfilePopulations(rows, { ...opts, groupBy: "repo" }),
      byLanguage: assetProfilePopulations(rows, { ...opts, groupBy: "language" }),
      signalCoverage: signalCoverage(visible)
    };
  }
  function reposModel(p) {
    const n2 = norm(p);
    return durablyCached("dsRepos1", keyOf(n2), () => buildRepos(n2));
  }
  function buildHistory(n2) {
    var _a;
    const snap = baseSnapshot();
    const clock = ledgerClock(n2.scope);
    const scansAll = loadScanRows();
    const scans = (n2.scope ? scansAll.filter((s2) => s2.scope === n2.scope) : scansAll).slice().reverse();
    const rows = visibleRows(snap.rows, n2);
    const { overall } = mttrFromLedger(rows, { now: snap.now });
    return {
      asOf: clock.asOf,
      asOfSource: clock.asOfSource,
      observedFrom: clock.observedFrom,
      scope: n2.scope,
      severities: n2.severities,
      showNoFix: n2.showNoFix,
      scans,
      perScope: perScopeScanStats(scansAll),
      kpis: {
        tracked: rows.length,
        open: rows.filter((r) => isOpen5(r.status)).length,
        resolvedAllTime: rows.filter((r) => !isOpen5(r.status)).length,
        // The KM median, NOT the naive closed-only one, and its lower bound beside it: where the
        // curve never reaches half there is no median to print and the bound is what is true.
        medianMttr: (_a = overall.mttr_median) != null ? _a : null,
        km: shipKM(kaplanMeier(rows))
      },
      // `mttrPageTrendSlice` reads both of these keys.
      history: listHistory(),
      trend: trendFor(n2, snap.rows)
    };
  }
  function trendFor(n2, all) {
    return loadTrend({
      severities: n2.severities,
      showNoFix: n2.showNoFix,
      base: scopedRows(all, n2),
      ...n2.scope ? { scope: n2.scope } : {}
    });
  }
  function perScopeScanStats(scans) {
    const out = {};
    for (const scope of SCOPES) {
      const sub = scans.filter((s2) => s2.scope === scope);
      const last = sub.length ? sub[sub.length - 1] : null;
      out[scope] = {
        scans: sub.length,
        sealed: sub.filter((s2) => s2.sealed === 1).length,
        firstScanTs: sub.length ? sub[0].ts : null,
        lastScanTs: last ? last.ts : null,
        lastTotal: last ? last.total : null
      };
    }
    return out;
  }
  function historyModel(p) {
    const n2 = norm(p);
    return durablyCached("dsHistory1", keyOf(n2), () => buildHistory(n2));
  }
  function cellsByTab() {
    const tabs = [];
    let known = 0;
    for (const tab of Object.values(TABS)) {
      try {
        const g = gridSize(tab);
        const cells = g.rows * g.cols;
        known += cells;
        tabs.push({ tab, cells });
      } catch (e) {
        tabs.push({ tab, cells: null, error: String(e) });
      }
    }
    return { tabs, known };
  }
  function buildStorage() {
    var _a;
    const snap = baseSnapshot();
    const clock = ledgerClock(null);
    const scans = loadScanRows();
    const total = cellCount();
    const usage = cellsByTab();
    const rows = snap.rows;
    const perScope = {};
    for (const scope of SCOPES) {
      perScope[scope] = {
        findings: rows.filter((r) => r.scope === scope).length,
        scans: scans.filter((s2) => s2.scope === scope).length
      };
    }
    return {
      asOf: clock.asOf,
      asOfSource: clock.asOfSource,
      cellCount: total,
      cellLimit: 1e7,
      cellsByTab: usage.tabs,
      /** The spreadsheet minus the declared tabs — sheets nothing here manages. */
      cellsOther: total - usage.known,
      ledgerRowCells: ((_a = TAB_HEADERS[TABS.ledger]) != null ? _a : []).length,
      scanCount: scans.length,
      sealedCount: scans.filter((s2) => s2.sealed === 1).length,
      oldestScanTs: scans.length ? scans[0].ts : null,
      newestScanTs: scans.length ? scans[scans.length - 1].ts : null,
      trackedFindings: rows.length,
      perScope,
      distinctSeverities: [...new Set(rows.map((r) => normalizeSeverity(r.severity)))].sort(
        (a, b) => SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b)
      ),
      unknownSeverityCount: rows.filter((r) => normalizeSeverity(r.severity) === "UNKNOWN").length
    };
  }
  function storageModel() {
    return durablyCached("dsStorage1", null, () => buildStorage());
  }
  function warmTargets() {
    const all = { scope: null, severities: null, showNoFix: true };
    const targets = [
      // The durable four first: they are what the Drive layer exists for, and a budget cut-out
      // that never reached them would leave the expensive answers cold overnight.
      { label: "history", run: () => historyModel(all) },
      { label: "program", run: () => programModel(all) },
      { label: "repos", run: () => reposModel(all) },
      { label: "storage", run: () => storageModel() },
      { label: "executive", run: () => executiveModel(all) },
      { label: "mttr", run: () => mttrModel(all) },
      { label: "secrets", run: () => secretsModel(all) }
    ];
    for (const scope of SCOPES) {
      targets.push({ label: `register:${scope}`, run: () => registerModel(scope, all) });
    }
    return targets;
  }
  function warmReadModels(budgetMs = WARM_BUDGET_MS) {
    const job = activeJob();
    if (job) {
      const reason = `${job.kind} job ${job.job_id} is ${job.phase}`;
      console.log(`Read-model warm: skipped, ${reason}`);
      return { warmed: 0, skipped: 0, swept: 0, blockedBy: reason, elapsedMs: 0 };
    }
    return duringWarm(() => warmInner(budgetMs));
  }
  function warmInner(budgetMs) {
    const t0 = Date.now();
    let warmed = 0;
    let skipped = 0;
    for (const target of warmTargets()) {
      if (Date.now() - t0 >= budgetMs) {
        skipped += 1;
        continue;
      }
      try {
        target.run();
        warmed += 1;
      } catch (e) {
        console.warn(`Read-model warm (${target.label}) failed: ${e}`);
      }
    }
    if (skipped) {
      console.warn(`Read-model warm: out of budget after ${warmed} entries, ${skipped} left cold`);
    }
    const swept = skipped ? 0 : sweepReadModels();
    return { warmed, skipped, swept, blockedBy: null, elapsedMs: Date.now() - t0 };
  }

  // src/server/scanJobs.ts
  var scanJobs_exports = {};
  __export(scanJobs_exports, {
    DENIED_KEY: () => DENIED_KEY,
    SLIM_FIELDS: () => SLIM_FIELDS,
    SLIM_LISTS: () => SLIM_LISTS,
    SLIM_NESTED: () => SLIM_NESTED,
    cancelSync: () => cancelSync,
    clearContinuationTriggers: () => clearContinuationTriggers,
    continueJob: () => continueJob,
    dailySync: () => dailySync,
    jobStatus: () => jobStatus,
    resetStuckJob: () => resetStuckJob,
    slimRecord: () => slimRecord,
    startSync: () => startSync,
    watchdogSync: () => watchdogSync
  });

  // src/server/wizQueries.ts
  var PAGE_SIZE = 500;
  var PAGE_SIZE_FALLBACK = 250;
  var MAX_PAGES = 1e3;
  var Q_SAST = `query DevSecOpsSastFindings(
  $filterBy: SASTFindingFilters
  $first: Int
  $after: String
) {
  sastFindings(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      name
      status
      severity
      originalSeverity
      filePath
      startLine
      codeLibraryLanguage
      origin
      resolutionReason
      createdAt
      updatedAt
      firstDetectedAtSource
      resource { id name type }
      weaknesses { id name }
      projects { id name isFolder slug }
      vcsDetails { commitHash }
      aiAnalysis { verdict }
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;
  var Q_SCA = `query DevSecOpsVulnerabilityFindings(
  $filterBy: VulnerabilityFindingFilters
  $first: Int
  $after: String
) {
  vulnerabilityFindings(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      name
      detailedName
      severity
      status
      firstDetectedAt
      lastDetectedAt
      resolvedAt
      fixDate
      fixedVersion
      hasExploit
      hasCisaKevExploit
      epssProbability
      vulnerableAsset {
        ... on VulnerableAssetBase {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
        }
        ... on VulnerableAssetRepositoryBranch {
          id
          type
          name
          cloudPlatform
        }
      }
      artifactType { codeLibraryLanguage }
      projects { id name isFolder slug }
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;
  var Q_SECRETS = `query DevSecOpsSecretInstances(
  $filterBy: SecretInstanceFilters
  $first: Int
  $after: String
) {
  secretInstances(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      externalId
      secretDataId
      name
      type
      confidence
      severity
      path
      lineNumber
      status
      resolvedAt
      validationStatus
      lastValidatedAt
      firstSeenAt
      lastSeenAt
      lastUpdatedAt
      codeToCloudPipelineStage
      vcsDetails { initialCommitHash }
      resource { id name type externalId nativeType cloudPlatform }
      projects { id name isFolder slug }
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;
  var QUERIES = {
    sast: Q_SAST,
    sca: Q_SCA,
    secrets: Q_SECRETS
  };
  var API_SEVERITY = {
    CRITICAL: "CRITICAL",
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    LOW: "LOW",
    INFO: "INFORMATIONAL"
  };
  var BASE = {
    sca: {
      status: ["OPEN", "RESOLVED"],
      hasFix: true,
      codeToCloudPipelineStage: ["CODE"],
      isDefaultBranch: { equals: true }
    },
    sast: {
      // Deliberately NOT status: ["OPEN","RESOLVED"]. See SAST_FETCH_RESOLVED below.
      resource: { isDefaultBranch: { equals: true } }
    },
    secrets: {
      // THE NARROWING IS THE MEASUREMENT, not tidiness. Unscoped, this register is 394,927
      // rows and most of them are cloud/runtime rather than code; CODE narrows it to 1,933.
      //
      // It also decides whether the secrets clock is trustworthy at all. Sampled across every
      // stage, secrets close 0.25s-63s after first being seen — the born-and-closed-in-the-
      // same-instant artifact that keeps SAST_FETCH_RESOLVED off. Scoped to CODE, NOT ONE of
      // the 72 resolved rows closes inside a day: median 5.15d, p90 56.1d, max 300d. The
      // artifact is a cloud-stage phenomenon. PROBE_FINDINGS.md §3.
      codeToCloudPipelineStage: ["CODE"],
      status: ["OPEN", "RESOLVED"]
    }
  };
  function shapeBase(scope, base) {
    const out = {};
    for (const [key, value] of Object.entries(base)) {
      out[key] = Array.isArray(value) ? listFilter(scope, key, value) : value;
    }
    return out;
  }
  var SAST_FETCH_RESOLVED = false;
  var OBJECT_FILTERS = {
    // VulnerabilityFindingFilters takes every LIST bare — severity, status,
    // codeToCloudPipelineStage — and wraps only the project restriction.
    //   projectIdV2  VulnerabilityFindingProjectFilter  { equals: [...] }
    sca: ["projectIdV2"],
    sast: ["severity", "status"],
    // SecretInstanceFilters MIXES BOTH CONVENTIONS INTERNALLY, which is the §4 trap at finer
    // grain. One field's shape says nothing about the next one's, IN THE SAME TYPE:
    //   status                    SecretInstanceStatusFilter                    { equals: [...] }
    //   validationStatus          SecretInstanceValidationStatusFilter          { equals: [...] }
    //   severity                  SecretInstanceSeverityFilter                  { equals: [...] }
    //   codeToCloudPipelineStage  SecretInstanceCodeToCloudPipelineStageFilter  { equals: [...] }
    //   projectId                 [String!]                                     a bare list
    //
    // codeToCloudPipelineStage was the one key here ever sent on INFERENCE rather than on
    // reading — shaped after SCA, which spells the same field name
    // [VulnerabilityCodeToCloudPipelineStage!], a bare list. The inference did not hold, and
    // the register fetched zero rows until it was corrected. Schema print and live response
    // agree; with only this key fixed the query returns 691 rows (PROBE_FINDINGS.md §8.1).
    //
    // THAT IS THE THIRD TIME one field name has carried two kinds across filter types in this
    // codebase — after `severity` in §4 and the commitHash / initialCommitHash split in §7.3.
    // Copy these from `--schema`, which prints a ready-made OBJECT_FILTERS entry per type.
    // Never carry one across.
    secrets: ["severity", "status", "validationStatus", "codeToCloudPipelineStage"]
  };
  function listFilter(scope, key, values) {
    return OBJECT_FILTERS[scope].includes(key) ? { equals: [...values] } : [...values];
  }
  function severityFilter(severities) {
    const out = [];
    for (const s2 of severities) {
      const api = API_SEVERITY[String(s2).trim().toUpperCase()];
      if (api && !out.includes(api)) out.push(api);
    }
    return out;
  }
  function buildFilter(scope, opts = {}) {
    var _a, _b;
    if (QUERIES[scope] == null) {
      throw new Error(`no query document for scope "${scope}" \u2014 see wizQueries.ts`);
    }
    const filterBy = shapeBase(scope, JSON.parse(JSON.stringify((_a = BASE[scope]) != null ? _a : {})));
    if (scope === "sast" && SAST_FETCH_RESOLVED) {
      filterBy.status = listFilter(scope, "status", ["OPEN", "RESOLVED"]);
    }
    const sev2 = severityFilter((_b = opts.severities) != null ? _b : []);
    if (sev2.length) filterBy.severity = listFilter(scope, "severity", sev2);
    if (opts.projectId) {
      const key = scope === "sca" ? "projectIdV2" : "projectId";
      filterBy[key] = listFilter(scope, key, [opts.projectId]);
    }
    return filterBy;
  }
  function buildVariables(scope, opts = {}) {
    var _a, _b;
    return {
      filterBy: buildFilter(scope, opts),
      first: (_a = opts.first) != null ? _a : PAGE_SIZE,
      after: (_b = opts.after) != null ? _b : null
    };
  }

  // src/server/wizClient.ts
  var WizQueryError = class extends Error {
  };
  var TOKEN_CACHE_KEY = "wiz_devsecops_token";
  function staticToken() {
    const raw = getProp(PROP_KEYS.wizApiToken);
    return raw && raw.trim() ? raw.trim() : null;
  }
  function getToken(forceRefresh = false) {
    var _a, _b;
    const token = staticToken();
    if (token) return token;
    const cache = CacheService.getScriptCache();
    if (forceRefresh) {
      try {
        cache.remove(TOKEN_CACHE_KEY);
      } catch {
      }
    } else {
      const cached2 = cache.get(TOKEN_CACHE_KEY);
      if (cached2) return cached2;
    }
    const authUrl = (_a = getProp(PROP_KEYS.wizAuthUrl)) != null ? _a : DEFAULT_WIZ_AUTH_URL;
    const response = UrlFetchApp.fetch(authUrl, {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload: {
        grant_type: "client_credentials",
        audience: "wiz-api",
        client_id: requireProp(PROP_KEYS.wizClientId),
        client_secret: requireProp(PROP_KEYS.wizClientSecret)
      },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new WizQueryError(
        `Wiz token request failed (${response.getResponseCode()}): ` + errorDigest(response.getContentText())
      );
    }
    const body = JSON.parse(response.getContentText());
    const issued = body["access_token"];
    if (typeof issued !== "string" || !issued) {
      throw new WizQueryError("Wiz token response carried no access_token.");
    }
    const expiresIn = Number((_b = body["expires_in"]) != null ? _b : 3600);
    const ttl = Math.max(60, Math.min(Math.trunc(expiresIn) - 300, 21600));
    cache.put(TOKEN_CACHE_KEY, issued, ttl);
    return issued;
  }
  var ERROR_BODY_MAX = 800;
  function redact(text) {
    return String(text).replace(
      /(access_token|refresh_token|id_token|client_secret)("|')?\s*[:=]\s*("|')?[^"',}\s&]+("|')?/gi,
      "$1=<redacted>"
    ).replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "Bearer <redacted>");
  }
  function errorDigest(text) {
    try {
      const parsed = JSON.parse(text);
      const errors = parsed["errors"];
      if (Array.isArray(errors) && errors.length) {
        const parts = errors.map((e) => {
          var _a, _b;
          if (!e || typeof e !== "object") return "";
          const rec = e;
          const ext = rec["extensions"];
          const code = ext && typeof ext === "object" ? String((_a = ext["code"]) != null ? _a : "") : "";
          const message = String((_b = rec["message"]) != null ? _b : "");
          if (code && message) return `${code}: ${message}`;
          return code || message;
        }).filter(Boolean);
        if (parts.length) return redact(parts.join(" | ")).slice(0, ERROR_BODY_MAX);
      }
    } catch {
    }
    return redact(String(text)).slice(0, ERROR_BODY_MAX);
  }
  function errorMessages(errors) {
    if (!Array.isArray(errors)) return [];
    return errors.map((e) => {
      var _a;
      return e && typeof e === "object" ? String((_a = e["message"]) != null ? _a : "") : String(e);
    }).filter(Boolean).map((m) => redact(m));
  }
  function resolveConnection(data) {
    const source = data != null ? data : {};
    const keys = Object.keys(source);
    const root = keys.find((k) => {
      const v = source[k];
      return v !== null && typeof v === "object" && ("nodes" in v || "pageInfo" in v);
    });
    if (root === void 0) return { ok: false, keys };
    return { ok: true, root, conn: source[root] };
  }
  var MAX_ATTEMPTS = 4;
  function queryPage(query, variables) {
    var _a, _b, _c;
    const apiUrl = requireProp(PROP_KEYS.wizApiUrl);
    let token = getToken();
    let refreshed = false;
    let lastError = "";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = UrlFetchApp.fetch(apiUrl, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${token}` },
        payload: JSON.stringify({ query, variables }),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code === 401 && !refreshed && !staticToken()) {
        refreshed = true;
        token = getToken(true);
        continue;
      }
      if (code === 429 || code >= 500) {
        lastError = `HTTP ${code}`;
        if (attempt + 1 < MAX_ATTEMPTS) Utilities.sleep(1e3 * Math.pow(2, attempt));
        continue;
      }
      if (code !== 200) {
        const hint = code !== 401 ? "" : staticToken() ? " \u2014 WIZ_API_TOKEN was rejected; it may have expired. Refresh it, or set WIZ_CLIENT_ID/WIZ_CLIENT_SECRET for auto-refresh." : " \u2014 a freshly issued OAuth token was rejected; check WIZ_CLIENT_ID / WIZ_CLIENT_SECRET and the API scopes granted to that service account.";
        throw new WizQueryError(
          `Wiz query failed (HTTP ${code})${hint}: ${errorDigest(response.getContentText())}`
        );
      }
      const text = response.getContentText();
      const body = JSON.parse(text);
      const data = body["data"];
      if (!data) {
        throw new WizQueryError(`Wiz response carried no data: ${errorDigest(text)}`);
      }
      const found = resolveConnection(data);
      if (!found.ok) {
        throw new WizQueryError(
          `Wiz response carried no connection; root keys: [${found.keys.join(", ")}]. A response that parses but carries no nodes/pageInfo is a defect, not an empty register.`
        );
      }
      const conn = found.conn;
      const pageInfo = (_a = conn["pageInfo"]) != null ? _a : {};
      const rawTotal = conn["totalCount"];
      return {
        nodes: (_b = conn["nodes"]) != null ? _b : [],
        pageInfo: {
          hasNextPage: Boolean(pageInfo["hasNextPage"]),
          endCursor: (_c = pageInfo["endCursor"]) != null ? _c : null
        },
        totalCount: typeof rawTotal === "number" ? rawTotal : null,
        // PARTIAL: data AND errors. The nodes are returned; the errors travel with them.
        partialErrors: errorMessages(body["errors"])
      };
    }
    throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
  }
  function smallerPageCouldHelp(e) {
    if (!(e instanceof WizQueryError)) return true;
    const m = e.message;
    if (/HTTP 429/.test(m)) return false;
    if (/HTTP 4\d\d/.test(m)) return false;
    if (/internal error has occurred/i.test(m)) return true;
    if (/carried no data/.test(m)) return false;
    if (/carried no connection/.test(m)) return false;
    return true;
  }
  function newScanPaging(pageSize = PAGE_SIZE) {
    return { pageSize, pageNumber: 0 };
  }
  function fetchPage(scope, variables, paging = newScanPaging()) {
    const query = QUERIES[scope];
    if (query == null) {
      throw new WizQueryError(`no query document for scope "${scope}" \u2014 see wizQueries.ts`);
    }
    if (paging.pageNumber >= MAX_PAGES) {
      throw new WizQueryError(
        `Wiz ${scope} walk reached MAX_PAGES (${MAX_PAGES}) at ${paging.pageSize} rows a page and the cursor still reports more. Refusing to truncate silently \u2014 a partial register that looks complete is worse than a failed scan.`
      );
    }
    const send = (first) => queryPage(query, { ...variables, first });
    const probing = paging.pageNumber === 0 && paging.pageSize > PAGE_SIZE_FALLBACK;
    try {
      const page = send(paging.pageSize);
      paging.pageNumber += 1;
      return page;
    } catch (e) {
      if (!probing || !smallerPageCouldHelp(e)) throw e;
      const page = send(PAGE_SIZE_FALLBACK);
      paging.pageSize = PAGE_SIZE_FALLBACK;
      paging.pageNumber += 1;
      return page;
    }
  }

  // src/server/scanJobs.ts
  var BUDGET_MS = 27e4;
  var FIRST_STEP_BUDGET_MS = 45e3;
  var CONTINUE_DELAY_MS = 3e4;
  var CONTINUE_RETRY_MS = 9e4;
  var CONTINUE_HANDLER = CONTINUE_HANDLERS.sync;
  var WATCHDOG_HANDLER = WATCHDOG_HANDLERS.sync;
  var SYNC_KIND = "sync";
  var FORCE_STOP_LOCK_MS = 1e4;
  var MAX_PARTIAL_ERRORS = 10;
  var SyncCancelled = class extends Error {
  };
  var cancelKey = (jobId) => `CANCEL_${jobId}`;
  function isCancelRequested(jobId) {
    return Boolean(getProp(cancelKey(jobId)));
  }
  function clearCancel(jobId) {
    deleteProp(cancelKey(jobId));
  }
  function emptyProgress() {
    return { pages: 0, rows: 0, rawRef: null, totalCount: 0, partialPages: 0, partialErrors: [] };
  }
  function parseParams(job) {
    var _a, _b, _c, _d, _e, _f;
    let raw = {};
    try {
      const parsed = JSON.parse((_a = job.params_json) != null ? _a : "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
    } catch {
    }
    const syncId = String((_c = (_b = raw["syncId"]) != null ? _b : job.scan_id) != null ? _c : "");
    if (!syncId) {
      throw new Error(`Sync job ${job.job_id} carries no syncId \u2014 it cannot be resumed.`);
    }
    const scopes = (Array.isArray(raw["scopes"]) ? raw["scopes"] : []).map((s2) => String(s2)).filter((s2) => SCOPES.includes(s2));
    const severities = (_d = raw["severitiesByScope"]) != null ? _d : {};
    const stored = (_e = raw["perScope"]) != null ? _e : {};
    const params = {
      syncId,
      scopes: scopes.length ? scopes : [...SCOPES],
      scopeIndex: Number((_f = raw["scopeIndex"]) != null ? _f : 0) || 0,
      severitiesByScope: {},
      perScope: {}
    };
    for (const scope of params.scopes) {
      const sev2 = severities[scope];
      params.severitiesByScope[scope] = Array.isArray(sev2) ? sev2.map((s2) => String(s2)) : [];
      const p = stored[scope];
      params.perScope[scope] = p && typeof p === "object" && !Array.isArray(p) ? { ...emptyProgress(), ...p } : emptyProgress();
    }
    return params;
  }
  function progressFor(params, scope) {
    const existing = params.perScope[scope];
    if (existing) return existing;
    const fresh = emptyProgress();
    params.perScope[scope] = fresh;
    return fresh;
  }
  var SLIM_FIELDS = {
    sca: [
      "id",
      "name",
      "detailedName",
      "severity",
      "status",
      "firstDetectedAt",
      "lastDetectedAt",
      "resolvedAt",
      "fixDate",
      "fixedVersion",
      "hasExploit",
      "hasCisaKevExploit",
      "epssProbability"
    ],
    sast: [
      "id",
      "name",
      "status",
      "severity",
      "originalSeverity",
      "filePath",
      "startLine",
      "codeLibraryLanguage",
      "origin",
      "resolutionReason",
      "createdAt",
      "updatedAt",
      "firstDetectedAtSource"
    ],
    secrets: [
      "id",
      "externalId",
      "secretDataId",
      "name",
      "type",
      "confidence",
      "severity",
      "path",
      "lineNumber",
      "status",
      "resolvedAt",
      "validationStatus",
      "lastValidatedAt",
      "firstSeenAt",
      "lastSeenAt",
      "lastUpdatedAt",
      "codeToCloudPipelineStage"
    ]
  };
  var SLIM_NESTED = {
    sca: {
      // `tags` is kept whole: reconcile's tagsJson reads the dict, and Q_SCA does not select
      // it today — so this is the seat, empty, rather than a mapping that has to be added
      // later in two places at once.
      vulnerableAsset: [
        "id",
        "name",
        "type",
        "cloudPlatform",
        "subscriptionName",
        "subscriptionExternalId",
        "tags"
      ],
      artifactType: ["codeLibraryLanguage"]
    },
    sast: {
      resource: ["id", "name", "type"],
      vcsDetails: ["commitHash"],
      aiAnalysis: ["verdict"]
    },
    secrets: {
      resource: ["id", "name", "type", "externalId", "nativeType", "cloudPlatform"],
      // `initialCommitHash`, NOT `commitHash` — SecretInstanceVcsDetails has no `commitHash`
      // (wizQueries.ts trap 1). Copying SAST's spelling here would silently drop the column.
      vcsDetails: ["initialCommitHash"]
    }
  };
  var SLIM_LISTS = {
    // `projects` is listed for all three scopes even though Q_SCA does not select it: it is
    // this register's only ownership dimension, and the day the SCA document gains it the
    // projection must not be the thing that swallows it.
    sca: { projects: ["id", "name", "isFolder", "slug"] },
    sast: { projects: ["id", "name", "isFolder", "slug"], weaknesses: ["id", "name"] },
    secrets: { projects: ["id", "name", "isFolder", "slug"] }
  };
  var DENIED_KEY = /snippet|validationDetails/i;
  function stripDenied(value) {
    if (Array.isArray(value)) return value.map(stripDenied);
    if (value !== null && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (DENIED_KEY.test(k)) continue;
        out[k] = stripDenied(v);
      }
      return out;
    }
    return value;
  }
  function project(src, keys) {
    const out = {};
    for (const k of keys) {
      if (k in src) out[k] = src[k];
    }
    return out;
  }
  function slimRecord(scope, node) {
    const out = project(node, SLIM_FIELDS[scope]);
    for (const [key, keys] of Object.entries(SLIM_NESTED[scope])) {
      const v = node[key];
      if (v !== null && typeof v === "object" && !Array.isArray(v)) out[key] = project(v, keys);
    }
    for (const [key, keys] of Object.entries(SLIM_LISTS[scope])) {
      const v = node[key];
      if (!Array.isArray(v)) continue;
      out[key] = v.map(
        (e) => e !== null && typeof e === "object" && !Array.isArray(e) ? project(e, keys) : e
      );
    }
    return stripDenied(out);
  }
  var CONNECTION_ROOT = {
    sca: "vulnerabilityFindings",
    sast: "sastFindings",
    secrets: "secretInstances"
  };
  function envelope(scope, nodes) {
    return { data: { [CONNECTION_ROOT[scope]]: { nodes } } };
  }
  function startSync(options = {}) {
    return withScriptLock(() => {
      var _a, _b, _c;
      recoverIfNeeded();
      const active = activeJob();
      if (active && !reclaimStaleJob(active)) {
        return { jobId: active.job_id, message: "A sync is already in progress." };
      }
      if (!hasWizCredentials()) {
        return {
          jobId: null,
          message: "No Wiz credentials are configured \u2014 run setup() before syncing."
        };
      }
      const settings = loadSettings();
      const scopes = [...(_a = options.scopes) != null ? _a : settings.scopes].filter(
        (s2) => SCOPES.includes(s2)
      );
      if (!scopes.length) {
        return { jobId: null, message: "No registers are selected \u2014 choose one in Settings." };
      }
      const syncId = nowIso();
      const params = {
        syncId,
        scopes,
        scopeIndex: 0,
        severitiesByScope: {},
        perScope: {}
      };
      for (const scope of scopes) {
        params.severitiesByScope[scope] = [...(_b = settings.fetchSeverities[scope]) != null ? _b : []];
        params.perScope[scope] = emptyProgress();
      }
      const job = createJob({
        job_id: newJobId(SYNC_KIND),
        kind: SYNC_KIND,
        phase: "FETCHING",
        // THE BARE syncId. The composite `<syncId>-<scope>` is the DRIVE address only —
        // ledgerStore.scanIdFor's comment has the measurement that settled it.
        scan_id: syncId,
        scope: (_c = scopes[0]) != null ? _c : null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: JSON.stringify(params),
        journal_ref: null,
        error: null
      });
      step(job, FIRST_STEP_BUDGET_MS);
      return { jobId: job.job_id, message: "Sync started." };
    });
  }
  function reclaimStaleJob(job) {
    if (!reclaimIfStale(job)) return false;
    clearCancel(job.job_id);
    return true;
  }
  function spill(archiveId, slim, runs) {
    writeSlim(archiveId, slim);
    writePageRuns(archiveId, runs);
  }
  function step(job, budgetMs = BUDGET_MS) {
    var _a, _b, _c, _d, _e, _f;
    const started = Date.now();
    const params = parseParams(job);
    const jobId = job.job_id;
    const projectId = (_b = (_a = projectScope()) == null ? void 0 : _a[0]) != null ? _b : null;
    let findings = job.findings_so_far;
    try {
      while (params.scopeIndex < params.scopes.length) {
        const scope = params.scopes[params.scopeIndex];
        const archiveId = scanIdFor(params.syncId, scope);
        const progress = progressFor(params, scope);
        const resuming = job.scope === scope;
        const paging = newScanPaging(
          resuming && job.page_size > 0 ? job.page_size : PAGE_SIZE
        );
        paging.pageNumber = resuming ? job.page : 0;
        let cursor = resuming ? job.cursor : null;
        const slim = paging.pageNumber > 0 ? (_c = readSlim(archiveId)) != null ? _c : [] : [];
        const runs = paging.pageNumber > 0 ? (_d = readPageRuns(archiveId)) != null ? _d : [] : [];
        for (; ; ) {
          if (isCancelRequested(jobId)) throw new SyncCancelled();
          const variables = buildVariables(scope, {
            severities: (_e = params.severitiesByScope[scope]) != null ? _e : [],
            projectId,
            after: cursor
          });
          const pageIndex = paging.pageNumber + 1;
          const page = fetchPage(scope, variables, paging);
          writeScanPage(archiveId, pageIndex, envelope(scope, page.nodes));
          pushAll(slim, page.nodes.map((n2) => slimRecord(scope, n2)));
          runs.push([pageIndex, page.nodes.length]);
          findings += page.nodes.length;
          cursor = page.pageInfo.endCursor;
          progress.pages = paging.pageNumber;
          progress.rows = slim.length;
          if (page.totalCount !== null) progress.totalCount = page.totalCount;
          if (page.partialErrors.length) {
            progress.partialPages += 1;
            for (const message of page.partialErrors) {
              if (progress.partialErrors.length >= MAX_PARTIAL_ERRORS) break;
              progress.partialErrors.push(message);
            }
          }
          updateJob(jobId, {
            scope,
            cursor,
            page: paging.pageNumber,
            page_size: paging.pageSize,
            // Cumulative across the WHOLE sync — this is one job, and the card counts one
            // sync. It therefore DOES NOT pair with `total_count` below, which is only the
            // current scope's total: dividing them is right for the first scope and silently
            // wrong from the second on. An earlier revision of this comment pointed at
            // `params.perScope[scope].rows` as the per-scope numerator; that field is only
            // written when a scope COMPLETES (`progress.rows = slim.length`), so it is absent
            // for exactly the duration anyone would want it, and `params_json` never reaches
            // the browser anyway (pagePayload's JOB_KEYS allowlist).
            //
            // The honest per-scope fraction is PAGE-BASED — `page` and `page_size` are both
            // reset on every scope advance below, so `page * page_size / total_count` is a
            // fraction of one register. syncProgress.js::syncViewModel computes it there.
            findings_so_far: findings,
            // The CURRENT scope's total, per the jobs tab's own column definition.
            total_count: progress.totalCount,
            params_json: JSON.stringify(params)
          });
          if (!page.pageInfo.hasNextPage) break;
          if (Date.now() - started > budgetMs) {
            spill(archiveId, slim, runs);
            scheduleContinuation();
            return;
          }
        }
        progress.rawRef = scanFolder(archiveId).getId();
        progress.rows = slim.length;
        spill(archiveId, slim, runs);
        params.scopeIndex += 1;
        const nextScope = (_f = params.scopes[params.scopeIndex]) != null ? _f : null;
        updateJob(jobId, {
          scope: nextScope,
          cursor: null,
          page: 0,
          page_size: 0,
          total_count: 0,
          findings_so_far: findings,
          params_json: JSON.stringify(params)
        });
        if (nextScope !== null && Date.now() - started > budgetMs) {
          scheduleContinuation();
          return;
        }
      }
      finishSync(jobId, params);
    } catch (e) {
      if (e instanceof SyncCancelled) {
        finalizeCancel(job, params);
        return;
      }
      clearCancel(jobId);
      updateJob(jobId, {
        phase: "FAILED",
        error: e == null ? "Sync failed." : String(e).slice(0, 1e3)
      });
      throw e;
    }
  }
  function finishSync(jobId, params) {
    clearCancel(jobId);
    updateJob(jobId, { phase: "RECONCILING", params_json: JSON.stringify(params) });
    const perScope = params.scopes.map((scope) => {
      var _a, _b, _c, _d;
      return {
        scope,
        // The spill IS the projection reconcile is fed; reading it back rather than keeping it in
        // memory is what lets a battery that spanned three executions commit at all.
        records: (_a = readSlim(scanIdFor(params.syncId, scope))) != null ? _a : [],
        mode: "live",
        scannedSeverities: (_b = params.severitiesByScope[scope]) != null ? _b : [],
        rawRef: (_d = (_c = params.perScope[scope]) == null ? void 0 : _c.rawRef) != null ? _d : null
      };
    });
    scheduleWatchdog();
    updateJob(jobId, { phase: "PERSISTING" });
    const outcome = persistSync(jobId, params.syncId, perScope);
    updateJob(jobId, { phase: "DONE", error: null });
    clearContinuationTriggers();
    clearCancel(jobId);
    afterPersist(params, outcome);
  }
  function afterPersist(params, outcome) {
    try {
      recordDaily(dailyStats(params, outcome));
    } catch (e) {
      console.warn(`Failed to record the daily history entry: ${e}`);
    }
    autoCompactIfDue();
    warmAfterSync();
  }
  function warmAfterSync() {
    try {
      const report = warmReadModels();
      if (report.blockedBy) {
        console.warn(`Post-sync read-model warm did not run: ${report.blockedBy}`);
      } else {
        console.log(`Post-sync read-model warm: ${report.warmed} warmed, ${report.skipped} cold.`);
      }
    } catch (e) {
      console.warn(`Post-sync read-model warm failed: ${e}`);
    }
  }
  function dailyStats(params, outcome) {
    const ledger = loadState().ledger;
    return {
      sync_id: outcome.sync_id,
      at: nowIso(),
      committed_scopes: outcome.committed_scopes,
      scopes: outcome.scopes.map((s2) => {
        var _a, _b, _c, _d, _e, _f;
        return {
          scope: s2.scope,
          total: s2.total,
          written: s2.written,
          deltas: s2.deltas,
          twins: s2.twins,
          pages: (_b = (_a = params.perScope[s2.scope]) == null ? void 0 : _a.pages) != null ? _b : 0,
          total_count: (_d = (_c = params.perScope[s2.scope]) == null ? void 0 : _c.totalCount) != null ? _d : 0,
          // The caveat travels with the figure: a scope whose pages came back PARTIAL has good
          // rows and a suspect count, and a history entry that hid that would be the lie.
          partial_pages: (_f = (_e = params.perScope[s2.scope]) == null ? void 0 : _e.partialPages) != null ? _f : 0
        };
      }),
      mttr: mttrFromLedger(Object.values(ledger))
    };
  }
  function autoCompactIfDue() {
    try {
      const settings = loadSettings();
      if (!settings.autoCompact) return;
      const days = Number(settings.retentionDays);
      if (!Number.isFinite(days) || days <= 0) return;
      compactLedger(Math.floor(days));
    } catch (e) {
      console.warn(`Auto-compaction after the sync failed: ${e}`);
    }
  }
  function cancelSync(jobId) {
    const job = getJob(jobId);
    if (!job) return { jobId, stopped: false, message: "No such job." };
    if (isTerminalPhase(job.phase)) {
      return { jobId, stopped: true, message: "Sync already finished." };
    }
    setProp(cancelKey(jobId), "1");
    const message = forceStop(jobId);
    return message === null ? { jobId, stopped: false, message: "Stopping sync\u2026" } : { jobId, stopped: true, message };
  }
  function forceStop(jobId) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(FORCE_STOP_LOCK_MS)) return null;
    try {
      recoverIfNeeded();
      const job = getJob(jobId);
      if (!job || job.kind !== SYNC_KIND) return null;
      if (isTerminalPhase(job.phase)) {
        clearContinuationTriggers();
        clearCancel(jobId);
        return "Sync stopped.";
      }
      if (job.phase === "FETCHING" || job.phase === "RECONCILING") {
        clearContinuationTriggers();
        finalizeCancel(job);
        return "Sync stopped.";
      }
      return null;
    } finally {
      lock.releaseLock();
    }
  }
  function finalizeCancel(job, known) {
    let params = known != null ? known : null;
    if (params === null) {
      try {
        params = parseParams(job);
      } catch {
        params = null;
      }
    }
    if (params !== null) {
      for (const scope of params.scopes) {
        try {
          trashScan(scanIdFor(params.syncId, scope));
        } catch {
        }
      }
    }
    updateJob(job.job_id, { phase: "CANCELLED", error: null });
    clearCancel(job.job_id);
  }
  function scheduleContinuation(delayMs = CONTINUE_DELAY_MS) {
    ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(delayMs).create();
  }
  function scheduleWatchdog(delayMs = CONTINUE_DELAY_MS) {
    ScriptApp.newTrigger(WATCHDOG_HANDLER).timeBased().after(delayMs).create();
  }
  function clearContinuationTriggers() {
    clearTriggers(CONTINUE_HANDLER);
    clearTriggers(WATCHDOG_HANDLER);
  }
  function continueJob(_e) {
    try {
      withScriptLock(() => {
        clearTriggers(CONTINUE_HANDLER);
        const job = activeJob();
        if (!job || job.kind !== SYNC_KIND) return;
        if (job.phase === "FETCHING") {
          if (isCancelRequested(job.job_id)) {
            finalizeCancel(job);
            return;
          }
          step(job);
        } else if (job.phase === "RECONCILING") {
          finishSync(job.job_id, parseParams(job));
        } else if (job.phase === "PERSISTING") {
          recoverIfNeeded();
          clearCancel(job.job_id);
        }
      }, 12e4);
    } catch (e) {
      if (e instanceof LedgerBusyError) scheduleContinuation(CONTINUE_RETRY_MS);
      throw e;
    }
  }
  function watchdogSync(_e) {
    try {
      withScriptLock(() => {
        clearTriggers(WATCHDOG_HANDLER);
        const job = activeJob();
        if (!job || job.kind !== SYNC_KIND) return;
        if (job.phase !== "PERSISTING") return;
        recoverIfNeeded();
        clearCancel(job.job_id);
      }, 12e4);
    } catch (e) {
      if (e instanceof LedgerBusyError) scheduleWatchdog(CONTINUE_RETRY_MS);
      throw e;
    }
  }
  function dailySync() {
    if (!hasWizCredentials()) return;
    startSync();
  }
  function jobStatus(jobId) {
    return getJob(jobId);
  }
  function resetStuckJob() {
    const result = withScriptLock(() => {
      const before = activeJob();
      recoverIfNeeded();
      if (!before) {
        return { cleared: false, jobId: null, kind: null, phase: null, message: "No active job." };
      }
      for (const handler of Object.values(CONTINUE_HANDLERS)) clearTriggers(handler);
      for (const handler of Object.values(WATCHDOG_HANDLERS)) clearTriggers(handler);
      clearCancel(before.job_id);
      const after = activeJob();
      if (after) {
        updateJob(after.job_id, {
          phase: "FAILED",
          error: "Reset: cleared by resetStuckJob() from the Apps Script editor."
        });
      }
      return {
        cleared: true,
        jobId: before.job_id,
        kind: before.kind,
        phase: before.phase,
        message: `Cleared ${before.kind} job ${before.job_id} (was ${before.phase}).`
      };
    }, 12e4);
    console.log(result.message);
    return result;
  }

  // src/server/api.ts
  function run(fn) {
    try {
      return { ok: true, data: fn() };
    } catch (e) {
      const kind = e instanceof LedgerBusyError ? "busy" : "error";
      return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: kind };
    }
  }
  function mutate(fn) {
    return run(() => withScriptLock(() => {
      recoverIfNeeded();
      return fn();
    }));
  }
  function bootstrap(_p) {
    return run(() => {
      var _a, _b, _c;
      const scans = readAll(TABS.scans);
      let latest = null;
      for (const row of scans) {
        const ts = String((_a = row.ts) != null ? _a : "");
        if (!ts) continue;
        if (!latest || ts > latest.ts) {
          latest = {
            scan_id: String((_b = row.scan_id) != null ? _b : ""),
            ts,
            scope: row.scope == null ? null : String(row.scope),
            severities: row.severities == null ? null : String(row.severities),
            total: Number((_c = row.total) != null ? _c : 0)
          };
        }
      }
      return {
        product: "Wiz Sidekick DevSecOps",
        buildId: BUILD_ID,
        hasCredentials: hasWizCredentials(),
        scopes: SCOPES,
        severityOrder: SEVERITY_ORDER,
        slaTargets: SLA_TARGETS,
        latestScan: latest,
        canEditAccess: canEditUsers(),
        settings: loadSettings()
      };
    });
  }
  function getSettings(_p) {
    return run(() => loadSettings());
  }
  function putSettings(p) {
    return mutate(() => saveSettings(p.settings));
  }
  function getChartsBundle(_p) {
    return run(() => HtmlService.createHtmlOutputFromFile("js_charts").getContent());
  }
  function modelParams(p) {
    const r = p != null ? p : {};
    const scopeRaw = r["scope"];
    const scope = typeof scopeRaw === "string" && SCOPES.includes(scopeRaw) ? scopeRaw : null;
    const sevRaw = r["severities"];
    const severities = Array.isArray(sevRaw) ? sevRaw.map(String) : null;
    return { scope, severities, showNoFix: r["showNoFix"] !== false };
  }
  function requestedScope(p) {
    const raw = (p != null ? p : {})["scope"];
    return typeof raw === "string" && SCOPES.includes(raw) ? raw : null;
  }
  function getExecutivePage(p) {
    return run(() => {
      const params = modelParams(p);
      const exec = executiveModel(params);
      return {
        asOf: exec["asOf"],
        scope: exec["scope"],
        severities: exec["severities"],
        showNoFix: exec["showNoFix"],
        mttr: execMttrSlice(mttrModel(params)),
        byScope: execGroupSlice(exec["byScope"]),
        // Already minimal — a per-severity tally, a delta pair, the tier table and the coverage
        // caveat — so these four ship whole.
        severityCounts: exec["severityCounts"],
        weekTrend: exec["weekTrend"],
        tiers: exec["tiers"],
        signalCoverage: exec["signalCoverage"]
      };
    });
  }
  function getMttrPage(p) {
    return run(() => {
      const params = modelParams(p);
      return {
        mttr: mttrModel(params),
        trends: mttrPageTrendSlice(historyModel(params)),
        byScope: mttrGroupTableSlice(executiveModel(params)["byScope"])
      };
    });
  }
  function getProgramPage(p) {
    return run(() => {
      const program = { ...programModel(modelParams(p)) };
      const trends = programTrendSlice(program);
      delete program["trend"];
      return { program, trends };
    });
  }
  function getRegisterPage(p) {
    return run(() => {
      const scope = requestedScope(p);
      if (scope === null) {
        throw new Error("getRegisterPage needs a scope: one of sca, sast.");
      }
      if (scope === "secrets") {
        throw new Error(
          "The secrets register has its own page \u2014 call getSecretsPage. Severity is not one of its axes, so this page's blocks would come back empty."
        );
      }
      const register = { ...registerModel(scope, modelParams(p)) };
      register["latestScan"] = latestScanSlice(register["latestScan"]);
      return register;
    });
  }
  function getSecretsPage(p) {
    return run(() => {
      const params = modelParams(p);
      const register = { ...registerModel("secrets", params) };
      delete register["segments"];
      register["latestScan"] = latestScanSlice(register["latestScan"]);
      return { register, secrets: secretsModel(params) };
    });
  }
  function getRegisterRows(p) {
    return run(() => {
      const scope = requestedScope(p);
      if (scope === null) {
        throw new Error("getRegisterRows needs a scope: one of sca, sast, secrets.");
      }
      const r = p != null ? p : {};
      const params = {
        ...modelParams(p),
        page: r["page"],
        pageSize: r["pageSize"],
        sort: r["sort"],
        dir: r["dir"],
        status: r["status"]
      };
      const model = registerRowsModel(scope, params);
      return { ...model, rows: registerRowsSlice(model["rows"], scope) };
    });
  }
  function getReposPage(p) {
    return run(() => reposModel(modelParams(p)));
  }
  function getScanHistory(p) {
    return run(() => {
      const h = historyModel(modelParams(p));
      return {
        asOf: h["asOf"],
        asOfSource: h["asOfSource"],
        observedFrom: h["observedFrom"],
        scope: h["scope"],
        severities: h["severities"],
        showNoFix: h["showNoFix"],
        kpis: h["kpis"],
        perScope: h["perScope"],
        // The scans tab narrowed to the ten columns the table draws — raw_ref / obs_ref are
        // Drive file ids and are not among them (pagePayload.ts's SCAN_ROW_KEYS).
        scans: scanRowsSlice(h["scans"]),
        trends: historyTrendSlice(h)
      };
    });
  }
  function getStorageStats(_p) {
    return run(() => storageModel());
  }
  function runSync(p) {
    return run(() => {
      const raw = (p != null ? p : {})["scopes"];
      const scopes = Array.isArray(raw) ? raw.map(String).filter((s2) => SCOPES.includes(s2)) : void 0;
      return startSync(scopes ? { scopes } : {});
    });
  }
  function getJobStatus(p) {
    return run(() => {
      var _a;
      const jobId = String((_a = (p != null ? p : {})["jobId"]) != null ? _a : "");
      const job = jobId ? getJob(jobId) : activeJob();
      if (!job) return null;
      return jobSummarySlice(job, !isTerminalPhase(job.phase) && isStaleJob(job));
    });
  }
  function cancelSync2(p) {
    return run(() => {
      var _a;
      return cancelSync(String((_a = (p != null ? p : {})["jobId"]) != null ? _a : ""));
    });
  }
  function deleteScans2(p) {
    var _a;
    const scanIds = ((_a = (p != null ? p : {})["scanIds"]) != null ? _a : []).map(String);
    return mutate(() => deleteScans(scanIds));
  }
  function compact(p) {
    const params = p != null ? p : {};
    const dryRun = params["dryRun"] === true;
    const days = params["retentionDays"] !== void 0 && params["retentionDays"] !== null ? Number(params["retentionDays"]) : loadSettings().retentionDays;
    if (dryRun) return run(() => previewMaintenance(days));
    return mutate(() => compactLedger(days, false));
  }
  function resetLedger2(_p) {
    return mutate(() => {
      try {
        clearContinuationTriggers();
      } catch (e) {
        console.warn(`resetLedger: continuation-trigger cleanup skipped: ${e}`);
      }
      return resetLedger();
    });
  }
  function csvCell(v) {
    if (v === null || v === void 0) return "";
    const s2 = String(v);
    return /[",\r\n]/.test(s2) ? `"${s2.replace(/"/g, '""')}"` : s2;
  }
  function getExportCsv(p) {
    return run(() => {
      var _a;
      const params = p != null ? p : {};
      const scope = requestedScope(p);
      const sevRaw = params["severities"];
      const severities = Array.isArray(sevRaw) && sevRaw.length ? new Set(sevRaw.map((s2) => normalizeSeverity(s2))) : null;
      const statusRaw = params["statuses"];
      const statuses = Array.isArray(statusRaw) && statusRaw.length ? new Set(statusRaw.map((s2) => String(s2).toUpperCase())) : null;
      const rows = loadBaseRows(scope ? { scope } : {}).filter((r) => !severities || severities.has(normalizeSeverity(r["severity"]))).filter((r) => {
        var _a2;
        return !statuses || statuses.has(String((_a2 = r["status"]) != null ? _a2 : "").toUpperCase());
      });
      const cols = (_a = TAB_HEADERS[TABS.ledger]) != null ? _a : [];
      const lines = [cols.join(",")];
      for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
      return {
        content: lines.join("\r\n"),
        filename: `wiz-devsecops-ledger-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`,
        rowCount: rows.length,
        columns: cols.length,
        scope
      };
    });
  }
  var RECENT_ERROR_LIMIT = 50;
  function getRecentErrors(p) {
    return run(() => {
      var _a;
      const raw = Number((_a = (p != null ? p : {})["limit"]) != null ? _a : RECENT_ERROR_LIMIT);
      const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), RECENT_ERROR_LIMIT) : RECENT_ERROR_LIMIT;
      const errors = listJobs().filter((j) => j.error !== null && j.error !== "").map((j) => ({
        job_id: j.job_id,
        kind: j.kind,
        phase: j.phase,
        scope: j.scope,
        at: j.updated_at,
        started_at: j.started_at,
        error: j.error
      })).sort((a, b) => a.at < b.at ? 1 : a.at > b.at ? -1 : 0).slice(0, limit);
      return {
        errors,
        // The panel must be able to say what it is NOT showing.
        covers: "jobs",
        note: "Job failures only \u2014 this register has no error-log tab. A read that fails returns its message to the caller and records no row."
      };
    });
  }

  // src/server/devSeed.ts
  var devSeed_exports = {};
  __export(devSeed_exports, {
    seedSampleLedger: () => seedSampleLedger
  });

  // src/server/sampleData.ts
  var SAMPLE_SYNCS = [];

  // src/server/devSeed.ts
  function seedSampleLedger() {
    if (SAMPLE_SYNCS.length === 0) {
      return { seeded: 0, syncs: 0, rows: 0, reason: "no sample data in this build" };
    }
    let rows = 0;
    const scopesTouched = /* @__PURE__ */ new Set();
    for (let i = 0; i < SAMPLE_SYNCS.length; i++) {
      const sync = SAMPLE_SYNCS[i];
      const perScope = sync.scopes.map((battery) => {
        rows += battery.rawRecords.length;
        scopesTouched.add(battery.scope);
        return {
          scope: battery.scope,
          records: battery.rawRecords.map((node) => slimRecord(battery.scope, node)),
          mode: battery.mode,
          scannedSeverities: battery.scannedSeverities,
          rawRef: null
        };
      });
      const jobId = `dev-seed-${i + 1}`;
      persistSync(jobId, sync.syncId, perScope);
    }
    const seeded = Object.values(loadState().ledger).filter(
      (row) => scopesTouched.has(row.scope)
    ).length;
    return { seeded, syncs: SAMPLE_SYNCS.length, rows };
  }
  return __toCommonJS(index_exports);
})();
