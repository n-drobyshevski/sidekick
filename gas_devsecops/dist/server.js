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
    doGet: () => doGet,
    include: () => include,
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
      (n) => '<circle cx="' + n[0] + '" cy="' + n[1] + '" r="' + n[2] + '" fill="#0a0a0a"/>'
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
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
    const at2 = ownerEmail().lastIndexOf("@");
    return at2 >= 0 ? ownerEmail().slice(at2 + 1).toLowerCase() : "";
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
  function utf8Bytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c < 128) {
        out.push(c);
      } else if (c < 2048) {
        out.push(192 | c >> 6, 128 | c & 63);
      } else if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
        const c2 = s.charCodeAt(++i);
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
  function rotl(n, b) {
    return (n << b | n >>> 32 - b) >>> 0;
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
  var BUILD_ID = true ? "36e8a15593ca" : "dev";

  // src/server/serverCache.ts
  var VERSION_PROP = "DATA_VERSION";
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
  function splitChunks(s, size = CHUNK_CHARS) {
    const out = [];
    for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
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
    const n = Number(meta);
    if (!Number.isInteger(n) || n < 1) return void 0;
    const names = [];
    for (let i = 0; i < n; i++) names.push(`${key}:${i}`);
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

  // src/domain/util.ts
  function cmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function pushInto(map, key, ...values) {
    const bucket = map.get(key);
    if (bucket) bucket.push(...values);
    else map.set(key, [...values]);
  }
  function groupBy(xs, key) {
    const out = /* @__PURE__ */ new Map();
    for (const x of xs) pushInto(out, key(x), x);
    return out;
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
  function parseTs(v) {
    const c = clean(v);
    if (c === null) return null;
    if (c instanceof Date) return isNaN(c.getTime()) ? null : c.getTime();
    if (typeof c === "number" && Number.isFinite(c)) return c;
    let s = String(c).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += "Z";
    const t = Date.parse(s);
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
  function maxNum(values) {
    return values.reduce((m, v) => Math.max(m, v), -Infinity);
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
      "finding_key",
      "scope",
      "identifier",
      "component",
      "severity",
      "repo_id",
      "repo_name",
      "branch",
      "platform",
      "first_seen",
      "last_seen",
      "status",
      "resolved_at",
      "resolution_src",
      "reopened_count",
      "first_scan_id",
      "last_scan_id",
      // The second clock's inputs. Written from day one even though nothing derives
      // fix_available_at yet — capturing them later would leave a hole no backfill can close.
      "fix_date",
      "fix_observed_at",
      "fixed_version",
      // Tri-state forever: Wiz returns null for a signal it never evaluated, and collapsing
      // that to false is what makes an unassessed finding look clean.
      "has_kev",
      "has_exploit",
      "epss",
      "risk_observed_at",
      // SAST-shaped columns; null for an SCA row and vice versa. One ledger, three scopes.
      "cwe",
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
      // IDENTITY IS `(secretDataId, path, lineNumber)`, hashed — src/domain/secretsLedger.ts.
      //
      // TWO EARLIER REVISIONS OF THIS COMMENT WERE WRONG, in opposite directions, and the
      // sequence is the point. The first said the pair (secretDataId, path), on one page
      // showing 3.82 rows per credential. Measured over both pages of the 843-row gated
      // register, that pair collides 2.27:1 with a single pair covering 49 rows (§9.5):
      //
      //     key                                page 1   page 2
      //     id                                   1.00     1.00
      //     secretDataId                         4.39     2.09
      //     (secretDataId, path)                 2.27     1.37   <- merges distinct findings
      //     (secretDataId, path, line)           1.32     1.06
      //     (secretDataId, path, line, resource) 1.00     1.00
      //     externalId                           1.00     1.00
      //
      // So the second revision took `externalId`, because it is unique. IT IS UNIQUE FOR THE
      // WRONG REASON (§10.6). With the severity gate off — the whole 1,958-row CODE
      // population rather than 843 — the register splits REPOSITORY 1,359 / REPOSITORY_BRANCH
      // 599, and 187 (secretDataId, path, lineNumber) keys span BOTH. All 187 carry two
      // different externalIds, because Wiz splices the branch segment into its composite:
      //
      //     REPOSITORY         github.com##<org>/<repo>##<path>##<hash>##<line>
      //     REPOSITORY_BRANCH  github.com##<org>/<repo>##<branch>##<path>##<hash>##<line>
      //
      // `externalId` is unique BECAUSE IT PRESERVES THE DUPLICATE. A ledger keyed on it
      // records one secret, in one file, at one line, as two findings with two clocks — and
      // §10.7 measured those clocks genuinely disagreeing: median 19.9 days apart, max 285.3,
      // 83 of 187 over 30 days, with the branch twin earlier in 135 cases and the repository
      // twin in the other 52. Neither type is reliably older, so the register cannot prefer
      // one. It keys on the triple, folds the twins, and takes the EARLIEST first_seen.
      //
      // THE KEY IS DERIVED, NEVER ADOPTED, which inverts the OS ledger's first rule.
      // gas/src/domain/lifecycle.ts::vulnKey prefers the Wiz `id` because there it is stable
      // per FINDING. Here `id` and `externalId` are both stable per ROW, and the row is not
      // the finding — so adopting either is the same mistake one level down.
      //
      // secretDataId still names the CREDENTIAL and is what rotation groups by — one decision
      // per credential across however many occurrences it has. It is just not the row key.
      //
      // THREE CAVEATS, none resolved, all of which the ledger depends on:
      //   * A LINE MOVE LOOKS LIKE A NEW FINDING. The triple encodes the line, and so does
      //     every unique candidate above — there is no line-stable unique key. Reformatting a
      //     file would close one finding and open another, and the MTTR clock would believe
      //     it.
      //   * UUID STABILITY IS INFERRED, NOT MEASURED. id and secretDataId carry a version-5
      //     nibble, i.e. name-based UUIDs derived from content, which WOULD make them stable
      //     across scans. §10.8 re-fetched §9's exact rows and found both unchanged — but
      //     lastUpdatedAt showed no rescan had intervened, so that is not the two-scan test.
      //     The strongest evidence is incidental: branch twins carry firstSeenAt 2025-11-14
      //     with lastSeenAt 2026-08-23 under a SINGLE id, one identity spanning nine months
      //     of scans. Persuasive, still not controlled, and the ledger depends on it.
      //   * THE FOLD DISCARDS A MEASUREMENT, so the row records what it discarded:
      //     twin_count, twin_first_seen_spread_days and source_external_ids below.
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
      // register on the way in. That is now what happens: secretsLedger.collapseTwins folds
      // them once they are keyed, and the filter still asks for the whole population.
      "secret_kind",
      "confidence",
      "rotated_at",
      "removed_at",
      "validation_state",
      "validated_at",
      // The twin fold, made auditable. Collapsing 187 pairs to the earliest first_seen is
      // the right call (§10.7) and it throws a number away; a 285-day disagreement has to
      // be visible in the row rather than only in the module that folded it.
      "twin_count",
      "twin_first_seen_spread_days",
      "source_external_ids",
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
  var SCHEMA_VERSION = 1;
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
  function cellCount() {
    return ledgerSpreadsheet().getSheets().reduce((acc, sh) => acc + sh.getMaxRows() * sh.getMaxColumns(), 0);
  }

  // src/server/setup.ts
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
    notes.push("Triggers: none installed (no sync battery yet \u2014 Phase 2)");
    return notes.join("\n");
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

  // src/domain/settingsLogic.ts
  var DEFAULT_SETTINGS = {
    scopes: [...SCOPES],
    fetchSeverities: {
      sca: [...DEFAULT_FETCH_SEVERITIES.sca],
      sast: [...DEFAULT_FETCH_SEVERITIES.sast],
      secrets: [...DEFAULT_FETCH_SEVERITIES.secrets]
    },
    slaTargets: { ...SLA_TARGETS },
    showExperimental: false
  };
  function asList(v, allowed) {
    if (!Array.isArray(v)) return null;
    const seen = /* @__PURE__ */ new Set();
    for (const x of v) {
      const s = String(x).trim().toUpperCase();
      if (allowed.includes(s)) seen.add(s);
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
  function cleanSettings(raw) {
    const r = raw || {};
    const scopes = (Array.isArray(r.scopes) ? r.scopes : []).map((x) => String(x).trim().toLowerCase()).filter((x) => SCOPES.includes(x));
    const sla = { ...SLA_TARGETS };
    const rawSla = r.slaTargets || {};
    for (const sev of SEVERITY_ORDER) {
      const v = Number(rawSla[sev]);
      if (Number.isFinite(v) && v > 0) sla[sev] = Math.floor(v);
    }
    return {
      // An empty list would collect nothing while looking configured, so it falls back
      // rather than persisting a register that can never fill.
      scopes: scopes.length ? scopes : [...SCOPES],
      fetchSeverities: cleanFetchSeverities(r.fetchSeverities),
      slaTargets: sla,
      showExperimental: r.showExperimental === true
    };
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
    const s = loadSettings();
    ok("Scopes collected", s.scopes.join(", ") || "(none)");
    ok("Scopes available", SCOPES.join(", "));
    for (const scope of SCOPES) {
      ok(`Severities requested (${scope})`, s.fetchSeverities[scope].join(", ") || "(all)");
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
    getChartsBundle: () => getChartsBundle,
    getExecutive: () => getExecutive,
    getMttr: () => getMttr,
    getRegister: () => getRegister,
    getSettings: () => getSettings,
    putSettings: () => putSettings,
    runSampleSync: () => runSampleSync
  });

  // src/domain/ledgerCore.ts
  var DAY_MS = 864e5;
  function parseSeverities(value) {
    const s = String(value != null ? value : "").trim();
    if (!s || s === "*") return null;
    return s.split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
  }
  function scansAsc(scans, scope) {
    return scans.filter((r) => r.scope === scope).sort((a, b) => {
      var _a, _b;
      const ta = (_a = parseTs(a.ts)) != null ? _a : 0;
      const tb = (_b = parseTs(b.ts)) != null ? _b : 0;
      if (ta !== tb) return ta - tb;
      return a.scan_id < b.scan_id ? -1 : a.scan_id > b.scan_id ? 1 : 0;
    });
  }
  function latestScan(scans, scope) {
    const asc = scansAsc(scans, scope);
    return asc.length ? asc[asc.length - 1] : null;
  }
  function prevScanIdBySeverity(scans, scope) {
    const remaining = new Set(SEVERITY_ORDER);
    const mapping = {};
    for (const r of scansAsc(scans, scope).reverse()) {
      const covered = parseSeverities(r.severities);
      const hit = covered === null ? [...remaining] : [...remaining].filter((s) => covered.includes(s));
      for (const sev of hit) mapping[sev] = r.scan_id;
      for (const sev of hit) remaining.delete(sev);
      if (!remaining.size) break;
    }
    return Object.keys(mapping).length ? mapping : null;
  }
  function existingScanDeltas(scans, scanId) {
    var _a, _b, _c;
    const row = scans.find((r) => r.scan_id === scanId);
    if (!row) return null;
    return {
      new_count: Number((_a = row.new_count) != null ? _a : 0),
      resolved_count: Number((_b = row.resolved_count) != null ? _b : 0),
      reopened_count: Number((_c = row.reopened_count) != null ? _c : 0)
    };
  }
  var HAS_VENDOR_FIX = /* @__PURE__ */ new Set(["sca"]);
  function baseRows(rows, now) {
    const nowMs = now != null ? now : Date.now();
    return rows.map((row) => {
      var _a, _b;
      const first = parseTs(row.first_seen);
      const resolved = parseTs(row.resolved_at);
      const open = row.status === "OPEN";
      const vendor = HAS_VENDOR_FIX.has(row.scope);
      const fixAvailableAt = vendor ? (_b = (_a = row.fix_date) != null ? _a : row.fix_observed_at) != null ? _b : null : null;
      const fixAvailMs = parseTs(fixAvailableAt);
      const actionableMs = fixAvailMs === null ? null : first === null ? fixAvailMs : Math.max(first, fixAvailMs);
      return {
        ...row,
        mttr_days: first !== null && resolved !== null ? (resolved - first) / DAY_MS : null,
        age_days: resolved === null && first !== null ? (nowMs - first) / DAY_MS : null,
        fix_available_at: fixAvailableAt,
        actionable_from: actionableMs === null ? null : toIso(actionableMs),
        mttr_actionable_days: resolved !== null && actionableMs !== null ? (resolved - actionableMs) / DAY_MS : null,
        actionable_age_days: open && actionableMs !== null ? (nowMs - actionableMs) / DAY_MS : null,
        awaiting_vendor_fix: open && vendor && fixAvailableAt === null
      };
    });
  }

  // src/domain/severity.ts
  function normalizeSeverity(sev) {
    if (typeof sev !== "string") return "UNKNOWN";
    const s = sev.toUpperCase().trim();
    if (s === "INFORMATIONAL" || s === "INFO") return "INFO";
    return SEVERITY_ORDER.includes(s) ? s : "UNKNOWN";
  }

  // src/domain/remediation.ts
  var RESOLUTION_BUCKET_EDGES = [1, 7, 30, 90];
  var RESOLUTION_BUCKET_LABELS = ["\u22641d", "2\u20137d", "8\u201330d", "31\u201390d", "90+d"];
  function isOpen(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function resolvedMttr(row) {
    const m = row.mttr_days;
    return typeof m === "number" && Number.isFinite(m) ? m : null;
  }
  function openAge(row) {
    if (!isOpen(row.status)) return null;
    const a = row.age_days;
    return typeof a === "number" && Number.isFinite(a) ? a : null;
  }
  function mttrPercentiles(rows) {
    var _a;
    const bySev = {};
    const all = [];
    for (const row of rows) {
      const m = resolvedMttr(row);
      if (m === null) continue;
      const s = normalizeSeverity(row.severity);
      ((_a = bySev[s]) != null ? _a : bySev[s] = []).push(m);
      all.push(m);
    }
    const perSev = {};
    for (const s of SEVERITY_ORDER) {
      const vals = bySev[s];
      if (!vals) continue;
      perSev[s] = { p50: quantile(vals, 0.5), p90: quantile(vals, 0.9), count: vals.length };
    }
    return {
      perSev,
      overall: { p50: quantile(all, 0.5), p90: quantile(all, 0.9), count: all.length }
    };
  }
  function resolutionBuckets(rows) {
    const perSev = {};
    let total = 0;
    for (const row of rows) {
      const m = resolvedMttr(row);
      if (m === null) continue;
      const bucket = m <= RESOLUTION_BUCKET_EDGES[0] ? 0 : m <= RESOLUTION_BUCKET_EDGES[1] ? 1 : m <= RESOLUTION_BUCKET_EDGES[2] ? 2 : m <= RESOLUTION_BUCKET_EDGES[3] ? 3 : 4;
      const s = normalizeSeverity(row.severity);
      if (!perSev[s]) perSev[s] = [0, 0, 0, 0, 0];
      perSev[s][bucket] += 1;
      total += 1;
    }
    return { perSev, labels: RESOLUTION_BUCKET_LABELS, total };
  }
  function kmCurve(events, times) {
    const curve = [];
    let s = 1;
    for (const t of [...new Set(events)].sort((a, b) => a - b)) {
      const atRisk = times.filter((x) => x >= t).length;
      if (atRisk === 0) continue;
      const d = events.filter((x) => x === t).length;
      s *= 1 - d / atRisk;
      curve.push({ t, s, atRisk, events: d });
    }
    return curve;
  }
  var CROSSING_EPSILON = 1e-9;
  function kmQuantileFromCurve(curve, q) {
    const threshold = 1 - q + CROSSING_EPSILON;
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
      const c = openAge(row);
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
    const med = kmMedianFromCurve(curve);
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
      median: med,
      medianLowerBound: med === null ? restrictionTime : null,
      mean: rmst,
      restrictionTime,
      meanTruncated: prevS > 0,
      naiveMean,
      naiveMedian,
      events: events.length,
      censored: censored.length,
      total
    };
  }
  function openPastSla(rows) {
    var _a, _b;
    const perSev = {};
    let totalOpen = 0;
    let totalBreached = 0;
    for (const row of rows) {
      const age = openAge(row);
      if (age === null) continue;
      const s = normalizeSeverity(row.severity);
      const target = (_a = SLA_TARGETS[s]) != null ? _a : null;
      const stat = (_b = perSev[s]) != null ? _b : perSev[s] = { open: 0, breached: 0, pct: null, target };
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
  function openAgePercentiles(rows) {
    var _a;
    const bySev = {};
    const all = [];
    for (const row of rows) {
      const a = openAge(row);
      if (a === null) continue;
      const s = normalizeSeverity(row.severity);
      ((_a = bySev[s]) != null ? _a : bySev[s] = []).push(a);
      all.push(a);
    }
    const perSev = {};
    for (const s of SEVERITY_ORDER) {
      const vals = bySev[s];
      if (!vals) continue;
      perSev[s] = { p50: quantile(vals, 0.5), p90: quantile(vals, 0.9), count: vals.length };
    }
    return {
      perSev,
      overall: { p50: quantile(all, 0.5), p90: quantile(all, 0.9), count: all.length }
    };
  }
  function awaitingVendorFix(rows) {
    let count = 0;
    let openWithVendor = 0;
    for (const row of rows) {
      if (row.scope !== "sca" || !isOpen(row.status)) continue;
      openWithVendor += 1;
      if (row.awaiting_vendor_fix) count += 1;
    }
    return { count, openWithVendor, pct: openWithVendor ? count / openWithVendor * 100 : null };
  }

  // src/domain/observation.ts
  var LEDGER_COLUMNS = [
    "finding_key",
    "scope",
    "identifier",
    "component",
    "severity",
    "repo_id",
    "repo_name",
    "branch",
    "platform",
    "first_seen",
    "last_seen",
    "status",
    "resolved_at",
    "resolution_src",
    "reopened_count",
    "first_scan_id",
    "last_scan_id",
    "fix_date",
    "fix_observed_at",
    "fixed_version",
    "has_kev",
    "has_exploit",
    "epss",
    "risk_observed_at",
    "cwe",
    "language",
    "file_path",
    "start_line",
    "origin",
    "secret_kind",
    "confidence",
    "rotated_at",
    "removed_at",
    "validation_state",
    "validated_at",
    "twin_count",
    "twin_first_seen_spread_days",
    "source_external_ids",
    "owner_project",
    "owner_path",
    "tags_json"
  ];
  function emptyObservation(scope, findingKey) {
    return {
      finding_key: findingKey,
      scope,
      identifier: null,
      component: null,
      severity: "UNKNOWN",
      repo_id: null,
      repo_name: null,
      branch: null,
      platform: null,
      first_seen: null,
      resolved_at: null,
      is_open: true,
      fix_date: null,
      fixed_version: null,
      has_kev: null,
      has_exploit: null,
      epss: null,
      cwe: null,
      language: null,
      file_path: null,
      start_line: null,
      origin: null,
      secret_kind: null,
      confidence: null,
      validation_state: null,
      validated_at: null,
      rotated_at: null,
      removed_at: null,
      twin_count: null,
      twin_first_seen_spread_days: null,
      source_external_ids: null,
      owner_project: null,
      owner_path: null,
      tags_json: null
    };
  }

  // src/server/ledgerStore.ts
  function str(v) {
    const c = clean(v);
    return c === null ? null : String(c);
  }
  function num(v) {
    const c = clean(v);
    if (c === null) return null;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
  }
  function triBool(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toUpperCase();
      if (s === "TRUE") return true;
      if (s === "FALSE") return false;
    }
    return null;
  }
  function validation(v) {
    const s = str(v);
    return s === "VALID" || s === "INVALID" || s === "ERROR" || s === "UNKNOWN" ? s : null;
  }
  function rowFromSheet(r) {
    var _a, _b, _c, _d;
    return {
      finding_key: String((_a = r["finding_key"]) != null ? _a : ""),
      scope: (_b = str(r["scope"])) != null ? _b : "sca",
      identifier: str(r["identifier"]),
      component: str(r["component"]),
      severity: (_c = str(r["severity"])) != null ? _c : "UNKNOWN",
      repo_id: str(r["repo_id"]),
      repo_name: str(r["repo_name"]),
      branch: str(r["branch"]),
      platform: str(r["platform"]),
      first_seen: str(r["first_seen"]),
      last_seen: str(r["last_seen"]),
      status: str(r["status"]) === STATUS_RESOLVED ? STATUS_RESOLVED : STATUS_OPEN,
      resolved_at: str(r["resolved_at"]),
      resolution_src: str(r["resolution_src"]),
      reopened_count: (_d = num(r["reopened_count"])) != null ? _d : 0,
      first_scan_id: str(r["first_scan_id"]),
      last_scan_id: str(r["last_scan_id"]),
      fix_date: str(r["fix_date"]),
      fix_observed_at: str(r["fix_observed_at"]),
      fixed_version: str(r["fixed_version"]),
      has_kev: triBool(r["has_kev"]),
      has_exploit: triBool(r["has_exploit"]),
      epss: num(r["epss"]),
      risk_observed_at: str(r["risk_observed_at"]),
      cwe: str(r["cwe"]),
      language: str(r["language"]),
      file_path: str(r["file_path"]),
      start_line: num(r["start_line"]),
      origin: str(r["origin"]),
      secret_kind: str(r["secret_kind"]),
      confidence: str(r["confidence"]),
      rotated_at: str(r["rotated_at"]),
      removed_at: str(r["removed_at"]),
      validation_state: validation(r["validation_state"]),
      validated_at: str(r["validated_at"]),
      twin_count: num(r["twin_count"]),
      twin_first_seen_spread_days: num(r["twin_first_seen_spread_days"]),
      source_external_ids: str(r["source_external_ids"]),
      owner_project: str(r["owner_project"]),
      owner_path: str(r["owner_path"]),
      tags_json: str(r["tags_json"])
    };
  }
  function rowToSheet(row) {
    var _a;
    const out = {};
    for (const col of LEDGER_COLUMNS) out[col] = (_a = row[col]) != null ? _a : null;
    return out;
  }
  function readLedger() {
    const out = {};
    for (const r of readAll(TABS.ledger)) {
      const row = rowFromSheet(r);
      if (row.finding_key) out[row.finding_key] = row;
    }
    return out;
  }
  function writeLedger(ledger) {
    overwrite(TABS.ledger, Object.values(ledger).map(rowToSheet));
  }
  function readScans() {
    return readAll(TABS.scans).map((r) => {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      return {
        scan_id: String((_a = r["scan_id"]) != null ? _a : ""),
        ts: String((_b = r["ts"]) != null ? _b : ""),
        scope: String((_c = r["scope"]) != null ? _c : ""),
        mode: String((_d = r["mode"]) != null ? _d : ""),
        severities: String((_e = r["severities"]) != null ? _e : ""),
        new_count: Number((_f = r["new_count"]) != null ? _f : 0),
        resolved_count: Number((_g = r["resolved_count"]) != null ? _g : 0),
        reopened_count: Number((_h = r["reopened_count"]) != null ? _h : 0)
      };
    });
  }
  function appendScan(row) {
    appendRows(TABS.scans, [{
      scan_id: row.scan_id,
      ts: row.ts,
      scope: row.scope,
      mode: row.mode,
      severities: row.severities === null || !row.severities.length ? "" : row.severities.join(","),
      total: row.total,
      new_count: row.new_count,
      resolved_count: row.resolved_count,
      reopened_count: row.reopened_count,
      raw_ref: null,
      sealed: false
    }]);
  }

  // src/server/sampleData.ts
  var SAMPLE_SCANS = [];

  // src/domain/normalize.ts
  function str2(v) {
    const c = clean(v);
    return c === null ? null : String(c);
  }
  function at(rec, path) {
    let cur = rec;
    for (const part of path.split(".")) {
      if (cur === null || typeof cur !== "object") return null;
      cur = cur[part];
    }
    return clean(cur);
  }
  function adoptedKey(scope, rec, basis) {
    const id = str2(rec["id"]);
    if (id !== null && id.trim()) return `${scope}:id:${id.trim()}`;
    return `${scope}:h:${sha1Hex(basis.map((v) => v != null ? v : "").join("|")).slice(0, 16)}`;
  }
  function triBool2(v) {
    return typeof v === "boolean" ? v : null;
  }
  function triNum(v) {
    const c = clean(v);
    if (c === null) return null;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
  }
  function ownerProject(rec) {
    var _a, _b;
    const projects = Array.isArray(rec["projects"]) ? rec["projects"] : [];
    return (_b = (_a = projects.find((p) => p && p["isFolder"] !== true)) != null ? _a : projects[0]) != null ? _b : null;
  }
  function normalizeSca(node) {
    var _a;
    const cve = str2(node["name"]);
    const component = str2(node["detailedName"]);
    const assetId = str2(at(node, "vulnerableAsset.id"));
    const assetName = str2(at(node, "vulnerableAsset.name"));
    const status = String((_a = str2(node["status"])) != null ? _a : "").toUpperCase();
    const resolvedAt = str2(node["resolvedAt"]);
    return {
      ...emptyObservation("sca", adoptedKey("sca", node, [
        cve,
        assetId != null ? assetId : assetName,
        str2(at(node, "vulnerableAsset.type")),
        component
      ])),
      identifier: cve,
      component,
      severity: normalizeSeverity(node["severity"]),
      repo_id: assetId,
      repo_name: assetName,
      // A VulnerableAssetRepositoryBranch IS the branch, so its name is the branch identity.
      // The union member that carries no branch leaves this null rather than guessing.
      branch: str2(at(node, "vulnerableAsset.type")) === "REPOSITORY_BRANCH" ? assetName : null,
      platform: str2(at(node, "vulnerableAsset.cloudPlatform")),
      language: str2(at(node, "artifactType.codeLibraryLanguage")),
      first_seen: toIso(parseTs(node["firstDetectedAt"])),
      resolved_at: toIso(parseTs(resolvedAt)),
      is_open: !(present(resolvedAt) || RESOLVED_STATUSES.has(status)),
      fix_date: toIso(parseTs(node["fixDate"])),
      fixed_version: str2(node["fixedVersion"]),
      has_kev: triBool2(node["hasCisaKevExploit"]),
      has_exploit: triBool2(node["hasExploit"]),
      epss: triNum(node["epssProbability"]),
      owner_project: str2(at(node, "vulnerableAsset.subscriptionName")),
      owner_path: str2(at(node, "vulnerableAsset.subscriptionExternalId"))
    };
  }
  function normalizeSast(node) {
    var _a;
    const rule = str2(node["name"]);
    const filePath = str2(node["filePath"]);
    const line = clean(node["startLine"]);
    const weaknesses = Array.isArray(node["weaknesses"]) ? node["weaknesses"] : [];
    const owner = ownerProject(node);
    const resource = (_a = node["resource"]) != null ? _a : null;
    return {
      ...emptyObservation("sast", adoptedKey("sast", node, [
        rule,
        str2(at(node, "resource.id")),
        filePath,
        line === null ? null : String(line)
      ])),
      identifier: rule,
      component: filePath === null ? null : line === null ? filePath : `${filePath}:${String(line)}`,
      severity: normalizeSeverity(node["severity"]),
      repo_id: resource === null ? null : str2(resource["id"]),
      repo_name: resource === null ? null : str2(resource["name"]),
      platform: resource === null ? null : str2(resource["type"]),
      // The CWE the rule maps to. Wiz can return several; the first is the primary one, and
      // the ledger has one column — a joined list would break every group-by that reads it.
      cwe: weaknesses.length ? str2(weaknesses[0]["name"]) : null,
      language: str2(node["codeLibraryLanguage"]),
      file_path: filePath,
      start_line: typeof line === "number" ? line : line === null ? null : Number(line),
      origin: str2(at(node, "vcsDetails.commitHash")),
      // §2: createdAt is the birth date. firstDetectedAtSource is Wiz's own re-derivation and
      // can post-date it, so the earlier of the two would be wrong to take blindly — createdAt
      // is the one the filter sorts on and the one the register dates from.
      first_seen: toIso(parseTs(node["createdAt"])),
      resolved_at: null,
      is_open: true,
      owner_project: owner === null ? null : str2(owner["name"]),
      owner_path: owner === null ? null : str2(owner["slug"])
    };
  }
  var NORMALIZERS = {
    sca: normalizeSca,
    sast: normalizeSast
  };

  // src/domain/reconcile.ts
  function makeRow(obs, firstSeen, scanId, scanTsIso) {
    const { is_open: _isOpen, ...rest } = obs;
    return {
      ...rest,
      first_seen: firstSeen,
      last_seen: scanTsIso,
      status: STATUS_OPEN,
      resolved_at: null,
      resolution_src: null,
      reopened_count: 0,
      first_scan_id: scanId,
      last_scan_id: scanId,
      fix_observed_at: present(obs.fixed_version) || present(obs.fix_date) ? scanTsIso : null,
      risk_observed_at: null
    };
  }
  function mergeRiskSignals(row, obs, scanTsIso) {
    if (obs.has_kev !== null && (row.has_kev == null || obs.has_kev)) row.has_kev = obs.has_kev;
    if (obs.has_exploit !== null && (row.has_exploit == null || obs.has_exploit)) {
      row.has_exploit = obs.has_exploit;
    }
    if (obs.epss !== null && (row.epss == null || obs.epss > row.epss)) row.epss = obs.epss;
    const witnessed = obs.has_kev !== null || obs.has_exploit !== null || obs.epss !== null;
    if (!witnessed) return;
    if (row.risk_observed_at == null || scanTsIso < row.risk_observed_at) {
      row.risk_observed_at = scanTsIso;
    }
  }
  function reconcile(observations, existingLedger, scope, scanId, scanTs, prevScanId, options = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A;
    const {
      disappearanceMode = "scan_ts",
      prevScanTs = null,
      scannedSeverities = null,
      prevScanIdBySeverity: prevScanIdBySeverity2 = null
    } = options;
    const updated = {};
    for (const [key, row] of Object.entries(existingLedger)) updated[key] = { ...row };
    const seen = /* @__PURE__ */ new Set();
    let newCount = 0;
    let resolvedCount = 0;
    let reopenedCount = 0;
    const scanTsIso = (_a = toIso(parseTs(scanTs))) != null ? _a : String(scanTs);
    for (const obs of observations) {
      if (obs.scope !== scope) {
        throw new Error(`reconcile(${scope}): observation ${obs.finding_key} carries scope ${obs.scope}`);
      }
      const key = obs.finding_key;
      if (seen.has(key)) continue;
      seen.add(key);
      const apiSaysResolved = !obs.is_open;
      const fixSignal = present(obs.fixed_version) || present(obs.fix_date);
      const seedFix = (r) => {
        if (r.fix_date == null && obs.fix_date !== null) r.fix_date = obs.fix_date;
        if (r.fix_observed_at == null && fixSignal) r.fix_observed_at = scanTsIso;
      };
      let row = updated[key];
      if (row === void 0) {
        row = makeRow(obs, (_b = minIso(obs.first_seen, scanTsIso)) != null ? _b : scanTsIso, scanId, scanTsIso);
        updated[key] = row;
        newCount += 1;
      } else if (row.status === STATUS_RESOLVED && !apiSaysResolved) {
        row.status = STATUS_OPEN;
        row.resolved_at = null;
        row.resolution_src = null;
        row.reopened_count = Number((_c = row.reopened_count) != null ? _c : 0) + 1;
        row.first_seen = (_d = minIso(obs.first_seen, scanTsIso)) != null ? _d : scanTsIso;
        row.last_seen = scanTsIso;
        row.last_scan_id = scanId;
        row.fix_date = null;
        row.fix_observed_at = null;
        seedFix(row);
        reopenedCount += 1;
      } else {
        if (row.status === STATUS_OPEN) {
          row.first_seen = (_e = minIso(row.first_seen, obs.first_seen)) != null ? _e : row.first_seen;
        }
        row.last_seen = scanTsIso;
        row.last_scan_id = scanId;
        seedFix(row);
      }
      mergeRiskSignals(row, obs, scanTsIso);
      row.severity = obs.severity;
      row.identifier = (_f = obs.identifier) != null ? _f : row.identifier;
      row.component = (_g = obs.component) != null ? _g : row.component;
      row.repo_id = (_h = obs.repo_id) != null ? _h : row.repo_id;
      row.repo_name = (_i = obs.repo_name) != null ? _i : row.repo_name;
      row.branch = (_j = obs.branch) != null ? _j : row.branch;
      row.platform = (_k = obs.platform) != null ? _k : row.platform;
      row.cwe = (_l = obs.cwe) != null ? _l : row.cwe;
      row.language = (_m = obs.language) != null ? _m : row.language;
      row.file_path = (_n = obs.file_path) != null ? _n : row.file_path;
      row.start_line = (_o = obs.start_line) != null ? _o : row.start_line;
      row.origin = (_p = obs.origin) != null ? _p : row.origin;
      row.secret_kind = (_q = obs.secret_kind) != null ? _q : row.secret_kind;
      row.confidence = (_r = obs.confidence) != null ? _r : row.confidence;
      row.owner_project = (_s = obs.owner_project) != null ? _s : row.owner_project;
      row.owner_path = (_t = obs.owner_path) != null ? _t : row.owner_path;
      row.tags_json = (_u = obs.tags_json) != null ? _u : row.tags_json;
      row.fixed_version = (_v = obs.fixed_version) != null ? _v : row.fixed_version;
      row.twin_count = (_w = obs.twin_count) != null ? _w : row.twin_count;
      row.twin_first_seen_spread_days = (_x = obs.twin_first_seen_spread_days) != null ? _x : row.twin_first_seen_spread_days;
      row.source_external_ids = (_y = obs.source_external_ids) != null ? _y : row.source_external_ids;
      if (obs.validation_state !== null && obs.validation_state !== "UNKNOWN") {
        row.validation_state = obs.validation_state;
        row.validated_at = obs.validated_at;
        row.rotated_at = obs.rotated_at;
      } else if (row.validation_state == null && obs.validation_state !== null) {
        row.validation_state = obs.validation_state;
        row.validated_at = obs.validated_at;
      }
      if (apiSaysResolved && row.status === STATUS_OPEN) {
        row.status = STATUS_RESOLVED;
        row.resolved_at = present(obs.resolved_at) ? obs.resolved_at : scanTsIso;
        row.resolution_src = RESOLUTION_API;
        resolvedCount += 1;
      }
    }
    if (prevScanId !== null) {
      const covered = scannedSeverities !== null ? new Set(scannedSeverities) : null;
      for (const [key, row] of Object.entries(updated)) {
        if (row.scope !== scope) continue;
        if (seen.has(key) || row.status === STATUS_RESOLVED) continue;
        if (covered !== null && (row.severity === null || !covered.has(row.severity))) {
          continue;
        }
        const expectedPrev = (_A = (prevScanIdBySeverity2 != null ? prevScanIdBySeverity2 : {})[(_z = row.severity) != null ? _z : ""]) != null ? _A : prevScanId;
        if (row.last_scan_id !== expectedPrev) continue;
        row.resolved_at = disappearanceMode === "midpoint" && prevScanTs ? midpointIso(prevScanTs, scanTsIso) : scanTsIso;
        row.status = STATUS_RESOLVED;
        row.resolution_src = RESOLUTION_DISAPPEARED;
        if (row.scope === "secrets") row.removed_at = row.resolved_at;
        resolvedCount += 1;
      }
    }
    return {
      ledger: updated,
      deltas: { new_count: newCount, resolved_count: resolvedCount, reopened_count: reopenedCount }
    };
  }

  // src/domain/secretsLedger.ts
  var DAY_MS2 = 864e5;
  var VALIDATION_RANK = {
    VALID: 0,
    INVALID: 1,
    ERROR: 2,
    UNKNOWN: 3
  };
  function normalizeValidation(v) {
    const s = typeof v === "string" ? v.toUpperCase().trim() : "";
    return s === "VALID" || s === "INVALID" || s === "ERROR" ? s : "UNKNOWN";
  }
  function str3(v) {
    const c = clean(v);
    return c === null ? null : String(c);
  }
  function secretsFindingKey(node) {
    var _a, _b;
    const line = clean(node["lineNumber"]);
    const basis = [
      (_a = str3(node["secretDataId"])) != null ? _a : "",
      (_b = str3(node["path"])) != null ? _b : "",
      line === null ? "" : String(line)
    ].join("|");
    return `secrets:h:${sha1Hex(basis).slice(0, 16)}`;
  }
  function severityRank(sev) {
    const i = SEVERITY_ORDER.indexOf(sev);
    return i === -1 ? SEVERITY_ORDER.length : i;
  }
  function resourceType(node) {
    const res = node["resource"];
    return res && typeof res === "object" ? str3(res["type"]) : null;
  }
  function resourceField(node, field) {
    const res = node["resource"];
    return res && typeof res === "object" ? str3(res[field]) : null;
  }
  function isOpen2(node) {
    const s = str3(node["status"]);
    return s === null ? true : !RESOLVED_STATUSES.has(s.toUpperCase());
  }
  function collapseTwins(nodes) {
    var _a, _b, _c, _d, _e, _f;
    const groups = groupBy(nodes, secretsFindingKey);
    const observations = [];
    let twinned = 0;
    let keyedWithoutLine = 0;
    for (const rows of groups.values()) {
      if (rows.length > 1) twinned += 1;
      if (clean(rows[0]["lineNumber"]) === null) keyedWithoutLine += rows.length;
      const births = rows.map((r) => parseTs(r["firstSeenAt"])).filter((t) => t !== null);
      const firstMs = births.length ? Math.min(...births) : null;
      const spreadDays = births.length > 1 ? (Math.max(...births) - Math.min(...births)) / DAY_MS2 : 0;
      const anyOpen = rows.some(isOpen2);
      const resolvedTs = rows.map((r) => parseTs(r["resolvedAt"])).filter((t) => t !== null);
      const resolvedMs = !anyOpen && resolvedTs.length === rows.length ? Math.max(...resolvedTs) : null;
      let severity = "UNKNOWN";
      for (const r of rows) {
        const s = normalizeSeverity(r["severity"]);
        if (severityRank(s) < severityRank(severity)) severity = s;
      }
      let best = rows[0];
      let bestState = normalizeValidation(best["validationStatus"]);
      for (const r of rows.slice(1)) {
        const state = normalizeValidation(r["validationStatus"]);
        if (VALIDATION_RANK[state] < VALIDATION_RANK[bestState]) {
          best = r;
          bestState = state;
        }
      }
      const validatedAt = toIso(parseTs(best["lastValidatedAt"]));
      const repoRow = (_a = rows.find((r) => resourceType(r) === "REPOSITORY")) != null ? _a : rows[0];
      const branchRow = (_b = rows.find((r) => resourceType(r) === "REPOSITORY_BRANCH")) != null ? _b : null;
      const repoName = resourceField(repoRow, "name");
      const branchName = branchRow === null ? null : resourceField(branchRow, "name");
      const branch = branchName !== null && repoName !== null && branchName.startsWith(`${repoName}/`) ? branchName.slice(repoName.length + 1) : branchName;
      const projects = Array.isArray(rows[0]["projects"]) ? rows[0]["projects"] : [];
      const owner = (_d = (_c = projects.find((p) => p && p["isFolder"] !== true)) != null ? _c : projects[0]) != null ? _d : null;
      const path = str3(repoRow["path"]);
      const line = clean(repoRow["lineNumber"]);
      observations.push({
        ...emptyObservation("secrets", secretsFindingKey(repoRow)),
        identifier: str3(repoRow["secretDataId"]),
        component: path === null ? null : line === null ? path : `${path}:${String(line)}`,
        severity,
        secret_kind: str3(repoRow["type"]),
        confidence: str3(repoRow["confidence"]),
        repo_id: resourceField(repoRow, "id"),
        repo_name: repoName,
        branch,
        platform: resourceField(repoRow, "cloudPlatform"),
        file_path: path,
        start_line: typeof line === "number" ? line : line === null ? null : Number(line),
        origin: str3(
          (_f = (_e = repoRow["vcsDetails"]) == null ? void 0 : _e["initialCommitHash"]) != null ? _f : null
        ),
        first_seen: toIso(firstMs),
        // `is_open`, not a status: an observation reports what the API said, and only a
        // sequence of scans can turn that into a lifecycle. Reconcile owns the status column.
        is_open: anyOpen,
        resolved_at: toIso(resolvedMs),
        validation_state: bestState,
        validated_at: validatedAt,
        // ONLY on INVALID. rotated_at means "observed dead at this time"; setting it from a
        // VALID or an UNKNOWN check would publish an unmeasured credential as rotated, which
        // on a register that is 99.6% UNKNOWN is the absent-is-never-zero failure at scale.
        rotated_at: bestState === "INVALID" ? validatedAt : null,
        // removed_at stays null (emptyObservation's default): the string leaving HEAD is a
        // DISAPPEARANCE, visible only by comparing two scans. The normalizer sees one.
        owner_project: owner === null ? null : str3(owner["name"]),
        owner_path: owner === null ? null : str3(owner["slug"]),
        twin_count: rows.length,
        twin_first_seen_spread_days: spreadDays,
        source_external_ids: JSON.stringify(
          rows.map((r) => str3(r["externalId"])).filter((v) => v !== null)
        )
      });
    }
    return {
      observations,
      nodes: nodes.length,
      findings: observations.length,
      twinned,
      keyed_without_line: keyedWithoutLine
    };
  }

  // src/server/sync.ts
  function observationsFor(scope, nodes) {
    if (scope === "secrets") {
      const folded = collapseTwins(nodes);
      return { observations: folded.observations, keyedWithoutLine: folded.keyed_without_line };
    }
    const normalize = NORMALIZERS[scope];
    return { observations: nodes.map((n) => normalize(n)) };
  }
  function sampleSource(dataset) {
    return { mode: "sample", nodes: (scope) => {
      var _a;
      return (_a = dataset[scope]) != null ? _a : [];
    } };
  }
  function runScan(scope, source, opts) {
    var _a, _b, _c, _d, _e;
    const ts = (_a = opts.ts) != null ? _a : nowIso();
    const scans = readScans();
    const already = existingScanDeltas(scans, opts.scanId);
    if (already) {
      return {
        scan_id: opts.scanId,
        scope,
        ts,
        mode: source.mode,
        nodes: 0,
        findings: 0,
        deltas: already,
        alreadyRecorded: true
      };
    }
    const nodes = source.nodes(scope);
    const { observations, keyedWithoutLine } = observationsFor(scope, nodes);
    const requested = opts.severities !== void 0 ? opts.severities : (_c = (_b = loadSettings().fetchSeverities) == null ? void 0 : _b[scope]) != null ? _c : DEFAULT_FETCH_SEVERITIES[scope];
    const scannedSeverities = requested && requested.length ? [...requested] : null;
    const prev = latestScan(scans, scope);
    const prevBySev = prevScanIdBySeverity(scans, scope);
    const result = reconcile(
      observations,
      readLedger(),
      scope,
      opts.scanId,
      ts,
      (_d = prev == null ? void 0 : prev.scan_id) != null ? _d : null,
      {
        scannedSeverities,
        prevScanIdBySeverity: prevBySev,
        prevScanTs: (_e = prev == null ? void 0 : prev.ts) != null ? _e : null
      }
    );
    writeLedger(result.ledger);
    appendScan({
      scan_id: opts.scanId,
      ts,
      scope,
      mode: source.mode,
      severities: scannedSeverities,
      total: observations.length,
      ...result.deltas
    });
    return {
      scan_id: opts.scanId,
      scope,
      ts,
      mode: source.mode,
      nodes: nodes.length,
      findings: observations.length,
      deltas: result.deltas,
      alreadyRecorded: false,
      ...keyedWithoutLine === void 0 ? {} : { keyed_without_line: keyedWithoutLine }
    };
  }

  // src/server/archiveStore.ts
  var rootFolderMemo;
  var subfolderMemo = /* @__PURE__ */ new Map();
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
  function writeGzJson(folder, name, payload) {
    const json = JSON.stringify(payload);
    const blob = Utilities.gzip(Utilities.newBlob(json, "application/json"), name);
    const existing = folder.getFilesByName(name);
    while (existing.hasNext()) existing.next().setTrashed(true);
    return folder.createFile(blob);
  }
  function readGzJsonNamed(folder, name) {
    const it = subfolder(folder).getFilesByName(name);
    if (!it.hasNext()) return null;
    return parseGzBlob(it.next().getBlob());
  }
  function parseGzBlob(blob) {
    try {
      const bytes = blob.getBytes();
      const isGzip = bytes.length > 2 && (bytes[0] & 255) === 31 && (bytes[1] & 255) === 139;
      const text = isGzip ? Utilities.ungzip(blob).getDataAsString("UTF-8") : blob.getDataAsString("UTF-8");
      return JSON.parse(text);
    } catch (e) {
      console.warn(`Failed to parse archive blob: ${e}`);
      return null;
    }
  }

  // src/server/readModelStore.ts
  var FOLDER = "readmodels";
  var ENVELOPE_V = 1;
  var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
  var warming = false;
  var touched = null;
  var disabled = false;
  function readModelFileName(name, params) {
    return `rm-${name}-${paramsHash(params)}.json.gz`;
  }
  function l2Read(name, params, version) {
    if (disabled) return { hit: false, why: "absent" };
    try {
      const raw = readGzJsonNamed(FOLDER, readModelFileName(name, params));
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
      writeGzJson(subfolder(FOLDER), readModelFileName(name, params), env);
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

  // src/server/registers.ts
  function tally(into, key) {
    var _a;
    const k = key === null || key === void 0 || key === "" ? "(none)" : key;
    into[k] = ((_a = into[k]) != null ? _a : 0) + 1;
  }
  function facetsFor(rows) {
    var _a;
    const facets = { severity: {}, repo: {}, status: {}, validation: {} };
    for (const r of rows) {
      tally(facets.severity, normalizeSeverity(r.severity));
      tally(facets.repo, r.repo_name);
      tally(facets.status, r.status);
      if (r.scope === "secrets") tally(facets.validation, (_a = r.validation_state) != null ? _a : "UNKNOWN");
    }
    return facets;
  }
  function matches(row, q) {
    var _a, _b;
    if (q.severities && q.severities.length && !q.severities.includes(normalizeSeverity(row.severity))) return false;
    if (q.repo && ((_a = row.repo_name) != null ? _a : "(none)") !== q.repo) return false;
    if (q.status === "open" && row.status !== "OPEN") return false;
    if (q.status === "resolved" && row.status !== "RESOLVED") return false;
    if (q.validation && ((_b = row.validation_state) != null ? _b : "UNKNOWN") !== q.validation) return false;
    if (q.awaitingVendor && !row.awaiting_vendor_fix) return false;
    return true;
  }
  var SEV_RANK = {};
  SEVERITY_ORDER.forEach((s, i) => {
    SEV_RANK[s] = i;
  });
  function sortRows(rows, sort) {
    if (!sort) return rows;
    const desc = sort.startsWith("-");
    const key = desc ? sort.slice(1) : sort;
    const value = (r) => {
      var _a;
      return key === "severity" ? (_a = SEV_RANK[normalizeSeverity(r.severity)]) != null ? _a : 99 : r[key];
    };
    const out = [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null || va === void 0) return vb === null || vb === void 0 ? 0 : 1;
      if (vb === null || vb === void 0) return -1;
      return cmp(va, vb);
    });
    return desc ? out.reverse() : out;
  }
  function scopeRows(scope) {
    return baseRows(Object.values(readLedger()).filter((r) => r.scope === scope));
  }
  function registerPage(q, page, pageSize, sort) {
    const all = durablyCached(`register-rows-1`, { scope: q.scope }, () => scopeRows(q.scope), 3600);
    const facets = durablyCached(`register-facets-1`, { scope: q.scope }, () => facetsFor(all), 3600);
    const filtered = sortRows(all.filter((r) => matches(r, q)), sort);
    const size = Math.min(500, Math.max(1, pageSize));
    const pageCount = Math.max(1, Math.ceil(filtered.length / size));
    const at2 = Math.min(Math.max(0, page), pageCount - 1);
    let open = 0;
    let disappeared = 0;
    let awaiting = 0;
    for (const r of filtered) {
      if (r.status === "OPEN") open += 1;
      else if (r.resolution_src === "disappeared") disappeared += 1;
      if (r.awaiting_vendor_fix) awaiting += 1;
    }
    return {
      scope: q.scope,
      total: filtered.length,
      scopeTotal: all.length,
      page: at2,
      pageCount,
      pageSize: size,
      rows: filtered.slice(at2 * size, (at2 + 1) * size),
      facets,
      summary: {
        open,
        resolved: filtered.length - open,
        disappeared,
        awaitingVendor: awaiting
      }
    };
  }

  // src/server/jobsStore.ts
  var ACTIVE_JOB_PROP = "ACTIVE_JOB_ID";
  function normError(v) {
    const s = v == null ? "" : String(v).trim();
    return s === "" || s === "null" || s === "undefined" ? null : s;
  }
  function updateJob(jobId, patch, now) {
    updateWhere(TABS.jobs, "job_id", jobId, {
      ...patch,
      updated_at: nowIso(now)
    });
    if (patch.phase && TERMINAL.includes(patch.phase)) deleteProp(ACTIVE_JOB_PROP);
  }
  function rowToJob(r) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
    return {
      job_id: String((_a = r["job_id"]) != null ? _a : ""),
      kind: (_b = r["kind"]) != null ? _b : "sync",
      phase: (_c = r["phase"]) != null ? _c : "FAILED",
      sync_id: (_d = r["sync_id"]) != null ? _d : null,
      step_index: Number((_e = r["step_index"]) != null ? _e : 0),
      cursor: (_f = r["cursor"]) != null ? _f : null,
      page: Number((_g = r["page"]) != null ? _g : 0),
      nodes_so_far: Number((_h = r["nodes_so_far"]) != null ? _h : 0),
      total_count: Number((_i = r["total_count"]) != null ? _i : 0),
      part_refs_json: (_j = r["part_refs_json"]) != null ? _j : null,
      params_json: (_k = r["params_json"]) != null ? _k : null,
      error: normError(r["error"]),
      started_at: String((_l = r["started_at"]) != null ? _l : ""),
      updated_at: String((_m = r["updated_at"]) != null ? _m : "")
    };
  }
  function listJobs() {
    return readAll(TABS.jobs).map(rowToJob);
  }
  var TERMINAL = ["DONE", "FAILED", "CANCELLED"];
  function activeJob() {
    var _a;
    if (!getProp(ACTIVE_JOB_PROP)) return null;
    const job = (_a = listJobs().find((j) => !TERMINAL.includes(j.phase))) != null ? _a : null;
    if (!job) deleteProp(ACTIVE_JOB_PROP);
    return job;
  }

  // src/server/locks.ts
  var LedgerBusyError = class extends Error {
  };
  var DEAD_JOB_MS = 30 * 60 * 1e3;
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
    const updated = parseTs(job.updated_at);
    const ageMs = updated === null ? Infinity : (now != null ? now : Date.now()) - updated;
    if (job.phase === "PERSISTING" || ageMs > DEAD_JOB_MS) {
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Recovered: execution died mid-sync; the last committed snapshot is unchanged."
      });
    }
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
        if (!latest || ts > latest.finished_at) {
          latest = {
            scan_id: String((_b = row.scan_id) != null ? _b : ""),
            finished_at: ts,
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
  function runSampleSync(_p) {
    return mutate(() => {
      var _a, _b;
      if (!SAMPLE_SCANS.length) {
        throw new Error(
          "No sample dataset in this bundle. The deployed bundle ships none on purpose \u2014 a register must show what its tenant has. Run `npm run dev`, which aliases the dev dataset in."
        );
      }
      const scans = [];
      for (const s of SAMPLE_SCANS) {
        for (const scope of SCOPES) {
          scans.push(runScan(scope, sampleSource(s.nodes), {
            scanId: `${s.id}-${scope}`,
            ts: s.ts,
            // The gate THIS scan applied, not the one the settings hold now.
            severities: (_b = (_a = s.gates) == null ? void 0 : _a[scope]) != null ? _b : null
          }));
        }
      }
      return { scans, seeded: true };
    });
  }
  function getMttr(p) {
    return run(() => {
      var _a;
      const wanted = (p == null ? void 0 : p.scope) && SCOPES.includes(p.scope) ? p.scope : null;
      const all = Object.values(readLedger());
      const rows = baseRows(wanted === null ? all : all.filter((r) => r.scope === wanted));
      const byScope = {};
      for (const r of rows) byScope[r.scope] = ((_a = byScope[r.scope]) != null ? _a : 0) + 1;
      const open = rows.filter((r) => r.status === "OPEN").length;
      const scans = readScans();
      const lastScanByScope = {};
      for (const scope of SCOPES) {
        const forScope = scans.filter((s) => s.scope === scope);
        const last = forScope.length ? forScope[forScope.length - 1] : null;
        lastScanByScope[scope] = last ? { scan_id: last.scan_id, ts: last.ts } : null;
      }
      return {
        scope: wanted,
        km: kaplanMeier(rows),
        percentiles: mttrPercentiles(rows),
        openAge: openAgePercentiles(rows),
        buckets: resolutionBuckets(rows),
        sla: openPastSla(rows),
        vendor: awaitingVendorFix(rows),
        population: { total: rows.length, open, resolved: rows.length - open, byScope },
        lastScanByScope
      };
    });
  }
  function readList(v) {
    if (Array.isArray(v)) return v.map((x) => String(x).toUpperCase()).filter(Boolean);
    const s = String(v != null ? v : "").trim();
    if (!s) return null;
    return s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  }
  function getRegister(p) {
    return run(() => {
      var _a, _b, _c;
      const params = p != null ? p : {};
      const scope = String((_a = params["scope"]) != null ? _a : "");
      if (!SCOPES.includes(scope)) {
        throw new Error(`Unknown register scope "${scope}" \u2014 expected one of ${SCOPES.join(", ")}.`);
      }
      const q = {
        scope,
        severities: readList(params["severities"]),
        repo: params["repo"] || null,
        status: params["status"] || null,
        validation: params["validation"] || null,
        awaitingVendor: params["awaitingVendor"] === true || params["awaitingVendor"] === "1"
      };
      return registerPage(
        q,
        Math.max(0, Number((_b = params["page"]) != null ? _b : 0)),
        Number((_c = params["pageSize"]) != null ? _c : 50),
        params["sort"] || null
      );
    });
  }
  function getExecutive(_p) {
    return run(() => {
      var _a, _b, _c;
      const rows = baseRows(Object.values(readLedger()));
      const scans = readScans();
      const openBySeverity = {};
      const totals = {};
      for (const scope of SCOPES) {
        openBySeverity[scope] = {};
        totals[scope] = { open: 0, resolved: 0, total: 0 };
      }
      for (const r of rows) {
        const t = (_a = totals[r.scope]) != null ? _a : totals[r.scope] = { open: 0, resolved: 0, total: 0 };
        t.total += 1;
        if (r.status === "OPEN") {
          t.open += 1;
          const bucket = (_b = openBySeverity[r.scope]) != null ? _b : openBySeverity[r.scope] = {};
          bucket[r.severity] = ((_c = bucket[r.severity]) != null ? _c : 0) + 1;
        } else {
          t.resolved += 1;
        }
      }
      const lastScan = {};
      const movement = {};
      for (const scope of SCOPES) {
        const mine = scans.filter((s) => s.scope === scope);
        const last = mine.length ? mine[mine.length - 1] : null;
        lastScan[scope] = last ? { scan_id: last.scan_id, ts: last.ts, severities: last.severities } : null;
        movement[scope] = last ? {
          new_count: last.new_count,
          resolved_count: last.resolved_count,
          reopened_count: last.reopened_count
        } : null;
      }
      return {
        km: kaplanMeier(rows),
        openBySeverity,
        totals,
        lastScan,
        movement,
        everScanned: scans.length > 0,
        // From the scans tab's own `mode` column, not a scan_id prefix: a naming
        // convention is something a later caller forgets, and a page claiming real data
        // over sample rows is the worst lie this product could tell.
        sampleOnly: scans.length > 0 && scans.every((s) => s.mode !== "live")
      };
    });
  }
  return __toCommonJS(index_exports);
})();
