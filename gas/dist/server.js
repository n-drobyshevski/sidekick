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
    backfill: () => backfillJobs_exports,
    doGet: () => doGet,
    include: () => include,
    jobs: () => scanJobs_exports,
    purge: () => purgeJobs_exports,
    setup: () => setup,
    welcome: () => welcome_exports,
    wizDiagnostic: () => wizDiagnostic
  });

  // src/server/main.ts
  function doGet(_e) {
    const template = HtmlService.createTemplateFromFile("index");
    return template.evaluate().setTitle("Wiz Sidekick OS").addMetaTag("viewport", "width=device-width, initial-scale=1").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }
  function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }

  // src/server/access.ts
  var access_exports = {};
  __export(access_exports, {
    PRODUCT: () => PRODUCT,
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
      "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;",
      "background:#f8fafc;color:#0a0a0a;",
      "font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
      ".card{max-width:32rem;margin:24px;padding:32px;background:#fff;border:1px solid #e2e8f0;",
      "border-radius:14px;box-shadow:0 1px 2px rgba(10,10,10,.06)}",
      ".lockup{display:flex;align-items:center;gap:8px;margin:0 0 16px}",
      // Mirrors .appbar-name in styles.css (600 / 1rem / -0.02em) so the wordmark is the same
      // object here as in the header, not a near-miss of it.
      ".lockup span{font-weight:600;font-size:1rem;letter-spacing:-0.02em;color:#0a0a0a;",
      "white-space:nowrap}",
      ".brand-mark{display:block;flex:0 0 auto}",
      "h1{font-size:20px;line-height:1.3;margin:0 0 12px;font-weight:650}",
      "p{margin:0 0 8px;font-size:14px;line-height:1.6;color:#334155}",
      ".actions{margin-top:24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}",
      // Graphite, not the blue accent: DESIGN.md keeps Signal Blue for data, focus and links, and
      // fills the one committing action with the neutral near-black.
      ".btn{display:inline-flex;align-items:center;min-height:36px;padding:6px 14px;",
      "border-radius:8px;background:#0a0a0a;color:#fafafa;font-size:14px;font-weight:500;",
      "text-decoration:none}",
      ".btn:hover{background:#27272a}",
      "a{color:#2563eb}",
      // Never remove: CLAUDE.md names the focus-ring rules load-bearing, and these pages are
      // reachable by keyboard only.
      "a:focus-visible{outline:2px solid #2563eb;outline-offset:2px;border-radius:4px}",
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
    wizSupportGroupTagKey: "WIZ_SUPPORT_GROUP_TAG_KEY",
    wizDomainTagKey: "WIZ_DOMAIN_TAG_KEY",
    // Who may use the web app, on top of the deployment's domain fence. Comma-, semicolon- or
    // whitespace-separated addresses; see access.ts. UNSET MEANS OWNER-ONLY, not "everyone" —
    // the guard fails closed, and the owner is allowed by identity rather than by this list.
    allowedUsers: "ALLOWED_USERS",
    // Who may EDIT the list above from Settings → Access, on top of the owner (who always may).
    // Unset means owner-only, like its sibling. Admins are allowed into the app by being admins,
    // and deliberately CANNOT edit this property — see access.ts for why the tier stops here.
    allowedAdmins: "ALLOWED_ADMINS",
    ledgerSpreadsheetId: "LEDGER_SPREADSHEET_ID",
    archiveFolderId: "ARCHIVE_FOLDER_ID",
    // The warm schedule setup() last installed. A ClockTrigger exposes no hour, minute or
    // timezone, so this is the only way a later edit to the schedule can be detected and
    // reconciled rather than silently ignored on an existing deployment.
    warmTriggerSchedule: "WARM_TRIGGER_SCHEDULE"
  };
  var DEFAULT_WIZ_AUTH_URL = "https://auth.app.wiz.io/oauth/token";
  var DEFAULT_SUPPORT_GROUP_TAG_KEY = "Wiz/provisioning";
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
  var PRODUCT = "Wiz Sidekick OS";
  var DENIAL_MESSAGE = {
    anonymous: "This app can't identify your Google account. It only recognizes accounts signed in to the same Google Workspace domain as the app.",
    "not-listed": "Your account isn't on this app's access list."
  };
  function parseAllowlist(raw) {
    if (!raw) return [];
    const seen2 = {};
    const out = [];
    for (const part of raw.split(/[,;\s]+/)) {
      const email = part.trim().toLowerCase();
      if (!email || seen2[email]) continue;
      seen2[email] = true;
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

  // src/domain/util.ts
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
    const parsed = values.map(parseTs).filter((t) => t !== null);
    return parsed.length ? toIso(minNum(parsed)) : null;
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
  function maxNum(values) {
    return values.reduce((m, v) => Math.max(m, v), -Infinity);
  }
  function minNum(values) {
    return values.reduce((m, v) => Math.min(m, v), Infinity);
  }
  function pushAll(target, items) {
    for (const item of items) target.push(item);
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

  // src/domain/domainTag.ts
  var DEFAULT_DOMAIN_TAG_KEY = "Wiz/Domain";
  function domainOfTags(tags, key = DEFAULT_DOMAIN_TAG_KEY) {
    const want = key.trim().toLowerCase();
    if (!want || !tags) return null;
    for (const [k, v] of Object.entries(tags)) {
      if (String(k).trim().toLowerCase() !== want) continue;
      if (!present(v)) continue;
      const value = String(v).trim();
      if (value) return value;
    }
    return null;
  }
  function resolveDomainTagKey(configured) {
    const k = (configured != null ? configured : "").trim();
    return k || DEFAULT_DOMAIN_TAG_KEY;
  }

  // src/server/serverCache.ts
  var VERSION_PROP = "DATA_VERSION";
  var KEY_PREFIX = "wsk";
  var BUILD_ID = true ? "a333d663df67" : "dev";
  var CHUNK_CHARS = 9e4;
  var DEFAULT_TTL_SEC = 21600;
  function dataVersion() {
    var _a;
    return (_a = getProp(VERSION_PROP)) != null ? _a : "0";
  }
  function domainTagStamp() {
    return sha1Hex(resolveDomainTagKey(getProp(PROP_KEYS.wizDomainTagKey))).slice(0, 8);
  }
  var versionStamp;
  function stamp() {
    if (versionStamp === void 0) {
      versionStamp = `${BUILD_ID}.${dataVersion()}.${domainTagStamp()}`;
    }
    return versionStamp;
  }
  function bumpDataVersion() {
    const now = Date.now();
    const prev = Number(dataVersion());
    setProp(VERSION_PROP, String(Number.isFinite(prev) && prev >= now ? prev + 1 : now));
    versionStamp = void 0;
  }
  function paramsHash(params) {
    return sha1Hex(JSON.stringify(params != null ? params : null)).slice(0, 12);
  }
  function cacheKey(name, params, version) {
    return `${KEY_PREFIX}:${version}:${name}:${paramsHash(params)}`;
  }
  function currentStamp() {
    return stamp();
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
  function cached(name, params, compute, ttlSec = DEFAULT_TTL_SEC) {
    let key = null;
    try {
      key = cacheKey(name, params, stamp());
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

  // src/server/archiveStore.ts
  var SUBFOLDERS = [
    "scans",
    "obs",
    "checkpoints",
    "snapshots",
    "backups",
    "imports",
    "exports",
    // Durable read-model cache (readModelStore.ts). Created on demand by subfolder(), so a
    // deployment that never re-runs setup() still self-heals on the first write.
    "readmodels"
  ];
  function rootFolder() {
    return DriveApp.getFolderById(requireProp(PROP_KEYS.archiveFolderId));
  }
  function childFolder(parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }
  function subfolder(name) {
    return childFolder(rootFolder(), name);
  }
  function ensureFolders(rootId) {
    const root = rootId ? DriveApp.getFolderById(rootId) : rootFolder();
    for (const name of SUBFOLDERS) childFolder(root, name);
    return root.getId();
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
  function readGzJsonFile(fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      return parseGzBlob(file.getBlob());
    } catch (e) {
      console.warn(`Unreadable Drive file ${fileId}: ${e}`);
      return null;
    }
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
  function scanFolder(scanId) {
    return childFolder(subfolder("scans"), safeName(scanId));
  }
  function writeScanPage(scanId, pageNumber, payload) {
    const name = `page-${String(pageNumber).padStart(4, "0")}.json.gz`;
    return writeGzJson(scanFolder(scanId), name, payload).getId();
  }
  function readScanPage(scanId, pageNumber) {
    const name = `page-${String(pageNumber).padStart(4, "0")}.json.gz`;
    const files = scanFolder(scanId).getFilesByName(name);
    return files.hasNext() ? parseGzBlob(files.next().getBlob()) : null;
  }
  function writeSlimRecords(scanId, records) {
    return writeGzJson(scanFolder(scanId), "slim.json.gz", records).getId();
  }
  function readSlimRecords(scanId) {
    const files = scanFolder(scanId).getFilesByName("slim.json.gz");
    if (!files.hasNext()) return null;
    const parsed = parseGzBlob(files.next().getBlob());
    return Array.isArray(parsed) ? parsed : null;
  }
  var FRAME_NAME = "frame-v1.json.gz";
  function writeFrame(scanId, records) {
    return writeGzJson(scanFolder(scanId), FRAME_NAME, records).getId();
  }
  function readFrame(scanId) {
    const files = scanFolder(scanId).getFilesByName(FRAME_NAME);
    if (!files.hasNext()) return null;
    const parsed = parseGzBlob(files.next().getBlob());
    return Array.isArray(parsed) ? parsed : null;
  }
  var PAGE_RUNS_NAME = "pageruns.json.gz";
  function writePageRuns(scanId, runs) {
    writeGzJson(scanFolder(scanId), PAGE_RUNS_NAME, runs);
  }
  function readPageRuns(scanId) {
    const files = scanFolder(scanId).getFilesByName(PAGE_RUNS_NAME);
    if (!files.hasNext()) return null;
    const parsed = parseGzBlob(files.next().getBlob());
    return Array.isArray(parsed) ? parsed : null;
  }
  function readScanPayload(scanRef) {
    if (!scanRef) return null;
    let folder;
    try {
      folder = DriveApp.getFolderById(scanRef);
    } catch {
      return null;
    }
    const pages = [];
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      if (!/^page-\d+\.json(\.gz)?$/.test(name)) continue;
      const payload = parseGzBlob(f.getBlob());
      if (payload === null) return null;
      pages.push({ name, payload });
    }
    if (!pages.length) return null;
    pages.sort((a, b) => a.name < b.name ? -1 : 1);
    return pages.map((p) => p.payload);
  }
  function scanArchiveBytes(scanRef, obsRef) {
    let total = 0;
    if (scanRef) {
      try {
        const files = DriveApp.getFolderById(scanRef).getFiles();
        while (files.hasNext()) total += files.next().getSize();
      } catch {
      }
    }
    if (obsRef) {
      try {
        total += DriveApp.getFileById(obsRef).getSize();
      } catch {
      }
    }
    return total;
  }
  function trashScanArchive(scanRef) {
    if (!scanRef) return;
    try {
      DriveApp.getFolderById(scanRef).setTrashed(true);
    } catch (e) {
      console.warn(`Couldn't trash scan archive ${scanRef}: ${e}`);
    }
  }
  function writeObservations(scanId, observations) {
    return writeGzJson(subfolder("obs"), `obs-${safeName(scanId)}.json.gz`, observations).getId();
  }
  function readObservations(obsRef) {
    if (!obsRef) return [];
    const parsed = readGzJsonFile(obsRef);
    return Array.isArray(parsed) ? parsed : [];
  }
  function trashFile(fileId) {
    if (!fileId) return;
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (e) {
      console.warn(`Couldn't trash file ${fileId}: ${e}`);
    }
  }
  function writeCheckpoint(compactionId, checkpoint) {
    return writeGzJson(
      subfolder("checkpoints"),
      `checkpoint-${safeName(compactionId)}.json.gz`,
      checkpoint
    ).getId();
  }
  function readCheckpoint(ref) {
    var _a, _b, _c;
    if (!ref) return null;
    const parsed = readGzJsonFile(ref);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed;
    if (Array.isArray(obj["parts"])) {
      const ledger = [];
      for (const partId of obj["parts"]) {
        const part = readGzJsonFile(partId);
        if (Array.isArray(part)) for (const row of part) ledger.push(row);
      }
      return {
        version: Number((_a = obj["version"]) != null ? _a : 1),
        floor_scan_id: (_b = obj["floor_scan_id"]) != null ? _b : null,
        floor_ts: (_c = obj["floor_ts"]) != null ? _c : null,
        ledger
      };
    }
    return parsed;
  }
  var CHECKPOINT_PART_ROWS = 2e4;
  function rewriteCheckpoint(compactionId, prevRef, checkpoint) {
    var _a;
    const prev = prevRef ? readGzJsonFile(prevRef) : null;
    const prevParts = prev && typeof prev === "object" && !Array.isArray(prev) ? prev["parts"] : null;
    if (!Array.isArray(prevParts)) return writeCheckpoint(compactionId, checkpoint);
    const rows = (_a = checkpoint.ledger) != null ? _a : [];
    const partIds = [];
    for (let i = 0, idx = 0; i < rows.length; i += CHECKPOINT_PART_ROWS, idx += 1) {
      partIds.push(writeCheckpointPart(compactionId, idx, rows.slice(i, i + CHECKPOINT_PART_ROWS)));
    }
    const ref = writeCheckpointManifest(compactionId, {
      version: checkpoint.version,
      floor_scan_id: checkpoint.floor_scan_id,
      floor_ts: checkpoint.floor_ts,
      parts: partIds
    });
    for (const id of prevParts) {
      if (typeof id === "string" && !partIds.includes(id)) trashFile(id);
    }
    return ref;
  }
  function listScanPageNumbers(scanRef) {
    if (!scanRef) return [];
    let folder;
    try {
      folder = DriveApp.getFolderById(scanRef);
    } catch {
      return [];
    }
    const nums = [];
    const files = folder.getFiles();
    while (files.hasNext()) {
      const m = /^page-(\d+)\.json(\.gz)?$/.exec(files.next().getName());
      if (m) nums.push(Number(m[1]));
    }
    return nums.sort((a, b) => a - b);
  }
  function trashPageRuns(scanId) {
    try {
      const files = scanFolder(scanId).getFilesByName(PAGE_RUNS_NAME);
      while (files.hasNext()) files.next().setTrashed(true);
    } catch (e) {
      console.warn(`Couldn't trash page runs for ${scanId}: ${e}`);
    }
  }
  var SNAPSHOT_NAME = "ledger-snapshot.json.gz";
  function writeLedgerSnapshot(state) {
    const snap = { version: 1, ledger: state.ledger, episodes: state.episodes };
    writeGzJson(subfolder("snapshots"), SNAPSHOT_NAME, snap);
  }
  function readLedgerSnapshot() {
    const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
    if (!files.hasNext()) return null;
    const parsed = parseGzBlob(files.next().getBlob());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const snap = parsed;
    return snap.ledger && snap.episodes ? snap : null;
  }
  function writeJournal(jobId, state) {
    return writeGzJson(subfolder("backups"), `backup-${safeName(jobId)}.json.gz`, state).getId();
  }
  function readJournal(ref) {
    if (!ref) return null;
    const parsed = readGzJsonFile(ref);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const st = parsed;
    return st.scans && st.ledger && st.episodes ? st : null;
  }
  function writeMigrationExport(name, bundle) {
    const file = writeGzJson(subfolder("exports"), name, bundle);
    return { name, url: file.getDownloadUrl(), bytes: file.getSize() };
  }
  function readGzJsonNamed(folder, name) {
    const files = subfolder(folder).getFilesByName(name);
    return files.hasNext() ? parseGzBlob(files.next().getBlob()) : null;
  }
  function listNames(folder) {
    const out = [];
    const files = subfolder(folder).getFiles();
    while (files.hasNext()) out.push(files.next().getName());
    return out;
  }
  function trashNamed(folder, name) {
    const files = subfolder(folder).getFilesByName(name);
    while (files.hasNext()) files.next().setTrashed(true);
  }
  function trashLedgerSnapshot() {
    const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
    while (files.hasNext()) files.next().setTrashed(true);
  }
  function importFolder(sessionId) {
    return childFolder(subfolder("imports"), safeName(sessionId));
  }
  function writeImportManifest(sessionId, manifest) {
    return writeGzJson(importFolder(sessionId), "manifest.json.gz", manifest).getId();
  }
  function readImportManifest(sessionId) {
    const files = importFolder(sessionId).getFilesByName("manifest.json.gz");
    return files.hasNext() ? parseGzBlob(files.next().getBlob()) : null;
  }
  function stageShard(sessionId, index, payload) {
    const name = `shard-${String(index + 1).padStart(4, "0")}.json.gz`;
    return writeGzJson(importFolder(sessionId), name, payload).getId();
  }
  function writeCheckpointPart(compactionId, index, rows) {
    const name = `checkpoint-${safeName(compactionId)}-part-${String(index + 1).padStart(4, "0")}.json.gz`;
    return writeGzJson(subfolder("checkpoints"), name, rows).getId();
  }
  function writeCheckpointManifest(compactionId, manifest) {
    return writeGzJson(
      subfolder("checkpoints"),
      `checkpoint-${safeName(compactionId)}.json.gz`,
      manifest
    ).getId();
  }
  function trashImportSession(sessionId) {
    try {
      importFolder(sessionId).setTrashed(true);
    } catch (e) {
      console.warn(`trashImportSession(${sessionId}): ${e}`);
    }
  }

  // src/server/sheetsDb.ts
  var TABS = {
    scans: "scans",
    vulnLedger: "vuln_ledger",
    episodes: "resolved_episodes",
    compactions: "compactions",
    settings: "settings",
    supportGroupMap: "support_group_map",
    mttrHistory: "mttr_history",
    schemaMeta: "schema_meta",
    jobs: "jobs"
  };
  var TAB_HEADERS = {
    [TABS.scans]: [
      "scan_id",
      "ts",
      "mode",
      "shape",
      "total",
      "new_count",
      "resolved_count",
      "reopened_count",
      "raw_ref",
      "obs_ref",
      "severities",
      "sealed"
    ],
    [TABS.vulnLedger]: [
      "vuln_key",
      "cve",
      "severity",
      "asset_id",
      "asset_name",
      "asset_type",
      "cloud",
      "first_seen",
      "last_seen",
      "status",
      "resolved_at",
      "resolution_src",
      "reopened_count",
      "first_scan_id",
      "last_scan_id",
      "subscription_name",
      "subscription_ext_id",
      "tags_json",
      "fix_date",
      "fix_observed_at",
      "has_kev",
      "has_exploit",
      "epss",
      "risk_observed_at"
    ],
    [TABS.episodes]: [
      "vuln_key",
      "cve",
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
      "risk_observed_at",
      // The resource's tag bag, carried through compaction so a sealed episode keeps the
      // `Wiz/Domain` tag its domain is read from. See the comment on EpisodeRow.
      "tags_json"
    ],
    [TABS.compactions]: [
      "compaction_id",
      "ts",
      "floor_scan_id",
      "floor_ts",
      "scans_sealed",
      "episodes_created",
      "observations_pruned",
      "archive_bytes_freed",
      "db_bytes_freed",
      "checkpoint_ref"
    ],
    [TABS.settings]: ["key", "value_json"],
    // One tiny row per subscription-identity → support-group entry. Deliberately NOT a single
    // JSON blob in a settings cell: a large map (hundreds of subscriptions × several identity
    // tokens each) overflows the ~50k-char Sheets per-cell limit and the whole write throws.
    [TABS.supportGroupMap]: ["token", "group"],
    [TABS.mttrHistory]: [
      "date",
      "median_days",
      "resolved",
      "open",
      "total",
      "sla_pct",
      "oldest_open_days",
      "open_past_sla"
    ],
    [TABS.schemaMeta]: ["version"],
    [TABS.jobs]: [
      "job_id",
      "kind",
      "phase",
      "scan_id",
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
    ]
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
        ensureHeaders(sh, headers);
      }
    }
    const dflt = ss.getSheetByName("Sheet1");
    if (dflt && ss.getSheets().length > 1) ss.deleteSheet(dflt);
  }
  function ensureHeaders(sh, headers) {
    const width = Math.max(sh.getLastColumn(), 1);
    const existing = sh.getRange(1, 1, 1, width).getValues()[0].map(String).filter((h) => h !== "");
    const missing = headers.filter((h) => !existing.includes(h));
    if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }
  }
  function ensureTab(tab) {
    const ss = ledgerSpreadsheet();
    const headers = TAB_HEADERS[tab];
    if (!headers) throw new Error(`No headers defined for tab ${tab}.`);
    const found = ss.getSheetByName(tab);
    if (found) {
      ensureHeaders(found, headers);
      return;
    }
    const sh = ss.insertSheet(tab);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat("@");
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  function fromCell(v) {
    if (v === "" || v === null || v === void 0) return null;
    if (v instanceof Date) {
      return new Date(Math.floor(v.getTime() / 1e3) * 1e3).toISOString().replace(".000Z", "Z");
    }
    return v;
  }
  function toCell(v) {
    if (v === null || v === void 0) return "";
    return v;
  }
  function mapRows(headers, values) {
    const out = [];
    for (const value of values) {
      const row = {};
      let empty = true;
      for (let j = 0; j < headers.length; j++) {
        if (!headers[j]) continue;
        const v = fromCell(value[j]);
        row[headers[j]] = v;
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
    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    return mapRows(values[0].map(String), values.slice(1));
  }
  function readTail(tab, n) {
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    const first = Math.max(2, lastRow - n + 1);
    const values = sh.getRange(first, 1, lastRow - first + 1, lastCol).getValues();
    return mapRows(headers, values);
  }
  function overwrite(tab, rows) {
    const sh = sheet(tab);
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(Boolean);
    const lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    if (!rows.length) return;
    const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
    const range = sh.getRange(2, 1, grid.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(grid);
  }
  function appendRows(tab, rows) {
    if (!rows.length) return;
    const sh = sheet(tab);
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(Boolean);
    const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
    const range = sh.getRange(sh.getLastRow() + 1, 1, grid.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(grid);
  }
  function dataRowCount(tab) {
    return Math.max(0, sheet(tab).getLastRow() - 1);
  }
  function truncateAfter(tab, keepDataRows) {
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const firstToClear = keepDataRows + 2;
    if (lastRow >= firstToClear) {
      const lastCol = Math.max(sh.getLastColumn(), 1);
      sh.getRange(firstToClear, 1, lastRow - firstToClear + 1, lastCol).clearContent();
    }
  }
  var SHRINK_SPARE_ROWS = 200;
  function shrinkTab(tab, keepSpare = SHRINK_SPARE_ROWS) {
    const sh = sheet(tab);
    const needed = Math.max(sh.getLastRow(), 1) + Math.max(keepSpare, 0);
    const max = sh.getMaxRows();
    if (max > needed) sh.deleteRows(needed + 1, max - needed);
  }
  function updateWhere(tab, keyColumn, keyValue, patch) {
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2) return false;
    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(String);
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
  function cellUsage() {
    const tabs = ledgerSpreadsheet().getSheets().map((sh) => {
      const rows = sh.getMaxRows();
      const cols = sh.getMaxColumns();
      return { name: sh.getName(), rows, cols, cells: rows * cols };
    });
    return { total: tabs.reduce((acc, t) => acc + t.cells, 0), tabs };
  }

  // src/server/setup.ts
  var SPREADSHEET_NAME = "Wiz Sidekick OS Ledger";
  var FOLDER_NAME = "wiz-sidekick";
  var DAILY_TRIGGER_HANDLER = "trigger_dailyScan";
  var DAILY_TRIGGER_HOUR = 5;
  var WARM_TRIGGER_HANDLER = "trigger_warmReadModels";
  var WARM_READY_BY_HOURS = [9, 13, 17];
  var WARM_TRIGGER_TZ = "Europe/Paris";
  var WARM_TRIGGER_NEAR_MINUTE = 30;
  var WARM_TRIGGER_HOURS = WARM_READY_BY_HOURS.map((h) => (h + 23) % 24);
  function warmScheduleSignature() {
    return `${WARM_TRIGGER_TZ}|${WARM_TRIGGER_HOURS.join(",")}@${WARM_TRIGGER_NEAR_MINUTE}`;
  }
  function setup() {
    const notes = [];
    let ssId = getProp(PROP_KEYS.ledgerSpreadsheetId);
    let ss;
    if (ssId) {
      ss = SpreadsheetApp.openById(ssId);
      notes.push(`spreadsheet: existing ${ssId}`);
    } else {
      ss = SpreadsheetApp.create(SPREADSHEET_NAME);
      ssId = ss.getId();
      setProp(PROP_KEYS.ledgerSpreadsheetId, ssId);
      notes.push(`spreadsheet: created ${ssId}`);
    }
    ensureTabs(ss);
    let folderId = getProp(PROP_KEYS.archiveFolderId);
    if (!folderId) {
      folderId = DriveApp.createFolder(FOLDER_NAME).getId();
      setProp(PROP_KEYS.archiveFolderId, folderId);
      notes.push(`archive folder: created ${folderId}`);
    } else {
      notes.push(`archive folder: existing ${folderId}`);
    }
    ensureFolders(folderId);
    if (!getProp(PROP_KEYS.wizAuthUrl)) setProp(PROP_KEYS.wizAuthUrl, DEFAULT_WIZ_AUTH_URL);
    if (!getProp(PROP_KEYS.allowedUsers)) {
      const owner = ownerEmail();
      if (owner) {
        setProp(PROP_KEYS.allowedUsers, owner);
        notes.push(`allowlist: seeded with owner ${owner}`);
      } else {
        notes.push("allowlist: not seeded (owner email unavailable)");
      }
    } else {
      notes.push("allowlist: already set, left as-is");
    }
    const existing = ScriptApp.getProjectTriggers().filter(
      (t) => t.getHandlerFunction() === DAILY_TRIGGER_HANDLER
    );
    if (!existing.length) {
      ScriptApp.newTrigger(DAILY_TRIGGER_HANDLER).timeBased().everyDays(1).atHour(DAILY_TRIGGER_HOUR).create();
      notes.push(`daily trigger: installed (${DAILY_TRIGGER_HOUR}:00 script-local)`);
    } else {
      notes.push("daily trigger: already installed");
    }
    const warmExisting = ScriptApp.getProjectTriggers().filter(
      (t) => t.getHandlerFunction() === WARM_TRIGGER_HANDLER
    );
    const wantSchedule = warmScheduleSignature();
    if (warmExisting.length === WARM_TRIGGER_HOURS.length && getProp(PROP_KEYS.warmTriggerSchedule) === wantSchedule) {
      notes.push(`warm trigger: already installed (${wantSchedule})`);
    } else {
      for (const t of warmExisting) ScriptApp.deleteTrigger(t);
      for (const hour of WARM_TRIGGER_HOURS) {
        ScriptApp.newTrigger(WARM_TRIGGER_HANDLER).timeBased().everyDays(1).atHour(hour).nearMinute(WARM_TRIGGER_NEAR_MINUTE).inTimezone(WARM_TRIGGER_TZ).create();
      }
      setProp(PROP_KEYS.warmTriggerSchedule, wantSchedule);
      notes.push(
        `warm trigger: installed ${WARM_TRIGGER_HOURS.length}x daily, warm by ${WARM_READY_BY_HOURS.map((h) => `${h}:00`).join(", ")} ${WARM_TRIGGER_TZ}` + (warmExisting.length ? ` (replaced ${warmExisting.length})` : "")
      );
    }
    const missing = [
      PROP_KEYS.wizClientId,
      PROP_KEYS.wizClientSecret,
      PROP_KEYS.wizApiUrl,
      PROP_KEYS.wizProjectIdV2
    ].filter((k) => !getProp(k));
    if (missing.length) {
      notes.push(`NOTE: set Script Properties for live scans: ${missing.join(", ")} (without them the app runs dry-run only)`);
    }
    return notes.join("\n");
  }

  // src/domain/config.ts
  var SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];
  var SEVERITY_COLORS = {
    CRITICAL: "#dc2626",
    HIGH: "#ea580c",
    MEDIUM: "#d97706",
    LOW: "#2563eb",
    INFO: "#64748b",
    UNKNOWN: "#475569"
  };
  var SLA_TARGETS = {
    CRITICAL: 7,
    HIGH: 14,
    MEDIUM: 30,
    LOW: 90,
    INFO: 180
  };
  var EPSS_PRIORITY_THRESHOLD = 0.1;
  var SELECTABLE_SEVERITIES = SEVERITY_ORDER.filter((s) => s !== "UNKNOWN");
  var DEFAULT_FETCH_SEVERITIES = ["CRITICAL", "HIGH"];
  var DEFAULT_DISPLAY_SEVERITIES = ["CRITICAL", "HIGH"];
  var API_SEVERITY_VALUES = {
    CRITICAL: "CRITICAL",
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    LOW: "LOW",
    INFO: "INFORMATIONAL"
  };
  var RESOLVED_STATUSES = /* @__PURE__ */ new Set(["RESOLVED", "REMEDIATED", "FIXED", "CLOSED"]);
  function isOpenStatus(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  var DISAPPEARANCE_RESOLUTION = "scan_ts";
  var REMEDIATION_ROLLOUT_ISO = "2026-07-01T00:00:00Z";
  var DEFAULT_RETENTION_DAYS = 180;
  var RETENTION_MIN_DAYS = 30;
  var MIN_UNSEALED_FLAT_SCANS = 2;

  // src/domain/severity.ts
  function normalizeSeverity(sev2) {
    if (typeof sev2 !== "string") return "UNKNOWN";
    const s = sev2.toUpperCase().trim();
    if (s === "INFORMATIONAL" || s === "INFO") return "INFO";
    return SEVERITY_ORDER.includes(s) ? s : "UNKNOWN";
  }
  function effectiveSeverity(rec) {
    const candidates = ["severity", "vendorSeverity", "nvdSeverity"];
    for (const source of candidates) {
      const sev2 = normalizeSeverity(rec[source]);
      if (sev2 !== "UNKNOWN") return { severity: sev2, source };
    }
    return { severity: "UNKNOWN", source: null };
  }
  function countBySeverity(records) {
    var _a;
    if (!records.length || !records.some((r) => "severity" in r)) return {};
    const counts = {};
    for (const rec of records) {
      const sev2 = normalizeSeverity(rec["severity"]);
      counts[sev2] = ((_a = counts[sev2]) != null ? _a : 0) + 1;
    }
    return counts;
  }

  // src/domain/program.ts
  var DAY_MS = 864e5;
  function isOpen(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  var DEFAULT_RISK_RULE = {
    kev: true,
    exploit: true,
    epss: true,
    epssThreshold: EPSS_PRIORITY_THRESHOLD
  };
  function ruleIsEmpty(rule) {
    return !rule.kev && !rule.exploit && !rule.epss;
  }
  function ruleSentence(rule) {
    const parts = [];
    if (rule.kev) parts.push("CISA KEV");
    if (rule.exploit) parts.push("public exploit");
    if (rule.epss) parts.push("EPSS >= " + rule.epssThreshold.toFixed(2));
    return parts.length ? parts.join(" or ") : "no signal enabled";
  }
  function seen(row, rule) {
    return {
      kev: !rule.kev || row.has_kev != null,
      exploit: !rule.exploit || row.has_exploit != null,
      epss: !rule.epss || typeof row.epss === "number" && Number.isFinite(row.epss)
    };
  }
  function firedSignals(row, rule) {
    const out = [];
    if (rule.kev && row.has_kev === true) out.push("kev");
    if (rule.exploit && row.has_exploit === true) out.push("exploit");
    if (rule.epss && typeof row.epss === "number" && Number.isFinite(row.epss) && row.epss >= rule.epssThreshold) {
      out.push("epss");
    }
    return out;
  }
  function classifyRisk(row, rule) {
    if (ruleIsEmpty(rule)) return "unknown";
    if (firedSignals(row, rule).length) return "high";
    const s = seen(row, rule);
    if (!s.kev || !s.exploit || !s.epss) return "unknown";
    return "low";
  }
  var RISK_TIER_ORDER = ["kev", "exploit", "epss", "none", "unknown"];
  function riskTier(row, rule) {
    const cls = classifyRisk(row, rule);
    if (cls !== "high") return cls === "low" ? "none" : "unknown";
    const fired = firedSignals(row, rule);
    if (fired.includes("kev")) return "kev";
    if (fired.includes("exploit")) return "exploit";
    return "epss";
  }
  var NO_RATE = { point: null, lo: null, hi: null };
  function pct(num, den) {
    return den > 0 ? num / den * 100 : null;
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
  function tally(m, row, rule) {
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
    for (const row of rows) tally(m, row, rule);
    return finalize(m);
  }
  function confusionBySeverity(rows, rule) {
    var _a;
    const bySev = {};
    const overall = emptyMatrix();
    for (const row of rows) {
      const s = normalizeSeverity(row.severity);
      const m = (_a = bySev[s]) != null ? _a : bySev[s] = emptyMatrix();
      tally(m, row, rule);
      tally(overall, row, rule);
    }
    const perSev = {};
    for (const s of SEVERITY_ORDER) if (bySev[s]) perSev[s] = finalize(bySev[s]);
    return { perSev, overall: finalize(overall) };
  }
  function signalBreakdown(rows, rule) {
    const out = {
      kev: 0,
      exploit: 0,
      epss: 0,
      anyOf: 0,
      kevMissing: 0,
      exploitMissing: 0,
      epssMissing: 0
    };
    for (const row of rows) {
      const fired = firedSignals(row, rule);
      if (fired.length) out.anyOf += 1;
      for (const f of fired) out[f] += 1;
      if (rule.kev && row.has_kev == null) out.kevMissing += 1;
      if (rule.exploit && row.has_exploit == null) out.exploitMissing += 1;
      if (rule.epss && !(typeof row.epss === "number" && Number.isFinite(row.epss))) {
        out.epssMissing += 1;
      }
    }
    return out;
  }
  function ruleSensitivity(rows, active) {
    const subsets = [
      { label: "KEV", kev: true, exploit: false, epss: false },
      { label: "Exploit", kev: false, exploit: true, epss: false },
      { label: "EPSS", kev: false, exploit: false, epss: true },
      { label: "KEV or exploit", kev: true, exploit: true, epss: false },
      { label: "KEV or EPSS", kev: true, exploit: false, epss: true },
      { label: "Exploit or EPSS", kev: false, exploit: true, epss: true },
      { label: "All three", kev: true, exploit: true, epss: true }
    ];
    return subsets.map((s) => {
      const rule = { ...s, epssThreshold: active.epssThreshold };
      const m = confusionMatrix(rows, rule);
      return {
        label: s.label,
        rule,
        active: rule.kev === active.kev && rule.exploit === active.exploit && rule.epss === active.epss,
        coverage: m.coverage.point,
        efficiency: m.efficiency.point,
        highRisk: m.highRisk,
        unknown: m.unknown
      };
    });
  }
  var NET_CAPACITY_BAND_PCT = 2;
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
  function capacityByMonth(rows, scans, options) {
    var _a, _b, _c, _d;
    const nowMs = (_a = options.now) != null ? _a : Date.now();
    const rule = options.rule;
    const parsed = [];
    for (const row of rows) {
      if (options.highRiskOnly && classifyRisk(row, rule) !== "high") continue;
      const first = parseTs(row.first_seen);
      if (first === null) continue;
      parsed.push({ first, resolved: parseTs(row.resolved_at) });
    }
    const flatScanMs = scans.filter((s) => s["shape"] !== "grouped").map((s) => parseTs(s["ts"])).filter((t) => t !== null);
    const firstScanMs = flatScanMs.length ? minNum(flatScanMs) : null;
    const scanClosedByMonth = {};
    for (const s of scans) {
      if (s["shape"] === "grouped") continue;
      const t = parseTs(s["ts"]);
      if (t === null) continue;
      if (firstScanMs !== null && t === firstScanMs) continue;
      const k = monthKey(t);
      scanClosedByMonth[k] = ((_b = scanClosedByMonth[k]) != null ? _b : 0) + Number((_c = s["resolved_count"]) != null ? _c : 0);
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
        reconstructed: firstScanMs === null || end <= firstScanMs,
        scanClosed: (_d = scanClosedByMonth[key]) != null ? _d : null
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
    return (nowMs - minNum(firsts)) / DAY_MS;
  }

  // src/domain/settingsLogic.ts
  function canonicalSeverities(values, defaults) {
    if (!Array.isArray(values)) return [...defaults];
    const chosen = new Set(
      values.filter((v) => typeof v === "string").map(normalizeSeverity).filter((s) => SELECTABLE_SEVERITIES.includes(s))
    );
    if (!chosen.size) return [...defaults];
    return SEVERITY_ORDER.filter((s) => chosen.has(s));
  }
  function getFetchSeverities(settings) {
    return canonicalSeverities(settings["fetch_severities"], DEFAULT_FETCH_SEVERITIES);
  }
  function getDisplaySeverities(settings) {
    const fetch = getFetchSeverities(settings);
    const disp = canonicalSeverities(settings["display_severities"], DEFAULT_DISPLAY_SEVERITIES);
    const clamped = disp.filter((s) => fetch.includes(s));
    return clamped.length ? clamped : fetch;
  }
  function withFetchSeverities(settings, sevs) {
    const d = { ...settings };
    const fetch = canonicalSeverities(sevs, DEFAULT_FETCH_SEVERITIES);
    d["fetch_severities"] = fetch;
    const disp = canonicalSeverities(d["display_severities"], fetch);
    const clamped = disp.filter((s) => fetch.includes(s));
    d["display_severities"] = clamped.length ? clamped : [...fetch];
    return d;
  }
  function withDisplaySeverities(settings, sevs) {
    const d = { ...settings };
    const fetch = canonicalSeverities(d["fetch_severities"], DEFAULT_FETCH_SEVERITIES);
    const disp = canonicalSeverities(sevs, DEFAULT_DISPLAY_SEVERITIES);
    const clamped = disp.filter((s) => fetch.includes(s));
    d["display_severities"] = clamped.length ? clamped : [...fetch];
    return d;
  }
  function getRetentionDays(settings) {
    const raw = "retention_days" in settings ? settings["retention_days"] : DEFAULT_RETENTION_DAYS;
    if (raw === null) return null;
    const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(String(raw), 10);
    if (Number.isNaN(n)) return DEFAULT_RETENTION_DAYS;
    return Math.max(n, RETENTION_MIN_DAYS);
  }
  function withRetentionDays(settings, days) {
    const d = { ...settings };
    d["retention_days"] = days === null ? null : Math.max(Math.trunc(days), RETENTION_MIN_DAYS);
    return d;
  }
  function getAutoCompact(settings) {
    const val = "auto_compact" in settings ? settings["auto_compact"] : true;
    return typeof val === "boolean" ? val : true;
  }
  function withAutoCompact(settings, enabled) {
    return { ...settings, auto_compact: Boolean(enabled) };
  }
  function getShowNoFix(settings) {
    const val = "show_no_fix" in settings ? settings["show_no_fix"] : true;
    return typeof val === "boolean" ? val : true;
  }
  function withShowNoFix(settings, enabled) {
    return { ...settings, show_no_fix: Boolean(enabled) };
  }
  function getIncludeEol(settings) {
    const val = "include_eol" in settings ? settings["include_eol"] : true;
    return typeof val === "boolean" ? val : true;
  }
  function withIncludeEol(settings, enabled) {
    return { ...settings, include_eol: Boolean(enabled) };
  }
  function getRiskRule(settings) {
    var _a;
    const raw = settings["risk_rule"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { version: 0, rule: { ...DEFAULT_RISK_RULE } };
    }
    const r = raw;
    let version = 0;
    const v = Number((_a = r["version"]) != null ? _a : 0);
    if (Number.isFinite(v)) version = Math.max(Math.trunc(v), 0);
    const stored = r["rule"];
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return { version, rule: { ...DEFAULT_RISK_RULE } };
    }
    return { version, rule: cleanRiskRule(stored) };
  }
  function cleanRiskRule(raw) {
    const bool = (key) => {
      const v = raw[key];
      return typeof v === "boolean" ? v : DEFAULT_RISK_RULE[key];
    };
    const t = Number(raw["epssThreshold"]);
    return {
      kev: bool("kev"),
      exploit: bool("exploit"),
      epss: bool("epss"),
      epssThreshold: Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : DEFAULT_RISK_RULE.epssThreshold
    };
  }
  function withRiskRule(settings, rule) {
    const current = getRiskRule(settings);
    const clean2 = cleanRiskRule(
      rule && typeof rule === "object" && !Array.isArray(rule) ? rule : {}
    );
    return { ...settings, risk_rule: { version: current.version + 1, rule: clean2 } };
  }
  function cleanDomainItems(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(
      (item) => item !== null && typeof item === "object" && !Array.isArray(item) && typeof item["name"] === "string" && item["name"].trim() !== ""
    );
  }
  function getDomains(settings) {
    var _a;
    const raw = settings["domains"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 0, items: [] };
    const r = raw;
    let version = 0;
    const v = Number((_a = r["version"]) != null ? _a : 0);
    if (Number.isFinite(v)) version = Math.max(Math.trunc(v), 0);
    return { version, items: cleanDomainItems(r["items"]) };
  }
  function withDomains(settings, items) {
    const current = getDomains(settings);
    return {
      ...settings,
      domains: { version: current.version + 1, items: cleanDomainItems(items) }
    };
  }
  function cleanStringMap(map) {
    const out = {};
    if (!map || typeof map !== "object" || Array.isArray(map)) return out;
    for (const [k, v] of Object.entries(map)) {
      if (typeof k === "string" && k !== "" && typeof v === "string" && v !== "") {
        out[k] = v;
      }
    }
    return out;
  }
  function getSupportGroupMap(settings) {
    var _a;
    const raw = settings["support_group_map"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 0, map: {} };
    const r = raw;
    let version = 0;
    const v = Number((_a = r["version"]) != null ? _a : 0);
    if (Number.isFinite(v)) version = Math.max(Math.trunc(v), 0);
    return { version, map: cleanStringMap(r["map"]) };
  }
  function apiSeverityFilter(severities) {
    const sevs = canonicalSeverities(severities, DEFAULT_FETCH_SEVERITIES);
    if (new Set(sevs).size === SELECTABLE_SEVERITIES.length) return null;
    return sevs.map((s) => API_SEVERITY_VALUES[s]);
  }

  // src/server/wizQuery.ts
  var QUERY = "\n    query VulnerabilityFindingsTable($filterBy: VulnerabilityFindingFilters, $first: Int, $after: String, $orderBy: VulnerabilityFindingOrder = {direction: DESC, field: CREATED_AT}, $includeRelatedIssueAnalytics: Boolean = false, $includeRelatedSourceMappedIssueAnalytics: Boolean = false, $includeTotalCount: Boolean = false, $includePostureIssues: Boolean = false, $fetchPrivilegedActionRequests: Boolean = false) {\n      vulnerabilityFindings(\n        filterBy: $filterBy\n        first: $first\n        after: $after\n        orderBy: $orderBy\n      ) {\n        nodes {\n          ...VulnerabilityFindingFragment\n          ...DuplicateFindingBadge\n          transitivity\n          rootComponent {\n            name\n          }\n          isHighProfileThreat\n          vendorSeverity\n          nvdSeverity\n          weightedSeverity\n          hasExploit\n          usedInCodeResult\n          hasCisaKevExploit\n          cisaKevReleaseDate\n          cisaKevDueDate\n          score\n          epssSeverity\n          epssPercentile\n          epssProbability\n          categories\n          hasInitialAccessPotential\n          isClientSide\n          affectedBySettings\n          codeLibraryLanguage\n          exploitabilityValidationStatus\n          cvssv2 {\n            attackVector\n            attackComplexity\n            confidentialityImpact\n            integrityImpact\n            privilegesRequired\n            userInteractionRequired\n            vectorString\n            scope\n          }\n          cvssv3 {\n            attackVector\n            attackComplexity\n            confidentialityImpact\n            integrityImpact\n            privilegesRequired\n            userInteractionRequired\n            vectorString\n            scope\n          }\n          effectiveAvailabilityImpact\n          cnaScore\n          vendorScore\n          relatedIssueAnalytics @include(if: $includeRelatedIssueAnalytics) {\n            ...VulnerabilityFindingRelatedIssueAnalyticsFragment\n          }\n          relatedSourceMappedIssueAnalytics @include(if: $includeRelatedSourceMappedIssueAnalytics) {\n            ...VulnerabilityFindingRelatedIssueAnalyticsFragment\n          }\n          postureIssues @include(if: $includePostureIssues) {\n            ...PostureIssuePopoverListRecord\n          }\n          privilegedActionRequests @include(if: $fetchPrivilegedActionRequests) {\n            ...PendingUpdateVulnerabilityFindingStatusRequest\n          }\n        }\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        totalCount @include(if: $includeTotalCount)\n      }\n    }\n   \n        fragment VulnerabilityFindingFragment on VulnerabilityFinding {\n      id\n      name\n      detailedName\n      description\n      severity\n      status\n      fixedVersion\n      detectionMethod\n      firstDetectedAt\n      firstDetectedAtSource\n      lastDetectedAt\n      resolvedAt\n      validatedInRuntime\n      runtimeValidationResult\n      reachability\n      hasTriggerableRemediation\n      remediationPullRequestAvailable\n      dataSourceName\n      fixDate\n      fixDateBefore\n      publishedDate\n      version\n      versionResolutionPrimarySource {\n        type\n        version\n      }\n      isOperatingSystemEndOfLife\n      recommendedVersion\n      locationPath\n      artifactType {\n        ...SBOMArtifactTypeFragment\n      }\n      projects {\n        id\n        name\n        slug\n        isFolder\n      }\n      ignoreRules {\n        id\n      }\n      note {\n        id\n        text\n      }\n      layerMetadata {\n        id\n        details\n        isBaseLayer\n        layerHash\n      }\n      vulnerableAsset {\n        ... on VulnerableAssetBase {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          externalId\n          providerUniqueId\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetVirtualMachine {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystem\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          imageName\n          imageId\n          imageNativeType\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          computeInstanceGroup {\n            id\n            externalId\n            name\n            replicaCount\n            tags\n          }\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetServerless {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetContainerImage {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          repository {\n            vertexId\n            name\n          }\n          registry {\n            vertexId\n            name\n          }\n          scanSource\n          executionControllers {\n            ...VulnerableAssetExecutionControllerDetails\n          }\n          graphEntity {\n            ...VulnerabilityContainerImageGraphEntityExecutionContext\n          }\n          nativeType\n          tagReferences\n          imageTags\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetContainer {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          executionControllers {\n            ...VulnerableAssetExecutionControllerDetails\n          }\n          nativeType\n          isUsedOnPrem\n        }\n        ... on VulnerableAssetRepositoryBranch {\n          id\n          type\n          name\n          cloudPlatform\n          repositoryId\n          repositoryName\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetIde {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetEndpoint {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetPaaSResource {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetVirtualMachineImage {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetNetworkAddress {\n          subscriptionId\n          subscriptionName\n          subscriptionExternalId\n          tags\n          address\n          addressType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetCommon {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetDevice {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n          operatingSystem\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n        }\n      }\n      sourceMappedCodeFindings {\n        id\n        remediationPullRequestAvailable\n      }\n    }\n   \n\n\n        fragment SBOMArtifactTypeFragment on SBOMArtifactType {\n      group\n      codeLibraryLanguage\n      osPackageManager\n      hostedTechnology {\n        id\n        name\n        icon\n      }\n      plugin\n      custom\n      ciComponent\n    }\n   \n\n\n        fragment VulnerabilityFindingOperatingSystemDistribution on Technology {\n      id\n      name\n      icon\n    }\n   \n\n\n        fragment VulnerableAssetExecutionControllerDetails on VulnerableAssetExecutionController {\n      id\n      entityType\n      externalId\n      providerUniqueId\n      name\n      subscriptionExternalId\n      subscriptionId\n      subscriptionName\n      ancestors {\n        id\n        name\n        entityType\n        externalId\n        providerUniqueId\n      }\n    }\n   \n\n\n        fragment VulnerabilityContainerImageGraphEntityExecutionContext on GraphEntity {\n      id\n      providerUniqueId\n      type\n      containerImageExecutionContextAnalyticsV3 {\n        totalResourceCount\n        nativeType {\n          nativeType\n          count\n        }\n      }\n    }\n   \n\n\n        fragment DuplicateFindingBadge on VulnerabilityFinding {\n      id\n      origin\n      duplicateOf {\n        id\n        name\n        origin\n        vulnerableAsset {\n          ... on VulnerableAssetBase {\n            id\n            name\n          }\n        }\n      }\n    }\n   \n\n\n        fragment VulnerabilityFindingRelatedIssueAnalyticsFragment on VulnerabilityFindingRelatedIssueAnalytics {\n      issueCount\n      informationalSeverityCount\n      lowSeverityCount\n      mediumSeverityCount\n      highSeverityCount\n      criticalSeverityCount\n    }\n   \n\n\n        fragment PostureIssuePopoverListRecord on PostureIssue {\n      id\n      name\n      type\n      entity {\n        providerUniqueId\n        id\n        type\n      }\n    }\n   \n\n\n        fragment PendingUpdateVulnerabilityFindingStatusRequest on PrivilegedActionRequest {\n      ...PendingStatusRequestBanner\n      ...PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams\n    }\n   \n\n\n        fragment PendingStatusRequestBanner on PrivilegedActionRequest {\n      id\n      type\n      status\n      createdAt\n      createdBy {\n        id\n        name\n        email\n      }\n      params {\n        ... on PrivilegedActionRequestUpdateIssueStatusParams {\n          issueStatus: status\n        }\n        ... on PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams {\n          findingStatus: status\n        }\n        ... on PrivilegedActionRequestCreateIgnoreRuleParams {\n          ignoreRuleName: name\n        }\n      }\n    }\n   \n\n\n        fragment PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams on PrivilegedActionRequest {\n      id\n      params {\n        ... on PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams {\n          status\n        }\n      }\n      subject {\n        ... on VulnerabilityFinding {\n          id\n          status\n        }\n      }\n    }\n";
  var BASE_VARIABLES = {
    "orderBy": {
      "field": "RELATED_ISSUE_SEVERITY",
      "direction": "DESC"
    },
    "includeRelatedIssueAnalytics": false,
    "includeRelatedSourceMappedIssueAnalytics": false,
    "includeTotalCount": false,
    "includePostureIssues": false,
    "fetchPrivilegedActionRequests": false,
    "first": 500,
    "filterBy": {
      "projectIdV2": {
        "equals": [
          "1dfea0cf-834f-5522-b797-bee5aaf09251"
        ]
      },
      "assetType": [
        "VIRTUAL_MACHINE"
      ],
      "detectionMethod": [
        "OS"
      ],
      "status": [
        "OPEN",
        "RESOLVED"
      ],
      "detailedNameV2": {
        "notEquals": [
          "openssl",
          "python",
          "vim"
        ]
      },
      "assetIsRepresentativeResource": false
    }
  };
  var PAGE_SIZE = 500;
  var PAGE_SIZE_FALLBACK = 250;
  var MAX_PAGES = 1e3;

  // src/server/wizClient.ts
  var WizQueryError = class extends Error {
  };
  var WizDeltaFilterError = class extends WizQueryError {
  };
  var TOKEN_CACHE_KEY = "wiz_token";
  function getToken(forceRefresh = false) {
    var _a, _b;
    const staticToken = getProp(PROP_KEYS.wizApiToken);
    if (staticToken && staticToken.trim()) return staticToken.trim();
    const cache = CacheService.getScriptCache();
    if (!forceRefresh) {
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
        `Wiz token request failed (${response.getResponseCode()}): ` + response.getContentText().slice(0, 500)
      );
    }
    const body = JSON.parse(response.getContentText());
    const token = body["access_token"];
    if (typeof token !== "string" || !token) {
      throw new WizQueryError("Wiz token response carried no access_token.");
    }
    const expiresIn = Number((_b = body["expires_in"]) != null ? _b : 3600);
    const ttl = Math.max(60, Math.min(Math.trunc(expiresIn) - 300, 21600));
    cache.put(TOKEN_CACHE_KEY, token, ttl);
    return token;
  }
  function baseVariables() {
    return JSON.parse(JSON.stringify(BASE_VARIABLES));
  }
  function buildVariables(options = {}) {
    var _a, _b;
    const vars = baseVariables();
    const filterBy = vars["filterBy"];
    const projectId = getProp(PROP_KEYS.wizProjectIdV2);
    if (projectId) filterBy["projectIdV2"] = { equals: [projectId] };
    const sevFilter = options.severities === void 0 ? null : apiSeverityFilter(options.severities);
    if (sevFilter) filterBy["severity"] = sevFilter;
    for (const [k, v] of Object.entries((_a = options.extraFilterBy) != null ? _a : {})) filterBy[k] = v;
    vars["first"] = (_b = options.first) != null ? _b : PAGE_SIZE;
    if (options.after) vars["after"] = options.after;
    vars["includeTotalCount"] = Boolean(options.includeTotalCount);
    return vars;
  }
  function queryPage(variables, isDeltaFetch = false) {
    var _a, _b, _c, _d;
    const apiUrl = requireProp(PROP_KEYS.wizApiUrl);
    let token = getToken();
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = UrlFetchApp.fetch(apiUrl, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${token}` },
        payload: JSON.stringify({ query: QUERY, variables }),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code === 401 && attempt === 0 && !getProp(PROP_KEYS.wizApiToken)) {
        token = getToken(true);
        continue;
      }
      if (code === 429 || code >= 500) {
        lastError = `HTTP ${code}`;
        Utilities.sleep(1e3 * Math.pow(2, attempt));
        continue;
      }
      if (code !== 200) {
        const hint = code === 401 && getProp(PROP_KEYS.wizApiToken) ? " \u2014 WIZ_API_TOKEN was rejected; it may have expired. Refresh it, or set WIZ_CLIENT_ID/WIZ_CLIENT_SECRET for auto-refresh." : "";
        throw new WizQueryError(
          `Wiz query failed (HTTP ${code})${hint}: ${response.getContentText().slice(0, 500)}`
        );
      }
      const body = JSON.parse(response.getContentText());
      const data = body["data"];
      const connection = data == null ? void 0 : data["vulnerabilityFindings"];
      if (!connection) {
        const errors = JSON.stringify((_a = body["errors"]) != null ? _a : body).slice(0, 500);
        if (isDeltaFetch) {
          throw new WizDeltaFilterError(`Wiz rejected the incremental filter: ${errors}`);
        }
        throw new WizQueryError(`Wiz response carried no findings connection: ${errors}`);
      }
      const pageInfo = (_b = connection["pageInfo"]) != null ? _b : {};
      const rawTotal = connection["totalCount"];
      return {
        nodes: (_c = connection["nodes"]) != null ? _c : [],
        hasNextPage: Boolean(pageInfo["hasNextPage"]),
        endCursor: (_d = pageInfo["endCursor"]) != null ? _d : null,
        totalCount: typeof rawTotal === "number" ? rawTotal : null
      };
    }
    throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
  }
  function gqlPost(query, variables) {
    var _a;
    const apiUrl = requireProp(PROP_KEYS.wizApiUrl);
    let token = getToken();
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = UrlFetchApp.fetch(apiUrl, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${token}` },
        payload: JSON.stringify({ query, variables }),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code === 401 && attempt === 0 && !getProp(PROP_KEYS.wizApiToken)) {
        token = getToken(true);
        continue;
      }
      if (code === 429 || code >= 500) {
        lastError = `HTTP ${code}`;
        Utilities.sleep(1e3 * Math.pow(2, attempt));
        continue;
      }
      if (code !== 200) {
        throw new WizQueryError(
          `Wiz query failed (HTTP ${code}): ${response.getContentText().slice(0, 500)}`
        );
      }
      const body = JSON.parse(response.getContentText());
      const data = body["data"];
      if (!data) {
        const errors = JSON.stringify((_a = body["errors"]) != null ? _a : body).slice(0, 500);
        throw new WizQueryError(`Wiz response carried no data: ${errors}`);
      }
      return data;
    }
    throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
  }
  function parseGraphSearchPage(data) {
    var _a, _b, _c;
    const connection = data["graphSearch"];
    if (!connection) {
      throw new WizQueryError("Wiz response carried no graphSearch connection.");
    }
    const pageInfo = (_a = connection["pageInfo"]) != null ? _a : {};
    return {
      nodes: (_b = connection["nodes"]) != null ? _b : [],
      hasNextPage: Boolean(pageInfo["hasNextPage"]),
      endCursor: (_c = pageInfo["endCursor"]) != null ? _c : null
    };
  }
  function graphSearchPage(query, variables, fallbackFirst) {
    try {
      return parseGraphSearchPage(gqlPost(query, variables));
    } catch (e) {
      const first = Number(variables["first"]);
      const smaller = fallbackFirst != null ? fallbackFirst : Number.isFinite(first) ? Math.max(1, Math.floor(first / 2)) : NaN;
      if (!Number.isFinite(smaller) || !(smaller < first)) throw e;
      return parseGraphSearchPage(gqlPost(query, { ...variables, first: smaller }));
    }
  }
  function fetchPage(options) {
    var _a;
    const common = {
      severities: options.severities,
      extraFilterBy: options.extraFilterBy,
      after: (_a = options.cursor) != null ? _a : null,
      includeTotalCount: options.pageNumber === 0
    };
    const isDelta = Boolean(options.extraFilterBy && Object.keys(options.extraFilterBy).length);
    try {
      return queryPage(buildVariables({ ...common, first: PAGE_SIZE }), isDelta);
    } catch (e) {
      if (e instanceof WizDeltaFilterError) throw e;
      return queryPage(buildVariables({ ...common, first: PAGE_SIZE_FALLBACK }), isDelta);
    }
  }

  // src/server/diagnostics.ts
  function preview(value) {
    if (!value || !value.trim()) return "(unset)";
    const v = value.trim();
    if (v.length <= 10) return `${v.length} chars`;
    return `${v.length} chars, ${v.slice(0, 4)}\u2026${v.slice(-4)}`;
  }
  function secretPreview(value) {
    return value && value.trim() ? `(set, ${value.trim().length} chars)` : "(unset)";
  }
  function wizDiagnostic() {
    var _a;
    const lines = [];
    const log = (m) => {
      lines.push(m);
      console.log(m);
    };
    const apiUrl = getProp(PROP_KEYS.wizApiUrl);
    const authUrl = (_a = getProp(PROP_KEYS.wizAuthUrl)) != null ? _a : DEFAULT_WIZ_AUTH_URL;
    const token = getProp(PROP_KEYS.wizApiToken);
    const clientId = getProp(PROP_KEYS.wizClientId);
    const clientSecret = getProp(PROP_KEYS.wizClientSecret);
    const projectId = getProp(PROP_KEYS.wizProjectIdV2);
    const mode = resolveWizAuthMode(token, clientId, clientSecret);
    log("=== Wiz diagnostic ===");
    log(`WIZ_API_URL:        ${apiUrl || "(unset!)"}`);
    log(`Auth mode:          ${mode != null ? mode : "(none)"}`);
    log(`WIZ_API_TOKEN:      ${preview(token)}`);
    log(`WIZ_CLIENT_ID:      ${preview(clientId)}`);
    log(`WIZ_CLIENT_SECRET:  ${secretPreview(clientSecret)}`);
    if (mode === "oauth") log(`WIZ_AUTH_URL:       ${authUrl}`);
    log(`WIZ_PROJECT_ID_V2:  ${projectId || "(unset \u2014 querying all projects)"}`);
    if (!apiUrl) {
      log("FAIL: WIZ_API_URL is required, e.g. https://api.<region>.app.wiz.io/graphql.");
      return lines.join("\n");
    }
    if (mode === null) {
      log(
        "FAIL: no usable credentials \u2014 the app runs in dry-run mode. Set WIZ_API_TOKEN, or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET."
      );
      return lines.join("\n");
    }
    let bearer = "";
    try {
      bearer = getToken(true);
      log(
        mode === "token" ? `Step 1 OK: using raw WIZ_API_TOKEN (${preview(bearer)}).` : `Step 1 OK: OAuth exchange minted an access token (${preview(bearer)}).`
      );
    } catch (e) {
      log(`Step 1 FAIL: could not obtain a token \u2014 ${e.message}`);
      log(
        mode === "oauth" ? "\u2192 The token endpoint rejected the client credentials. Verify WIZ_CLIENT_ID / WIZ_CLIENT_SECRET (regenerate the service account in Wiz), and that WIZ_AUTH_URL matches the auth host shown on the service-account page." : "\u2192 WIZ_API_TOKEN is unusable. A Wiz GraphQL service account gives a client id + secret, not a durable token; use WIZ_CLIENT_ID / WIZ_CLIENT_SECRET."
      );
      return lines.join("\n");
    }
    try {
      const page = queryPage(buildVariables({ first: 1 }));
      log(`Step 2 OK: query succeeded \u2014 ${page.nodes.length} finding(s) on page 1.`);
      log("=== All checks passed. Live scans should work. ===");
    } catch (e) {
      const msg = e.message;
      log(`Step 2 FAIL: the query was rejected \u2014 ${msg}`);
      if (/HTTP 401|HTTP 403|Unauthorized/i.test(msg)) {
        log(
          "\u2192 401/403/Unauthorized: the token was not accepted (expired, invalid, or minted for a different tenant). Confirm the service account targets this tenant."
        );
      } else if (/HTTP 404/i.test(msg)) {
        log(
          "\u2192 404: WIZ_API_URL host/path is wrong \u2014 it must be https://api.<region>.app.wiz.io/graphql for your tenant's region."
        );
      } else {
        log(
          '\u2192 If the body names a field (e.g. "Cannot query field"), the service account lacks permission for it or the tenant schema differs.'
        );
      }
      return lines.join("\n");
    }
    return lines.join("\n");
  }

  // src/server/api.ts
  var api_exports = {};
  __export(api_exports, {
    backfillEpisodeTags: () => backfillEpisodeTags2,
    bootstrap: () => bootstrap,
    cancelScan: () => cancelScan2,
    clearRecentErrors: () => clearRecentErrors,
    compact: () => compact,
    deleteScans: () => deleteScans2,
    exportMigrationBundle: () => exportMigrationBundle,
    getAccess: () => getAccess,
    getAttribution: () => getAttribution,
    getDomains: () => getDomains3,
    getExecutivePage: () => getExecutivePage,
    getExportCoverageCsv: () => getExportCoverageCsv,
    getExportCsv: () => getExportCsv,
    getExportRawUrl: () => getExportRawUrl,
    getGroupTrend: () => getGroupTrend,
    getGrouping: () => getGrouping,
    getInsights: () => getInsights,
    getJobStatus: () => getJobStatus,
    getMttr: () => getMttr,
    getMttrByDomainTrend: () => getMttrByDomainTrend,
    getMttrPage: () => getMttrPage,
    getMttrTrend: () => getMttrTrend,
    getOldestOpen: () => getOldestOpen,
    getProgramPage: () => getProgramPage,
    getPurgeStatus: () => getPurgeStatus,
    getRecentErrors: () => getRecentErrors,
    getReport: () => getReport,
    getRiskBackfillStatus: () => getRiskBackfillStatus,
    getRiskCohort: () => getRiskCohort,
    getScanHistory: () => getScanHistory,
    getSettings: () => getSettings,
    getStorageStats: () => getStorageStats,
    importAbort: () => importAbort,
    importBegin: () => importBegin,
    importFinalize: () => importFinalize,
    importMigration: () => importMigration,
    importShard: () => importShard,
    importStatus: () => importStatus,
    previewDomains: () => previewDomains,
    previewMaintenance: () => previewMaintenance2,
    pruneEpisodes: () => pruneEpisodes2,
    refreshSupportGroups: () => refreshSupportGroups2,
    resetLedger: () => resetLedger2,
    runScan: () => runScan,
    saveAccess: () => saveAccess,
    saveAdmins: () => saveAdmins,
    saveDomains: () => saveDomains,
    setAutoCompact: () => setAutoCompact2,
    setIncludeEol: () => setIncludeEol2,
    setRetention: () => setRetention,
    setRetentionSettings: () => setRetentionSettings,
    setRiskRule: () => setRiskRule2,
    setSeverities: () => setSeverities,
    setShowNoFix: () => setShowNoFix2,
    startRiskBackfill: () => startRiskBackfill,
    startSeverityPurge: () => startSeverityPurge2,
    trimHistory: () => trimHistory2,
    warmReadModels: () => warmReadModels,
    warmReadModelsScheduled: () => warmReadModelsScheduled
  });

  // src/domain/domainRules.ts
  var UNASSIGNED = "Unassigned";
  var MAX_REGEX_LEN = 200;
  var COMPACTED_ASSET = "(compacted)";
  var FRAME_NAME_COLS = ["vulnerableAsset.name"];
  var FRAME_SUB_COLS = [
    "vulnerableAsset.subscriptionName",
    "vulnerableAsset.subscriptionExternalId",
    "vulnerableAsset.subscriptionId"
  ];
  var FRAME_TAGS_PREFIX = "vulnerableAsset.tags.";
  var LEDGER_NAME_COLS = ["asset_name"];
  var LEDGER_SUB_COLS = ["subscription_name", "subscription_ext_id"];
  var FRAME_SG_COLS = ["_supportGroup", "vulnerableAsset.supportGroup"];
  var LEDGER_SG_COLS = ["support_group"];
  function fold(v) {
    return String(v).trim().toLowerCase();
  }
  function pyRepr(v) {
    if (typeof v === "string") return `'${v}'`;
    if (v === null || v === void 0) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    return String(v);
  }
  function compileCondition(cond) {
    if (!cond || typeof cond !== "object" || Array.isArray(cond)) return null;
    const c = cond;
    const ctype = c["type"];
    if (ctype === "tag") {
      const key = c["key"];
      if (typeof key !== "string" || !key.trim()) return null;
      const value = c["value"];
      if (value !== null && value !== void 0 && !["string", "number", "boolean"].includes(typeof value)) {
        return null;
      }
      return {
        kind: "tag",
        key: key.trim(),
        value: value === null || value === void 0 ? null : fold(value)
      };
    }
    if (ctype === "name_regex") {
      const pattern = c["pattern"];
      if (typeof pattern !== "string" || !pattern.trim() || pattern.length > MAX_REGEX_LEN) {
        return null;
      }
      try {
        return { kind: "regex", re: new RegExp(pattern, "i") };
      } catch {
        return null;
      }
    }
    if (ctype === "subscription") {
      const values = c["values"];
      if (!Array.isArray(values) || !values.length) return null;
      const folded = /* @__PURE__ */ new Set();
      for (const v of values) {
        if ((typeof v === "string" || typeof v === "number") && String(v).trim()) {
          folded.add(fold(v));
        }
      }
      return folded.size ? { kind: "sub", values: folded } : null;
    }
    if (ctype === "support_group") {
      const values = c["values"];
      if (!Array.isArray(values) || !values.length) return null;
      const folded = /* @__PURE__ */ new Set();
      for (const v of values) {
        if ((typeof v === "string" || typeof v === "number") && String(v).trim()) {
          folded.add(fold(v));
        }
      }
      return folded.size ? { kind: "sg", values: folded } : null;
    }
    return null;
  }
  function compileDomains(items) {
    var _a;
    const compiled = [];
    for (const item of items != null ? items : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const it = item;
      const name = it["name"];
      if (typeof name !== "string" || !name.trim()) continue;
      const rules = [];
      for (const rule of (_a = it["rules"]) != null ? _a : []) {
        const conds = rule && typeof rule === "object" && !Array.isArray(rule) ? rule["conditions"] : null;
        if (!Array.isArray(conds) || !conds.length) {
          rules.push(null);
          continue;
        }
        const specs = conds.map(compileCondition);
        rules.push(specs.some((s) => s === null) ? null : specs);
      }
      compiled.push({ name: name.trim(), rules });
    }
    return compiled;
  }
  function validateDomains(items) {
    const errors = [];
    const seen2 = /* @__PURE__ */ new Set();
    const list = Array.isArray(items) ? items : [];
    list.forEach((item, idx) => {
      const i = idx + 1;
      let label = `Domain ${i}`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${label}: not a valid entry.`);
        return;
      }
      const it = item;
      const rawName = it["name"];
      if (typeof rawName !== "string" || !rawName.trim()) {
        errors.push(`${label}: name is required.`);
      } else {
        const name = rawName.trim();
        label = `Domain \u201C${name}\u201D`;
        if (name.toLowerCase() === UNASSIGNED.toLowerCase()) {
          errors.push(`${label}: \u201C${UNASSIGNED}\u201D is reserved.`);
        }
        if (name.includes(",")) errors.push(`${label}: names cannot contain commas.`);
        if (seen2.has(name.toLowerCase())) errors.push(`${label}: duplicate name.`);
        seen2.add(name.toLowerCase());
      }
      const rules = it["rules"];
      if (!Array.isArray(rules) || !rules.length) {
        errors.push(`${label}: needs at least one rule.`);
        return;
      }
      rules.forEach((rule, jdx) => {
        const j = jdx + 1;
        const conds = rule && typeof rule === "object" && !Array.isArray(rule) ? rule["conditions"] : null;
        if (!Array.isArray(conds) || !conds.length) {
          errors.push(`${label}, rule ${j}: needs at least one condition.`);
          return;
        }
        conds.forEach((cond, kdx) => {
          const where = `${label}, rule ${j}, condition ${kdx + 1}`;
          if (!cond || typeof cond !== "object" || Array.isArray(cond)) {
            errors.push(`${where}: not a valid condition.`);
            return;
          }
          const c = cond;
          const ctype = c["type"];
          if (ctype === "tag") {
            const key = c["key"];
            if (typeof key !== "string" || !key.trim()) {
              errors.push(`${where}: tag key is required.`);
            }
          } else if (ctype === "name_regex") {
            const pattern = c["pattern"];
            if (typeof pattern !== "string" || !pattern.trim()) {
              errors.push(`${where}: pattern is required.`);
            } else if (pattern.length > MAX_REGEX_LEN) {
              errors.push(`${where}: pattern is longer than ${MAX_REGEX_LEN} characters.`);
            } else {
              try {
                new RegExp(pattern);
              } catch (exc) {
                errors.push(`${where}: pattern does not compile (${String(exc)}).`);
              }
            }
          } else if (ctype === "subscription") {
            const values = c["values"];
            if (!Array.isArray(values) || !values.some((v) => typeof v === "string" && v.trim())) {
              errors.push(`${where}: pick at least one subscription.`);
            }
          } else if (ctype === "support_group") {
            const values = c["values"];
            if (!Array.isArray(values) || !values.some((v) => typeof v === "string" && v.trim())) {
              errors.push(`${where}: pick at least one support group.`);
            }
          } else {
            errors.push(`${where}: unknown condition type ${pyRepr(ctype)}.`);
          }
        });
      });
    });
    return errors;
  }
  function domainNames(items) {
    const names = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const name = item["name"];
        if (typeof name === "string" && name.trim()) names.push(name.trim());
      }
    }
    return [...names, UNASSIGNED];
  }
  function recordTags(record) {
    const va = record["vulnerableAsset"];
    if (va && typeof va === "object" && !Array.isArray(va)) {
      const t = va["tags"];
      if (t && typeof t === "object" && !Array.isArray(t)) return t;
    }
    const flat = record["vulnerableAsset.tags"];
    if (flat && typeof flat === "object" && !Array.isArray(flat)) return flat;
    const out = {};
    for (const [k, v] of Object.entries(record)) {
      if (k.startsWith(FRAME_TAGS_PREFIX) && present(v)) out[k.slice(FRAME_TAGS_PREFIX.length)] = v;
    }
    if (Object.keys(out).length) return out;
    const tagsJson2 = record["tags_json"];
    if (typeof tagsJson2 === "string" && tagsJson2) {
      try {
        const parsed = JSON.parse(tagsJson2);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch {
      }
    }
    return {};
  }
  function recordValues(record, ...keys) {
    const out = [];
    const va = record["vulnerableAsset"];
    for (const k of keys) {
      const v = record[k];
      if (present(v)) {
        out.push(String(v));
      } else if (va && typeof va === "object" && !Array.isArray(va)) {
        const leaf = va[k.split(".").pop()];
        if (present(leaf)) out.push(String(leaf));
      }
    }
    return out;
  }
  function conditionMatches(spec, record, tags) {
    if (spec.kind === "tag") {
      if (!(spec.key in tags) || tags[spec.key] === null || tags[spec.key] === void 0) {
        return false;
      }
      return spec.value === null || fold(tags[spec.key]) === spec.value;
    }
    if (spec.kind === "regex") {
      const names = recordValues(record, ...FRAME_NAME_COLS);
      const pool = names.length ? names : recordValues(record, ...LEDGER_NAME_COLS);
      return pool.some((n) => n !== COMPACTED_ASSET && spec.re.test(n));
    }
    if (spec.kind === "sg") {
      const sgs = [
        ...recordValues(record, ...FRAME_SG_COLS),
        ...recordValues(record, ...LEDGER_SG_COLS)
      ];
      return sgs.some((s) => spec.values.has(fold(s)));
    }
    const subs = [
      ...recordValues(record, ...FRAME_SUB_COLS),
      ...recordValues(record, ...LEDGER_SUB_COLS)
    ];
    return subs.some((s) => spec.values.has(fold(s)));
  }
  function assignDomain(record, compiled) {
    const tags = recordTags(record);
    for (const dom of compiled) {
      for (const rule of dom.rules) {
        if (rule && rule.every((spec) => conditionMatches(spec, record, tags))) {
          return dom.name;
        }
      }
    }
    return UNASSIGNED;
  }
  function hasDomainInputs(record) {
    const names = recordValues(record, ...FRAME_NAME_COLS, ...LEDGER_NAME_COLS).filter(
      (n) => n !== COMPACTED_ASSET
    );
    if (names.length) return true;
    if (recordValues(record, ...FRAME_SUB_COLS, ...LEDGER_SUB_COLS).length) return true;
    if (recordValues(record, ...FRAME_SG_COLS).length || recordValues(record, ...LEDGER_SG_COLS).length) {
      return true;
    }
    return Object.values(recordTags(record)).some((v) => present(v));
  }

  // src/domain/resolveDomain.ts
  var NOT_ATTRIBUTABLE = "Not attributable";
  function resolveDomain(record, compiled, tagKey = DEFAULT_DOMAIN_TAG_KEY) {
    const attached = record["_bizDomain"];
    const tag = typeof attached === "string" && attached ? attached : domainOfTags(recordTags(record), tagKey);
    if (tag) return { name: tag, source: "tag" };
    if (!hasDomainInputs(record)) return { name: NOT_ATTRIBUTABLE, source: "missing" };
    const ruled = assignDomain(record, compiled);
    return { name: ruled, source: ruled === UNASSIGNED ? "none" : "rule" };
  }
  function resolveDomainName(record, compiled, tagKey) {
    return resolveDomain(record, compiled, tagKey).name;
  }
  function resolvedDomainNames(tagValues, ruleNames) {
    const out = [];
    const seen2 = /* @__PURE__ */ new Set([UNASSIGNED, NOT_ATTRIBUTABLE]);
    for (const v of [...new Set(tagValues)].sort()) {
      if (!v || seen2.has(v)) continue;
      seen2.add(v);
      out.push(v);
    }
    for (const n of ruleNames) {
      if (!n || seen2.has(n)) continue;
      seen2.add(n);
      out.push(n);
    }
    out.push(UNASSIGNED, NOT_ATTRIBUTABLE);
    return out;
  }

  // src/domain/attribution.ts
  var NAME_COL = "vulnerableAsset.name";
  var TYPE_COL = "vulnerableAsset.type";
  var SUB_COL = "vulnerableAsset.subscriptionName";
  var EXT_COL = "vulnerableAsset.subscriptionExternalId";
  var SG_COL = "_supportGroup";
  var DOMAIN_COL = "_domain";
  var SOURCE_COL = "_domainSource";
  var NONE = "(none)";
  var MAX_TAG_KEYS = 12;
  var MAX_TAG_VALUE_LEN = 80;
  var MAX_NEAR_MISSES = 3;
  var KIND_LABEL = {
    tag: "tag",
    regex: "name",
    sub: "subscription",
    sg: "support group"
  };
  function domainOf(r) {
    const v = r[DOMAIN_COL];
    return present(v) ? String(v) : UNASSIGNED;
  }
  function sourceOf(r) {
    const v = r[SOURCE_COL];
    if (v === "tag" || v === "rule" || v === "none" || v === "missing") return v;
    const dom = domainOf(r);
    if (dom === NOT_ATTRIBUTABLE) return "missing";
    if (dom === UNASSIGNED) return "none";
    return "rule";
  }
  function sevOf(r) {
    const s = r["_sev"];
    return typeof s === "string" && s ? s : normalizeSeverity(r["severity"]);
  }
  function addSev(counts, r) {
    var _a;
    const s = sevOf(r);
    counts[s] = ((_a = counts[s]) != null ? _a : 0) + 1;
  }
  function flatVal(r, key) {
    const v = r[key];
    return present(v) ? String(v) : null;
  }
  function assetKey(r) {
    var _a;
    return String((_a = r[NAME_COL]) != null ? _a : "");
  }
  function traceRecord(record, compiled) {
    const tags = recordTags(record);
    const rules = [];
    let assigned = UNASSIGNED;
    compiled.forEach((dom, domainIndex) => {
      dom.rules.forEach((rule, ruleIndex) => {
        if (rule === null) {
          rules.push({ domainIndex, domain: dom.name, ruleIndex, malformed: true, matched: false, conditions: [] });
          return;
        }
        const conditions = rule.map((spec, index) => ({ index, matched: conditionMatches(spec, record, tags) }));
        const matched = conditions.every((c) => c.matched);
        rules.push({ domainIndex, domain: dom.name, ruleIndex, malformed: false, matched, conditions });
        if (matched && assigned === UNASSIGNED) assigned = dom.name;
      });
    });
    return { assigned, rules };
  }
  function ruleHealth(records, compiled) {
    const stats = compiled.map((dom) => dom.rules.map(() => ({ fired: 0, matched: 0 })));
    for (const record of records) {
      const trace = traceRecord(record, compiled);
      for (const rt of trace.rules) {
        if (rt.matched) stats[rt.domainIndex][rt.ruleIndex].matched += 1;
      }
      if (trace.assigned !== UNASSIGNED) {
        const winner = trace.rules.find((rt) => rt.matched && rt.domain === trace.assigned);
        if (winner) stats[winner.domainIndex][winner.ruleIndex].fired += 1;
      }
    }
    const out = [];
    compiled.forEach((dom, domainIndex) => {
      dom.rules.forEach((rule, ruleIndex) => {
        const { fired, matched } = stats[domainIndex][ruleIndex];
        const status = rule === null ? "malformed" : matched === 0 ? "dead" : fired === 0 ? "shadowed" : "ok";
        out.push({ domainIndex, domain: dom.name, ruleIndex, fired, matched, status });
      });
    });
    return out;
  }
  function orderedWithTailsLast(names, includeNotAttributable) {
    const seen2 = /* @__PURE__ */ new Set([UNASSIGNED, NOT_ATTRIBUTABLE]);
    const out = [];
    for (const n of names) {
      if (seen2.has(n)) continue;
      seen2.add(n);
      out.push(n);
    }
    out.push(UNASSIGNED);
    if (includeNotAttributable) out.push(NOT_ATTRIBUTABLE);
    return out;
  }
  function coverage(records, orderedDomainNames) {
    var _a;
    const findingsByDomain = /* @__PURE__ */ new Map();
    const assetsByDomain = /* @__PURE__ */ new Map();
    const allAssets = /* @__PURE__ */ new Set();
    const attributedAssets = /* @__PURE__ */ new Set();
    const unassignedAssets = /* @__PURE__ */ new Set();
    let attributedFindings = 0;
    let unassignedFindings = 0;
    let sgResolved = 0;
    let sgUnresolved = 0;
    const bySource = { tag: 0, rule: 0, none: 0, missing: 0 };
    for (const r of records) {
      const domain = domainOf(r);
      const asset = assetKey(r);
      bySource[sourceOf(r)] += 1;
      findingsByDomain.set(domain, ((_a = findingsByDomain.get(domain)) != null ? _a : 0) + 1);
      let set = assetsByDomain.get(domain);
      if (!set) assetsByDomain.set(domain, set = /* @__PURE__ */ new Set());
      if (asset) {
        set.add(asset);
        allAssets.add(asset);
      }
      if (domain === NOT_ATTRIBUTABLE) {
      } else if (domain === UNASSIGNED) {
        unassignedFindings += 1;
        if (asset) unassignedAssets.add(asset);
      } else {
        attributedFindings += 1;
        if (asset) attributedAssets.add(asset);
      }
      if (present(r[SG_COL])) sgResolved += 1;
      else sgUnresolved += 1;
    }
    const byDomain = orderedWithTailsLast(orderedDomainNames, bySource.missing > 0).map(
      (domain) => {
        var _a2, _b, _c;
        return {
          domain,
          findings: (_a2 = findingsByDomain.get(domain)) != null ? _a2 : 0,
          assets: (_c = (_b = assetsByDomain.get(domain)) == null ? void 0 : _b.size) != null ? _c : 0
        };
      }
    );
    return {
      totalFindings: records.length,
      totalAssets: allAssets.size,
      attributedFindings,
      attributedAssets: attributedAssets.size,
      unassignedFindings,
      unassignedAssets: unassignedAssets.size,
      supportGroupResolved: sgResolved,
      supportGroupUnresolved: sgUnresolved,
      byDomain,
      bySource
    };
  }
  function supportGroupBreakdown(records) {
    var _a, _b, _c, _d;
    const findingsByGroup = /* @__PURE__ */ new Map();
    const assetsByGroup = /* @__PURE__ */ new Map();
    const allAssets = /* @__PURE__ */ new Set();
    const resolvedAssets = /* @__PURE__ */ new Set();
    const unresolvedAssets = /* @__PURE__ */ new Set();
    let resolvedFindings = 0;
    let unresolvedFindings = 0;
    for (const r of records) {
      const sg = flatVal(r, SG_COL);
      const group = sg != null ? sg : NONE;
      const asset = assetKey(r);
      findingsByGroup.set(group, ((_a = findingsByGroup.get(group)) != null ? _a : 0) + 1);
      let set = assetsByGroup.get(group);
      if (!set) assetsByGroup.set(group, set = /* @__PURE__ */ new Set());
      if (asset) {
        set.add(asset);
        allAssets.add(asset);
      }
      if (sg) {
        resolvedFindings += 1;
        if (asset) resolvedAssets.add(asset);
      } else {
        unresolvedFindings += 1;
        if (asset) unresolvedAssets.add(asset);
      }
    }
    const rows = [...findingsByGroup.entries()].filter(([g]) => g !== NONE).map(([group, findings]) => {
      var _a2, _b2;
      return {
        group,
        findings,
        assets: (_b2 = (_a2 = assetsByGroup.get(group)) == null ? void 0 : _a2.size) != null ? _b2 : 0,
        unresolved: false
      };
    }).sort((a, b) => b.findings - a.findings || a.group.localeCompare(b.group));
    const distinctGroups = rows.length;
    if (findingsByGroup.has(NONE)) {
      rows.push({
        group: NONE,
        findings: (_b = findingsByGroup.get(NONE)) != null ? _b : 0,
        assets: (_d = (_c = assetsByGroup.get(NONE)) == null ? void 0 : _c.size) != null ? _d : 0,
        unresolved: true
      });
    }
    return {
      totalFindings: records.length,
      totalAssets: allAssets.size,
      resolvedFindings,
      unresolvedFindings,
      resolvedAssets: resolvedAssets.size,
      unresolvedAssets: unresolvedAssets.size,
      distinctGroups,
      rows
    };
  }
  function cappedTags(record) {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(recordTags(record))) {
      if (!present(v)) continue;
      if (n >= MAX_TAG_KEYS) break;
      const s = String(v);
      out[k] = s.length > MAX_TAG_VALUE_LEN ? s.slice(0, MAX_TAG_VALUE_LEN) : s;
      n += 1;
    }
    return out;
  }
  function failedTypes(compiled, rt) {
    const rule = compiled[rt.domainIndex].rules[rt.ruleIndex];
    if (!rule) return [];
    const out = [];
    for (const c of rt.conditions) {
      if (c.matched) continue;
      const label = KIND_LABEL[rule[c.index].kind];
      if (!out.includes(label)) out.push(label);
    }
    return out;
  }
  function nearMisses(record, compiled) {
    const trace = traceRecord(record, compiled);
    const cand = trace.rules.filter((rt) => !rt.malformed && rt.conditions.some((c) => c.matched)).map((rt) => {
      const matchedConditions = rt.conditions.filter((c) => c.matched).length;
      return {
        domainIndex: rt.domainIndex,
        nm: {
          domain: rt.domain,
          ruleIndex: rt.ruleIndex,
          matchedConditions,
          totalConditions: rt.conditions.length,
          failedTypes: failedTypes(compiled, rt)
        }
      };
    });
    cand.sort(
      (a, b) => b.nm.matchedConditions - a.nm.matchedConditions || a.nm.totalConditions - a.nm.matchedConditions - (b.nm.totalConditions - b.nm.matchedConditions) || a.domainIndex - b.domainIndex || a.nm.ruleIndex - b.nm.ruleIndex
    );
    return cand.slice(0, MAX_NEAR_MISSES).map((c) => c.nm);
  }
  function unassignedResources(records, compiled) {
    const groups = /* @__PURE__ */ new Map();
    for (const r of records) {
      if (domainOf(r) !== UNASSIGNED) continue;
      const asset = assetKey(r);
      let g = groups.get(asset);
      if (!g) groups.set(asset, g = { rep: r, findings: 0, sevCounts: {} });
      g.findings += 1;
      addSev(g.sevCounts, r);
    }
    const rows = [];
    for (const [asset, g] of groups) {
      rows.push({
        asset,
        assetType: flatVal(g.rep, TYPE_COL),
        subscription: flatVal(g.rep, SUB_COL),
        subscriptionExtId: flatVal(g.rep, EXT_COL),
        supportGroup: flatVal(g.rep, SG_COL),
        tags: cappedTags(g.rep),
        findings: g.findings,
        sevCounts: g.sevCounts,
        nearMisses: nearMisses(g.rep, compiled)
      });
    }
    rows.sort((a, b) => b.findings - a.findings || a.asset.localeCompare(b.asset));
    return rows;
  }
  function untaggedSubscriptions(records) {
    var _a, _b;
    const groups = /* @__PURE__ */ new Map();
    for (const r of records) {
      if (present(r[SG_COL])) continue;
      const subscription = (_a = flatVal(r, SUB_COL)) != null ? _a : NONE;
      const extId = (_b = flatVal(r, EXT_COL)) != null ? _b : NONE;
      const key = `${subscription}\0${extId}`;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { subscription, extId, assets: /* @__PURE__ */ new Set(), findings: 0, sevCounts: {} });
      g.findings += 1;
      const asset = assetKey(r);
      if (asset) g.assets.add(asset);
      addSev(g.sevCounts, r);
    }
    return [...groups.values()].map((g) => ({
      subscription: g.subscription,
      extId: g.extId,
      assets: g.assets.size,
      findings: g.findings,
      sevCounts: g.sevCounts
    })).sort(
      (a, b) => b.findings - a.findings || a.subscription.localeCompare(b.subscription) || a.extId.localeCompare(b.extId)
    );
  }

  // src/domain/metrics.ts
  var DAY_MS2 = 864e5;
  function findCol(columns, ...candidates) {
    const lower = columns.map((c) => c.toLowerCase());
    for (const cand of candidates) {
      const needle = cand.toLowerCase();
      for (let i = 0; i < lower.length; i++) {
        if (lower[i].includes(needle)) return columns[i];
      }
    }
    return null;
  }
  function recordColumns(records) {
    const cols = [];
    const seen2 = /* @__PURE__ */ new Set();
    for (const rec of records) {
      for (const k of Object.keys(rec)) {
        if (!seen2.has(k)) {
          seen2.add(k);
          cols.push(k);
        }
      }
    }
    return cols;
  }
  function calculateMttr(records, now) {
    if (!records.length) return { perSev: {}, overall: {} };
    const columns = recordColumns(records);
    const firstSeenCol = findCol(columns, "firstSeenAt", "firstDetectedAt", "createdAt");
    const resolvedCol = findCol(columns, "resolvedAt", "remediatedAt", "fixedAt");
    if (!firstSeenCol) return { perSev: {}, overall: {} };
    const work = records.map((rec) => ({
      sev: "severity" in rec ? normalizeSeverity(rec["severity"]) : "UNKNOWN",
      firstSeen: parseTs(rec[firstSeenCol]),
      resolved: resolvedCol ? parseTs(rec[resolvedCol]) : null
    }));
    return summarize(work, now);
  }
  function summarize(work, now) {
    var _a;
    if (!work.length) return { perSev: {}, overall: {} };
    const nowMs = now != null ? now : Date.now();
    const mttrDays = (r) => r.resolved !== null && r.firstSeen !== null ? (r.resolved - r.firstSeen) / DAY_MS2 : null;
    const ageDays = (r) => r.firstSeen !== null ? (nowMs - r.firstSeen) / DAY_MS2 : null;
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
  function field(record, ...keys) {
    for (const k of keys) {
      const v = record[k];
      if (present(v)) return pyStr(v);
    }
    const va = record["vulnerableAsset"];
    if (va && typeof va === "object" && !Array.isArray(va)) {
      for (const k of keys) {
        const leaf = k.split(".").pop();
        const v = va[leaf];
        if (present(v)) return pyStr(v);
      }
    }
    return "";
  }
  function vulnKey(record) {
    const fid = record["id"];
    if (typeof fid === "string" && fid.trim()) return `id:${fid.trim()}`;
    const cve = field(record, "name");
    const asset = field(record, "vulnerableAsset.id", "assetId") || field(record, "vulnerableAsset.name");
    const atype = field(record, "vulnerableAsset.type", "type");
    const cloud = field(record, "vulnerableAsset.cloudPlatform", "cloudPlatform");
    const component = field(record, "detailedName", "detailedNameV2");
    const basis = [cve, asset, atype, cloud, component].join("|");
    return "h:" + sha1Hex(basis).slice(0, 16);
  }
  function mttrFromLedger(ledgerRows, opts = {}) {
    const rows = [...ledgerRows];
    if (!rows.length) return { perSev: {}, overall: {} };
    const work = rows.map((r) => ({
      sev: "severity" in r ? normalizeSeverity(r["severity"]) : "UNKNOWN",
      firstSeen: parseTs(r["first_seen"]),
      resolved: parseTs(r["resolved_at"])
    }));
    return summarize(work, opts.now);
  }

  // src/domain/remediation.ts
  var DAY_MS3 = 864e5;
  var ROLLOUT_MS = parseTs(REMEDIATION_ROLLOUT_ISO);
  var RESOLUTION_BUCKET_EDGES = [1, 7, 30, 90];
  var RESOLUTION_BUCKET_LABELS = ["\u22641d", "2\u20137d", "8\u201330d", "31\u201390d", "90+d"];
  function isOpen2(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function resolvedMttr(row) {
    const m = row.mttr_days;
    return typeof m === "number" && Number.isFinite(m) ? m : null;
  }
  function openAge(row) {
    if (!isOpen2(row.status)) return null;
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
  function openPastSlaFromRecords(records, now) {
    if (!records.length) return 0;
    const nowMs = now != null ? now : Date.now();
    const firstSeenCol = findCol(recordColumns(records), "firstSeenAt", "firstDetectedAt", "createdAt");
    if (!firstSeenCol) return 0;
    let breached = 0;
    for (const rec of records) {
      if (!isOpen2(rec["status"])) continue;
      const first = parseTs(rec[firstSeenCol]);
      if (first === null) continue;
      const s = "severity" in rec ? normalizeSeverity(rec["severity"]) : "UNKNOWN";
      const target = SLA_TARGETS[s];
      if (target !== void 0 && (nowMs - first) / DAY_MS3 > target) breached += 1;
    }
    return breached;
  }
  function actionableView(rows) {
    return rows.map((r) => ({
      severity: r.severity,
      status: r.status,
      mttr_days: r.mttr_actionable_days,
      age_days: r.actionable_age_days
    }));
  }
  function awaitingVendorFix(rows) {
    var _a;
    const perSev = {};
    let overall = 0;
    let openTotal = 0;
    for (const row of rows) {
      if (!isOpen2(row.status)) continue;
      openTotal += 1;
      if (!row.awaiting_vendor_fix) continue;
      const s = normalizeSeverity(row.severity);
      perSev[s] = ((_a = perSev[s]) != null ? _a : 0) + 1;
      overall += 1;
    }
    return {
      perSev,
      overall,
      openTotal,
      pctOfOpen: openTotal ? overall / openTotal * 100 : null
    };
  }
  function baseRowNoFix(row) {
    return row.awaiting_vendor_fix === true;
  }
  function recordNoFix(rec) {
    var _a, _b;
    if (!isOpen2(rec["status"])) return false;
    const first = parseTs((_b = (_a = rec["firstDetectedAt"]) != null ? _a : rec["firstSeenAt"]) != null ? _b : rec["createdAt"]);
    if (first !== null && ROLLOUT_MS !== null && first < ROLLOUT_MS) return false;
    return !(present(rec["fixedVersion"]) || present(rec["fixDate"]));
  }
  function isEndOfLifeName(name) {
    if (typeof name !== "string" || !name) return false;
    const n = name.toLowerCase().replace(/[^a-z]+/g, " ");
    return n.includes("end of life") && n.includes("operating system");
  }
  function recordEol(rec) {
    return rec["isOperatingSystemEndOfLife"] === true || isEndOfLifeName(rec["name"]);
  }

  // src/domain/compaction.ts
  var CHECKPOINT_VERSION = 1;
  function serializeSeverities(sevs) {
    if (sevs === null || sevs === void 0) return null;
    const vals = /* @__PURE__ */ new Set();
    for (const s of sevs) {
      if (typeof s === "string") {
        const n = normalizeSeverity(s);
        if (SELECTABLE_SEVERITIES.includes(n)) vals.add(n);
      }
    }
    if (!vals.size || vals.size === SELECTABLE_SEVERITIES.length) return null;
    const ordered = SEVERITY_ORDER.filter((s) => vals.has(s));
    return `[${ordered.map((s) => JSON.stringify(s)).join(", ")}]`;
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
    const out = SEVERITY_ORDER.filter((s) => chosen.has(s));
    return out.length ? out : null;
  }
  function selectSealCandidates(rows, cutoffMs) {
    const flatIds = rows.filter((r) => r.shape === "flat").map((r) => r.scan_id);
    const protectedIds = new Set(flatIds.slice(-MIN_UNSEALED_FLAT_SCANS));
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

  // src/domain/reconcile.ts
  var LEDGER_COLUMNS = [
    "vuln_key",
    "cve",
    "severity",
    "asset_id",
    "asset_name",
    "asset_type",
    "cloud",
    "first_seen",
    "last_seen",
    "status",
    "resolved_at",
    "resolution_src",
    "reopened_count",
    "first_scan_id",
    "last_scan_id",
    "subscription_name",
    "subscription_ext_id",
    "tags_json",
    "fix_date",
    "fix_observed_at",
    "has_kev",
    "has_exploit",
    "epss",
    "risk_observed_at"
  ];
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
    const keys = Object.keys(kept).sort();
    if (!keys.length) return null;
    const parts = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(kept[k])}`);
    return `{${parts.join(", ")}}`;
  }
  function makeRow(record, key, sev2, firstSeen, scanId, scanTs, fixDate, fixObservedAt) {
    var _a;
    return {
      vuln_key: key,
      cve: (_a = clean(record["name"])) != null ? _a : null,
      severity: sev2,
      asset_id: field(record, "vulnerableAsset.id") || null,
      asset_name: field(record, "vulnerableAsset.name") || null,
      asset_type: field(record, "vulnerableAsset.type") || null,
      cloud: field(record, "vulnerableAsset.cloudPlatform") || null,
      subscription_name: field(record, "vulnerableAsset.subscriptionName") || null,
      subscription_ext_id: field(record, "vulnerableAsset.subscriptionExternalId", "vulnerableAsset.subscriptionId") || null,
      tags_json: tagsJson(record),
      first_seen: firstSeen,
      last_seen: scanTs,
      status: "OPEN",
      resolved_at: null,
      resolution_src: null,
      reopened_count: 0,
      first_scan_id: scanId,
      last_scan_id: scanId,
      fix_date: fixDate,
      fix_observed_at: fixObservedAt,
      // Left empty here and filled by mergeRiskSignals() after the branch, which runs for new,
      // reopened, and persisting rows alike (the merge is identical in all three).
      ...emptyRiskSignals()
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
        const s = v.trim().toUpperCase();
        if (s === "TRUE") return true;
        if (s === "FALSE") return false;
      }
      return null;
    };
    const rawEpss = clean(rec["epssProbability"]);
    const n = typeof rawEpss === "number" ? rawEpss : rawEpss === null ? NaN : Number(rawEpss);
    return {
      kev: bool(rec["hasCisaKevExploit"]),
      exploit: bool(rec["hasExploit"]),
      epss: Number.isFinite(n) ? n : null
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
  function reconcile(currentRecords, existingLedger, scanId, scanTs, prevScanId, options = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
    const {
      disappearanceMode = "scan_ts",
      prevScanTs = null,
      scannedSeverities = null,
      prevScanIdBySeverity: prevScanIdBySeverity2 = null
    } = options;
    const updated = {};
    for (const [key, row] of Object.entries(existingLedger)) updated[key] = { ...row };
    const seen2 = /* @__PURE__ */ new Set();
    const observations = [];
    let newCount = 0;
    let resolvedCount = 0;
    let reopenedCount = 0;
    const scanTsIso = (_a = toIso(parseTs(scanTs))) != null ? _a : String(scanTs);
    for (const rec of currentRecords) {
      const key = vulnKey(rec);
      if (seen2.has(key)) continue;
      seen2.add(key);
      const sev2 = normalizeSeverity(clean(rec["severity"]));
      const apiFirst = (_c = (_b = clean(rec["firstDetectedAt"])) != null ? _b : clean(rec["firstSeenAt"])) != null ? _c : clean(rec["createdAt"]);
      const apiStatus = String((_d = clean(rec["status"])) != null ? _d : "").toUpperCase();
      const apiResolved = (_f = (_e = clean(rec["resolvedAt"])) != null ? _e : clean(rec["remediatedAt"])) != null ? _f : clean(rec["fixedAt"]);
      const apiSaysResolved = present(apiResolved) || RESOLVED_STATUSES.has(apiStatus);
      const fixSignal = present(rec["fixedVersion"]) || present(rec["fixDate"]);
      const recFixDate = present(rec["fixDate"]) ? toIso(parseTs(rec["fixDate"])) : null;
      const seedFix = (r) => {
        if (r.fix_date == null && recFixDate !== null) r.fix_date = recFixDate;
        if (r.fix_observed_at == null && fixSignal) r.fix_observed_at = scanTsIso;
      };
      let row = updated[key];
      if (row === void 0) {
        const firstSeen = (_g = minIso(apiFirst, scanTsIso)) != null ? _g : scanTsIso;
        row = makeRow(rec, key, sev2, firstSeen, scanId, scanTsIso, recFixDate, fixSignal ? scanTsIso : null);
        updated[key] = row;
        newCount += 1;
      } else if (row.status === "RESOLVED" && !apiSaysResolved) {
        row.status = "OPEN";
        row.resolved_at = null;
        row.resolution_src = null;
        row.reopened_count = Number((_h = row.reopened_count) != null ? _h : 0) + 1;
        row.first_seen = (_i = minIso(apiFirst, scanTsIso)) != null ? _i : scanTsIso;
        row.last_seen = scanTsIso;
        row.last_scan_id = scanId;
        row.fix_date = null;
        row.fix_observed_at = null;
        seedFix(row);
        reopenedCount += 1;
      } else {
        if (row.status === "OPEN") {
          row.first_seen = (_j = minIso(row.first_seen, apiFirst)) != null ? _j : row.first_seen;
        }
        row.last_seen = scanTsIso;
        row.last_scan_id = scanId;
        seedFix(row);
      }
      mergeRiskSignals(row, rec, scanTsIso);
      row.severity = sev2;
      row.cve = (_k = clean(rec["name"])) != null ? _k : null;
      row.asset_id = field(rec, "vulnerableAsset.id") || row.asset_id;
      row.asset_name = field(rec, "vulnerableAsset.name") || row.asset_name;
      row.asset_type = field(rec, "vulnerableAsset.type") || row.asset_type;
      row.cloud = field(rec, "vulnerableAsset.cloudPlatform") || row.cloud;
      row.subscription_name = field(rec, "vulnerableAsset.subscriptionName") || row.subscription_name;
      row.subscription_ext_id = field(rec, "vulnerableAsset.subscriptionExternalId", "vulnerableAsset.subscriptionId") || row.subscription_ext_id;
      row.tags_json = (_l = tagsJson(rec)) != null ? _l : row.tags_json;
      if (apiSaysResolved && row.status === "OPEN") {
        row.status = "RESOLVED";
        row.resolved_at = present(apiResolved) ? toIso(parseTs(apiResolved)) : scanTsIso;
        row.resolution_src = "api";
        resolvedCount += 1;
      }
      observations.push({
        scan_id: scanId,
        vuln_key: key,
        present: 1,
        severity: sev2,
        status: row.status
      });
    }
    if (prevScanId !== null) {
      const scope = scannedSeverities !== null ? new Set(scannedSeverities) : null;
      for (const [key, row] of Object.entries(updated)) {
        if (seen2.has(key) || row.status === "RESOLVED") continue;
        const sevRow = row.severity;
        if (scope !== null && (sevRow === null || !scope.has(sevRow))) {
          continue;
        }
        const expectedPrev = (_m = (prevScanIdBySeverity2 != null ? prevScanIdBySeverity2 : {})[sevRow != null ? sevRow : ""]) != null ? _m : prevScanId;
        if (row.last_scan_id !== expectedPrev) continue;
        if (disappearanceMode === "midpoint" && prevScanTs) {
          row.resolved_at = midpointIso(prevScanTs, scanTsIso);
        } else {
          row.resolved_at = scanTsIso;
        }
        row.status = "RESOLVED";
        row.resolution_src = "disappeared";
        resolvedCount += 1;
        observations.push({
          scan_id: scanId,
          vuln_key: key,
          present: 0,
          severity: row.severity,
          status: "RESOLVED"
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
      }
    };
  }

  // src/domain/ledgerCore.ts
  function emptyState() {
    return { scans: [], ledger: {}, episodes: [] };
  }
  function scansAsc(scans) {
    return [...scans].sort((a, b) => {
      var _a, _b;
      const ta = (_a = parseTs(a.ts)) != null ? _a : 0;
      const tb = (_b = parseTs(b.ts)) != null ? _b : 0;
      if (ta !== tb) return ta - tb;
      return a.scan_id < b.scan_id ? -1 : a.scan_id > b.scan_id ? 1 : 0;
    });
  }
  function latestScan(scans) {
    const asc = scansAsc(scans);
    return asc.length ? asc[asc.length - 1] : null;
  }
  function prevScanIdBySeverity(scans) {
    const remaining = new Set(SEVERITY_ORDER);
    const mapping = {};
    const desc = scansAsc(scans).reverse();
    for (const r of desc) {
      const scope = parseSeverities(r.severities);
      const covered = scope === null ? [...remaining] : [...remaining].filter((s) => scope.includes(s));
      for (const sev2 of covered) mapping[sev2] = r.scan_id;
      covered.forEach((s) => remaining.delete(s));
      if (!remaining.size) break;
    }
    return Object.keys(mapping).length ? mapping : null;
  }
  function existingScanDeltas(scans, scanId) {
    const row = scans.find((r) => r.scan_id === scanId);
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
    const episodeReopens = /* @__PURE__ */ new Map();
    for (const e of state.episodes) {
      if (e.superseded_by_scan === null && newKeys.includes(e.vuln_key)) {
        episodeReopens.set(e.vuln_key, e);
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
        if (!episode.tags_json && row.tags_json) episode.tags_json = row.tags_json;
        delete updated[key];
        deltas.new_count -= 1;
        deltas.resolved_count -= 1;
      }
    }
  }
  function persistFlatScan(state, records, options) {
    var _a, _b, _c, _d;
    const scanId = options.scanId || nowIso(options.now);
    const scanTs = scanId;
    const disappearanceMode = (_a = options.disappearanceMode) != null ? _a : DISAPPEARANCE_RESOLUTION;
    const severitiesText = serializeSeverities((_b = options.scannedSeverities) != null ? _b : null);
    const scope = parseSeverities(severitiesText);
    const existing = existingScanDeltas(state.scans, scanId);
    if (existing !== null) return { deltas: existing, observations: [], scanRow: null };
    const prev = latestScan(state.scans);
    const prevScanId = prev ? prev.scan_id : null;
    const prevScanTs = prev ? prev.ts : null;
    const prevBySev = prevScanId !== null ? prevScanIdBySeverity(state.scans) : null;
    const existingLedger = state.ledger;
    const { ledger: updated, observations, deltas } = reconcile(
      records,
      existingLedger,
      scanId,
      scanTs,
      prevScanId,
      {
        disappearanceMode,
        prevScanTs,
        scannedSeverities: scope,
        prevScanIdBySeverity: prevBySev
      }
    );
    reconcileEpisodeCollisions(state, updated, existingLedger, deltas, scanId);
    const scanRow = {
      scan_id: scanId,
      ts: scanTs,
      mode: options.mode,
      shape: "flat",
      total: records.length,
      new_count: deltas.new_count,
      resolved_count: deltas.resolved_count,
      reopened_count: deltas.reopened_count,
      raw_ref: (_c = options.rawRef) != null ? _c : null,
      obs_ref: (_d = options.obsRef) != null ? _d : null,
      severities: severitiesText,
      sealed: 0
    };
    state.scans.push(scanRow);
    state.ledger = updated;
    return { deltas, observations, scanRow };
  }
  function persistGroupedScan(state, nodes, options) {
    var _a, _b;
    const scanId = options.scanId || nowIso(options.now);
    const zero = { new_count: 0, resolved_count: 0, reopened_count: 0 };
    if (existingScanDeltas(state.scans, scanId) !== null) {
      return { deltas: zero, scanRow: null };
    }
    const scanRow = {
      scan_id: scanId,
      ts: scanId,
      mode: options.mode,
      shape: "grouped",
      total: nodes.length,
      new_count: 0,
      resolved_count: 0,
      reopened_count: 0,
      raw_ref: (_a = options.rawRef) != null ? _a : null,
      obs_ref: null,
      severities: serializeSeverities((_b = options.scannedSeverities) != null ? _b : null),
      sealed: 0
    };
    state.scans.push(scanRow);
    return { deltas: zero, scanRow };
  }
  function reinsertScanRow(state, row) {
    state.scans.push({ ...row });
  }
  var DAY_MS4 = 864e5;
  var COMPACTED_ASSET2 = "(compacted)";
  var ROLLOUT_MS2 = parseTs(REMEDIATION_ROLLOUT_ISO);
  function baseRows(state, now) {
    var _a;
    const nowMs = now != null ? now : Date.now();
    const out = [];
    const withDerived = (row) => {
      var _a2, _b;
      const first = parseTs(row.first_seen);
      const resolved = parseTs(row.resolved_at);
      const open = row.status === "OPEN";
      const fixAvailableAt = first !== null && ROLLOUT_MS2 !== null && first < ROLLOUT_MS2 ? row.first_seen : (_b = (_a2 = row.fix_date) != null ? _a2 : row.fix_observed_at) != null ? _b : null;
      const fixAvailMs = parseTs(fixAvailableAt);
      const actionableMs = fixAvailMs === null ? null : first === null ? fixAvailMs : Math.max(first, fixAvailMs);
      const actionableFrom = actionableMs === null ? null : toIso(actionableMs);
      return {
        ...row,
        mttr_days: first !== null && resolved !== null ? (resolved - first) / DAY_MS4 : null,
        age_days: resolved === null && first !== null ? (nowMs - first) / DAY_MS4 : null,
        fix_available_at: fixAvailableAt,
        actionable_from: actionableFrom,
        mttr_actionable_days: resolved !== null && actionableMs !== null ? (resolved - actionableMs) / DAY_MS4 : null,
        actionable_age_days: open && actionableMs !== null ? (nowMs - actionableMs) / DAY_MS4 : null,
        awaiting_vendor_fix: open && fixAvailableAt === null
      };
    };
    for (const row of Object.values(state.ledger)) out.push(withDerived(row));
    for (const e of state.episodes) {
      if (e.superseded_by_scan !== null) continue;
      if (e.vuln_key in state.ledger) continue;
      out.push(
        withDerived({
          vuln_key: e.vuln_key,
          cve: e.cve,
          severity: e.severity,
          asset_id: null,
          asset_name: COMPACTED_ASSET2,
          asset_type: null,
          cloud: null,
          first_seen: e.first_seen,
          last_seen: e.resolved_at,
          status: "RESOLVED",
          resolved_at: e.resolved_at,
          resolution_src: e.resolution_src,
          reopened_count: e.reopened_count,
          first_scan_id: null,
          last_scan_id: null,
          subscription_name: null,
          subscription_ext_id: null,
          // Carried through compaction now (see EpisodeRow), so a sealed episode still knows
          // which domain owned it. Null on episodes written before the column existed, and on
          // every legacy imported bundle — those read as Not attributable, which is the truth.
          tags_json: (_a = e.tags_json) != null ? _a : null,
          fix_date: e.fix_date,
          fix_observed_at: e.fix_observed_at,
          has_kev: e.has_kev,
          has_exploit: e.has_exploit,
          epss: e.epss,
          risk_observed_at: e.risk_observed_at
        })
      );
    }
    return out;
  }

  // src/domain/transform.ts
  function coerceResults(results) {
    if (results === null || results === void 0) return results;
    if (typeof results === "object") return results;
    if (typeof results === "string") {
      const s = results.trim();
      try {
        return JSON.parse(s);
      } catch {
        return results;
      }
    }
    return results;
  }
  function extractNodes(results) {
    var _a, _b, _c;
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
        const d = data;
        const vf = d["vulnerabilityFindings"];
        if (vf && typeof vf === "object" && !Array.isArray(vf) && "nodes" in vf) {
          return (_a = vf["nodes"]) != null ? _a : [];
        }
        for (const v of Object.values(d)) {
          if (v && typeof v === "object" && !Array.isArray(v) && "nodes" in v) {
            return (_b = v["nodes"]) != null ? _b : [];
          }
        }
      }
      if ("nodes" in obj) return (_c = obj["nodes"]) != null ? _c : [];
    }
    if (Array.isArray(coerced)) return coerced;
    return [coerced];
  }
  function mergeNodes(baselineNodes, deltaNodes) {
    const byKey = /* @__PURE__ */ new Map();
    for (const node of deltaNodes != null ? deltaNodes : []) byKey.set(vulnKey(node), node);
    const merged = [];
    for (const node of baselineNodes != null ? baselineNodes : []) {
      const key = vulnKey(node);
      if (byKey.has(key)) {
        merged.push(byKey.get(key));
        byKey.delete(key);
      } else {
        merged.push(node);
      }
    }
    pushAll(merged, byKey.values());
    return merged;
  }
  function flattenNode(node, prefix = "") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(out, flattenNode(v, key));
      } else {
        out[key] = v;
      }
    }
    return out;
  }

  // src/domain/trend.ts
  var DAY_MS5 = 864e5;
  function awaitingFixAsOf(firstMs, resolvedMs, fixAvailMs, d) {
    const openAsOfD = firstMs !== null && firstMs <= d && (resolvedMs === null || resolvedMs > d);
    return openAsOfD && (fixAvailMs === null || fixAvailMs > d);
  }
  function trendFromFrames(scans, base, severities = null, opts = {}) {
    var _a;
    const hideNoFix = (_a = opts.hideNoFix) != null ? _a : false;
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (!scans.length || !rows.length) return [];
    const flatTs = scans.filter((s) => s["shape"] === "flat").map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
    if (!flatTs.length) return [];
    const parsed = rows.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"]) ? r["mttr_days"] : null,
      sev: normalizeSeverity(r["severity"]),
      fixAvail: parseTs(r["fix_available_at"])
    }));
    const out = [];
    for (const ts of flatTs) {
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
        const ages = parsed.filter((r, i) => openMask[i] && r.sev === sev2).map((r) => (ts.ms - r.first) / DAY_MS5);
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
        median_days: med !== null ? Math.round(med * 1e3) / 1e3 : null,
        sla_pct: slaPct !== null ? Math.round(slaPct * 10) / 10 : null,
        oldest_open_days: oldest !== null ? Math.round(oldest * 1e3) / 1e3 : null
      });
    }
    return out;
  }
  function openBySeverityTrend(scans, base, severities = null, opts = {}) {
    var _a;
    const hideNoFix = (_a = opts.hideNoFix) != null ? _a : false;
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (!scans.length || !rows.length) return [];
    const flatTs = scans.filter((s) => s["shape"] === "flat").map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
    if (!flatTs.length) return [];
    const parsed = rows.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      sev: normalizeSeverity(r["severity"]),
      fixAvail: parseTs(r["fix_available_at"])
    }));
    return flatTs.map((ts) => {
      var _a2;
      const bySev = {};
      for (const r of parsed) {
        const isOpen4 = r.first !== null && r.first <= ts.ms && (r.resolvedAt === null || r.resolvedAt > ts.ms);
        if (!isOpen4) continue;
        if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)) continue;
        bySev[r.sev] = ((_a2 = bySev[r.sev]) != null ? _a2 : 0) + 1;
      }
      return { date: ts.iso, bySev };
    });
  }
  function openByGroupTrend(scans, base, keyOf, groups, opts = {}) {
    var _a, _b, _c, _d;
    const severities = (_a = opts.severities) != null ? _a : null;
    const includeOther = (_b = opts.includeOther) != null ? _b : true;
    const otherLabel = (_c = opts.otherLabel) != null ? _c : "Other";
    const hideNoFix = (_d = opts.hideNoFix) != null ? _d : false;
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (!scans.length || !rows.length) return [];
    const flatTs = scans.filter((s) => s["shape"] === "flat").map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
    if (!flatTs.length) return [];
    const inGroup = new Set(groups);
    const parsed = rows.map((r) => {
      const raw = keyOf(r);
      const value = raw.trim() === "" ? "(none)" : raw;
      const known = inGroup.has(value);
      return {
        first: parseTs(r["first_seen"]),
        resolvedAt: parseTs(r["resolved_at"]),
        fixAvail: parseTs(r["fix_available_at"]),
        group: known ? value : otherLabel,
        kept: known || includeOther
      };
    });
    return flatTs.map((ts) => {
      var _a2;
      const byGroup = {};
      for (const r of parsed) {
        if (!r.kept) continue;
        const isOpen4 = r.first !== null && r.first <= ts.ms && (r.resolvedAt === null || r.resolvedAt > ts.ms);
        if (!isOpen4) continue;
        if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)) continue;
        byGroup[r.group] = ((_a2 = byGroup[r.group]) != null ? _a2 : 0) + 1;
      }
      return { date: ts.iso, byGroup };
    });
  }
  function medianMttrByGroupTrend(scans, base, keyOf, groups, opts = {}) {
    var _a, _b, _c, _d;
    const severities = (_a = opts.severities) != null ? _a : null;
    const includeOther = (_b = opts.includeOther) != null ? _b : true;
    const otherLabel = (_c = opts.otherLabel) != null ? _c : "Other";
    const minMttrDays = (_d = opts.minMttrDays) != null ? _d : null;
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (!scans.length || !rows.length) return [];
    const flatTs = scans.filter((s) => s["shape"] === "flat").map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
    if (!flatTs.length) return [];
    const inGroup = new Set(groups);
    const parsed = rows.map((r) => {
      const raw = keyOf(r);
      const value = raw.trim() === "" ? "(none)" : raw;
      const known = inGroup.has(value);
      return {
        resolvedAt: parseTs(r["resolved_at"]),
        mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"]) ? r["mttr_days"] : null,
        group: known ? value : otherLabel,
        folded: !known && includeOther,
        kept: known || includeOther
      };
    });
    const hasOther = parsed.some((r) => r.folded);
    const names = hasOther ? [...groups, otherLabel] : groups;
    return flatTs.map((ts) => {
      var _a2, _b2;
      const samples = {};
      for (const r of parsed) {
        if (!r.kept || r.mttr === null) continue;
        if (minMttrDays !== null && r.mttr <= minMttrDays) continue;
        if (r.resolvedAt === null || r.resolvedAt > ts.ms) continue;
        ((_b2 = samples[_a2 = r.group]) != null ? _b2 : samples[_a2] = []).push(r.mttr);
      }
      const byGroup = {};
      for (const name of names) {
        const s = samples[name];
        if (s && s.length) {
          const med = median(s);
          byGroup[name] = Math.round(med * 1e3) / 1e3;
        } else {
          byGroup[name] = null;
        }
      }
      return { date: ts.iso, byGroup };
    });
  }
  function kmMedianByGroupTrend(scans, base, keyOf, groups, opts = {}) {
    var _a, _b, _c, _d;
    const severities = (_a = opts.severities) != null ? _a : null;
    const includeOther = (_b = opts.includeOther) != null ? _b : true;
    const otherLabel = (_c = opts.otherLabel) != null ? _c : "Other";
    const hideNoFix = (_d = opts.hideNoFix) != null ? _d : false;
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (!scans.length || !rows.length) return [];
    const flatTs = scans.filter((s) => s["shape"] === "flat").map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
    if (!flatTs.length) return [];
    const inGroup = new Set(groups);
    const parsed = rows.map((r) => {
      const raw = keyOf(r);
      const value = raw.trim() === "" ? "(none)" : raw;
      const known = inGroup.has(value);
      return {
        first: parseTs(r["first_seen"]),
        resolvedAt: parseTs(r["resolved_at"]),
        mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"]) ? r["mttr_days"] : null,
        fixAvail: parseTs(r["fix_available_at"]),
        group: known ? value : otherLabel,
        folded: !known && includeOther,
        kept: known || includeOther
      };
    });
    const hasOther = parsed.some((r) => r.folded);
    const names = hasOther ? [...groups, otherLabel] : groups;
    return flatTs.map((ts) => {
      var _a2, _b2, _c2, _d2, _e, _f, _g, _h;
      const events = {};
      const times = {};
      for (const r of parsed) {
        if (!r.kept) continue;
        if (r.resolvedAt !== null && r.resolvedAt <= ts.ms) {
          if (r.mttr !== null) {
            ((_b2 = events[_a2 = r.group]) != null ? _b2 : events[_a2] = []).push(r.mttr);
            ((_d2 = times[_c2 = r.group]) != null ? _d2 : times[_c2] = []).push(r.mttr);
          }
        } else if (r.first !== null && r.first <= ts.ms) {
          if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)) continue;
          ((_f = times[_e = r.group]) != null ? _f : times[_e] = []).push((ts.ms - r.first) / DAY_MS5);
        }
      }
      const byGroup = {};
      for (const name of names) {
        const med = kmMedianFromCurve(kmCurve((_g = events[name]) != null ? _g : [], (_h = times[name]) != null ? _h : []));
        byGroup[name] = med !== null ? Math.round(med * 1e3) / 1e3 : null;
      }
      return { date: ts.iso, byGroup };
    });
  }
  function trendFromBase(scans, base, severities = null, opts = {}) {
    var _a;
    const hideNoFix = (_a = opts.hideNoFix) != null ? _a : false;
    const tag = (points, synthetic2) => points.map((p) => ({ ...p, reconstructed: synthetic2.has(p.date) }));
    if (!opts.backfill) return tag(trendFromFrames(scans, base, severities, { hideNoFix }), /* @__PURE__ */ new Set());
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    const realFlatMs = scans.filter((s) => s["shape"] === "flat").map((s) => parseTs(s["ts"])).filter((t) => t !== null);
    const firstSeenMs = rows.map((r) => parseTs(r["first_seen"])).filter((t) => t !== null);
    const synthetic = [];
    const syntheticIso = /* @__PURE__ */ new Set();
    if (realFlatMs.length && firstSeenMs.length) {
      const firstScanDay = Math.floor(minNum(realFlatMs) / DAY_MS5) * DAY_MS5;
      const startDay = Math.floor(minNum(firstSeenMs) / DAY_MS5) * DAY_MS5;
      for (let day = startDay; day < firstScanDay; day += DAY_MS5) {
        const iso = toIso(day);
        if (iso === null) continue;
        synthetic.push({ ts: iso, shape: "flat" });
        syntheticIso.add(iso);
      }
    }
    return tag(trendFromFrames(synthetic.concat(scans), base, severities, { hideNoFix }), syntheticIso);
  }
  function kmSkipMask(points, max) {
    if (max === void 0 || max < 0) return null;
    const reconIdx = [];
    points.forEach((p, i) => {
      if (p.reconstructed) reconIdx.push(i);
    });
    if (reconIdx.length <= max) return null;
    const skip = new Array(points.length).fill(false);
    for (const i of reconIdx) skip[i] = false;
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
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    const parsed = rows.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"]) ? r["mttr_days"] : null,
      fixAvail: parseTs(r["fix_available_at"])
    }));
    const skip = kmSkipMask(points, opts.maxReconstructed);
    return points.map((p, i) => {
      if (skip !== null && skip[i]) return { ...p, km_median_days: null };
      const d = parseTs(p.date);
      let med = null;
      if (d !== null) {
        const events = [];
        const times = [];
        for (const r of parsed) {
          if (r.resolvedAt !== null && r.resolvedAt <= d) {
            if (r.mttr !== null) {
              events.push(r.mttr);
              times.push(r.mttr);
            }
          } else if (r.first !== null && r.first <= d) {
            if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, d)) continue;
            times.push((d - r.first) / DAY_MS5);
          }
        }
        med = kmMedianFromCurve(kmCurve(events, times));
      }
      return { ...p, km_median_days: med !== null ? Math.round(med * 1e3) / 1e3 : null };
    });
  }
  function kmMedianAsOf(base, severities, d, opts = {}) {
    var _a;
    if (d === null || !base.length) return null;
    const hideNoFix = (_a = opts.hideNoFix) != null ? _a : false;
    let rows = base;
    if (severities !== null) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    const events = [];
    const times = [];
    for (const r of rows) {
      const resolvedAt = parseTs(r["resolved_at"]);
      if (resolvedAt !== null && resolvedAt <= d) {
        const mttr = typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"]) ? r["mttr_days"] : null;
        if (mttr !== null) {
          events.push(mttr);
          times.push(mttr);
        }
        continue;
      }
      const first = parseTs(r["first_seen"]);
      if (first !== null && first <= d) {
        if (hideNoFix && awaitingFixAsOf(first, resolvedAt, parseTs(r["fix_available_at"]), d)) continue;
        times.push((d - first) / DAY_MS5);
      }
    }
    const med = kmMedianFromCurve(kmCurve(events, times));
    return med !== null ? Math.round(med * 1e3) / 1e3 : null;
  }
  function withOpenPastSla(points, base, severities = null, fromField = "first_seen") {
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
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
          if (target !== void 0 && (d - r.origin) / DAY_MS5 > target) breached += 1;
        }
      }
      return { ...p, open_past_sla: breached };
    });
  }
  function slaDeadlineRows(base, severities) {
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    const out = [];
    for (const r of rows) {
      const actionable = parseTs(r["actionable_from"]);
      const target = SLA_TARGETS[normalizeSeverity(r["severity"])];
      if (actionable === null || target === void 0) continue;
      out.push({ deadline: actionable + target * DAY_MS5, resolvedAt: parseTs(r["resolved_at"]) });
    }
    return out;
  }
  function withSlaBurn(points, base, severities = null) {
    const parsed = slaDeadlineRows(base, severities);
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
  function cohortSlaAttainment(points, base, severities = null) {
    const parsed = slaDeadlineRows(base, severities);
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
      const pct2 = cohort ? Math.round(met / cohort * 100 * 10) / 10 : null;
      return { ...p, sla_attainment_pct: pct2 };
    });
  }
  function withCoverageEfficiency(points, base, rule, severities = null) {
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = rows.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    const parsed = rows.map(
      (r) => ({
        first: parseTs(r["first_seen"]),
        resolvedAt: parseTs(r["resolved_at"]),
        cls: classifyRisk(r, rule)
      })
    );
    const round1 = (v) => v === null ? null : Math.round(v * 10) / 10;
    return points.map((p) => {
      const d = parseTs(p.date);
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let unknown = 0;
      let counted = 0;
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
      }
      return {
        ...p,
        coverage_pct: round1(tp + fn > 0 ? tp / (tp + fn) * 100 : null),
        efficiency_pct: round1(tp + fp > 0 ? tp / (tp + fp) * 100 : null),
        high_risk_open: fn,
        high_risk_remediated: tp,
        unknown_pct: round1(counted > 0 ? unknown / counted * 100 : null)
      };
    });
  }

  // src/domain/maintenance.ts
  var LedgerRebuildError = class extends Error {
  };
  var SealedScanError = class extends LedgerRebuildError {
  };
  function recordsFromPayload(payload) {
    var _a;
    return (_a = extractNodes(payload)) != null ? _a : [];
  }
  function loadReplayPayloads(rows, readPayload, missingMsg) {
    const replay = [];
    for (const r of rows) {
      if (r.sealed) continue;
      const payload = readPayload(r);
      if (payload === null && r.shape === "flat") {
        throw new LedgerRebuildError(missingMsg(r.scan_id));
      }
      replay.push({ row: r, payload });
    }
    return replay;
  }
  function replayScans(rebuilt, replay) {
    const observationsByScan = {};
    for (const { row, payload } of replay) {
      if (row.shape === "grouped") {
        if (payload === null) {
          reinsertScanRow(rebuilt, row);
        } else {
          persistGroupedScan(rebuilt, extractNodes(payload), {
            mode: row.mode,
            scanId: row.scan_id,
            scannedSeverities: parseSeverities(row.severities),
            rawRef: row.raw_ref
          });
        }
      } else {
        const { observations } = persistFlatScan(rebuilt, recordsFromPayload(payload), {
          mode: row.mode,
          scanId: row.scan_id,
          scannedSeverities: parseSeverities(row.severities),
          rawRef: row.raw_ref,
          obsRef: row.obs_ref
        });
        observationsByScan[row.scan_id] = observations;
      }
    }
    return observationsByScan;
  }
  function settledEpisodeRows(checkpointLedger, ledger, sealedIds) {
    var _a;
    const episodes = [];
    for (const cpRow of checkpointLedger) {
      if (cpRow.status !== "RESOLVED") continue;
      const live = ledger[cpRow.vuln_key];
      if (live === void 0 || live.status !== "RESOLVED" || live.resolved_at !== cpRow.resolved_at || !sealedIds.has((_a = live.last_scan_id) != null ? _a : "")) {
        continue;
      }
      episodes.push(live);
    }
    return episodes;
  }
  function toEpisodeRow(live, compactionId) {
    var _a, _b, _c, _d, _e, _f;
    return {
      vuln_key: live.vuln_key,
      cve: live.cve,
      severity: live.severity,
      first_seen: live.first_seen,
      resolved_at: live.resolved_at,
      resolution_src: live.resolution_src,
      reopened_count: Number((_a = live.reopened_count) != null ? _a : 0),
      compaction_id: compactionId,
      superseded_by_scan: null,
      fix_date: live.fix_date,
      fix_observed_at: live.fix_observed_at,
      // Exploit intelligence survives compaction — a sealed episode is still a remediated
      // lifecycle that coverage/efficiency must be able to classify.
      has_kev: (_b = live.has_kev) != null ? _b : null,
      has_exploit: (_c = live.has_exploit) != null ? _c : null,
      epss: (_d = live.epss) != null ? _d : null,
      risk_observed_at: (_e = live.risk_observed_at) != null ? _e : null,
      // And the tag bag, for the same reason one tier over: a sealed episode is still a
      // remediated lifecycle that the by-domain split has to be able to attribute.
      tags_json: (_f = live.tags_json) != null ? _f : null
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
    const present3 = new Set(rows.filter((r) => targets.has(r.scan_id)).map((r) => r.scan_id));
    if (!present3.size) {
      return { state, result: zero, observationsByScan: {} };
    }
    const sealedTargets = rows.filter((r) => present3.has(r.scan_id) && r.sealed).map((r) => r.scan_id).sort();
    if (sealedTargets.length) {
      throw new SealedScanError(
        `Cannot delete sealed scan(s) ${sealedTargets.join(", ")}: they are part of the compacted baseline (their raw archives were pruned), so their effects can no longer be un-replayed.`
      );
    }
    const survivors = rows.filter((r) => !present3.has(r.scan_id));
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
      const episodeKeys = new Set(state.episodes.map((e) => e.vuln_key));
      for (const row of (_a = checkpoint.ledger) != null ? _a : []) {
        if (!episodeKeys.has(row.vuln_key)) rebuilt.ledger[row.vuln_key] = { ...row };
      }
    }
    const observationsByScan = replayScans(rebuilt, replay);
    return {
      state: rebuilt,
      result: {
        deleted: present3.size,
        scans: rebuilt.scans.length,
        tracked: baseRows(rebuilt, now).length
      },
      observationsByScan
    };
  }
  function buildCheckpoint(rows, newly, prevCheckpoint, floorRow, readPayload) {
    var _a;
    const tmp = emptyState();
    if (prevCheckpoint !== null) {
      for (const row of (_a = prevCheckpoint.ledger) != null ? _a : []) tmp.ledger[row.vuln_key] = { ...row };
    }
    for (const r of rows) {
      if (r.sealed) tmp.scans.push({ ...r });
    }
    for (const r of newly) {
      const payload = readPayload(r);
      const scope = parseSeverities(r.severities);
      if (r.shape === "flat") {
        if (payload === null) {
          throw new LedgerRebuildError(
            `Cannot compact: the archived payload for scan ${r.scan_id} is missing or unreadable.`
          );
        }
        persistFlatScan(tmp, recordsFromPayload(payload), {
          mode: r.mode,
          scanId: r.scan_id,
          scannedSeverities: scope
        });
      } else if (payload === null) {
        reinsertScanRow(tmp, r);
      } else {
        persistGroupedScan(tmp, extractNodes(payload), {
          mode: r.mode,
          scanId: r.scan_id,
          scannedSeverities: scope
        });
      }
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
        vuln_key: row.vuln_key,
        severity: row.severity,
        first_seen: row.first_seen,
        status: row.status,
        resolved_at: row.resolved_at
      });
    }
    for (const e of state.episodes) {
      if (e.superseded_by_scan !== null || e.vuln_key in state.ledger) continue;
      out.push({
        vuln_key: e.vuln_key,
        severity: e.severity,
        first_seen: e.first_seen,
        status: "RESOLVED",
        resolved_at: e.resolved_at
      });
    }
    return out;
  }
  function coverageOf(state, now) {
    return confusionMatrix(
      baseRows(state, now).map((r) => ({
        severity: r.severity,
        status: r.status,
        has_kev: r.has_kev,
        has_exploit: r.has_exploit,
        epss: r.epss
      })),
      DEFAULT_RISK_RULE
    );
  }
  function trendOf(state, now) {
    return trendFromFrames(
      state.scans.map((s) => ({ ts: s.ts, shape: s.shape })),
      baseRows(state, now).map((r) => ({
        severity: r.severity,
        first_seen: r.first_seen,
        resolved_at: r.resolved_at,
        mttr_days: r.mttr_days
      }))
    );
  }
  function attributionOf(state, now) {
    let bagged = 0;
    let domained = 0;
    for (const r of baseRows(state, now)) {
      if (r.tags_json) bagged += 1;
      if (domainOfTags(recordTags(r), DEFAULT_DOMAIN_TAG_KEY)) domained += 1;
    }
    return { bagged, domained };
  }
  function compactLedgerCore(state, retentionDays, prevCheckpoint, readPayload, options) {
    var _a, _b;
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
    const flatCandidates = candidates.filter((r) => r.shape === "flat");
    const floorRow = flatCandidates.length ? flatCandidates[flatCandidates.length - 1] : null;
    const checkpoint = buildCheckpoint(rows, newly, prevCheckpoint, floorRow, readPayload);
    const sealedIds = new Set(candidates.map((r) => r.scan_id));
    const episodes = settledEpisodeRows(checkpoint.ledger, state.ledger, sealedIds);
    const newlyIds = newly.map((r) => r.scan_id);
    const obsCount = newlyIds.reduce(
      (acc, id) => {
        var _a2, _b2;
        return acc + ((_b2 = (_a2 = options.obsCountByScan) == null ? void 0 : _a2[id]) != null ? _b2 : 0);
      },
      0
    );
    result.no_op = false;
    result.scans_sealed = newly.length;
    result.episodes_created = episodes.length;
    result.observations_pruned = obsCount;
    result.archive_bytes_freed = (_b = options.archiveBytes) != null ? _b : 0;
    result.floor_scan_id = checkpoint.floor_scan_id;
    result.floor_ts = checkpoint.floor_ts;
    if (dryRun) return { result, checkpoint, newly, state: null, compactionId: null };
    const beforeMttr = mttrFromLedger(openAndResolved(state), { now: nowMs });
    const beforeTrend = trendOf(state, nowMs);
    const beforeCoverage = coverageOf(state, nowMs);
    const beforeAttribution = attributionOf(state, nowMs);
    const applied = {
      scans: state.scans.map(
        (r) => newlyIds.includes(r.scan_id) ? { ...r, sealed: 1, raw_ref: null, obs_ref: null } : { ...r }
      ),
      ledger: {},
      episodes: [
        ...state.episodes.map((e) => ({ ...e })),
        ...episodes.map((e) => toEpisodeRow(e, options.compactionId))
      ]
    };
    const converted = new Set(episodes.map((e) => e.vuln_key));
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
    if (!statsEqual(beforeAttribution, attributionOf(applied, nowMs))) {
      throw new LedgerRebuildError(
        "Compaction aborted: domain attribution would change \u2014 rolled back."
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
      observations_pruned: plan.result.observations_pruned,
      archive_bytes_freed: plan.result.archive_bytes_freed,
      db_bytes_freed: plan.result.db_bytes_freed,
      checkpoint_ref: checkpointRef
    };
  }
  function emptyBackfillResult() {
    return {
      scansReplayed: 0,
      scansSealed: 0,
      scansUnreadable: 0,
      ledgerRowsTouched: 0,
      episodeRowsTouched: 0,
      stillUnknown: 0,
      tagsRecovered: 0,
      stillUnattributable: 0
    };
  }
  function backfillTagsFromCheckpoint(state, checkpoint) {
    var _a, _b, _c;
    const out = { recovered: 0, alreadyHad: 0, unrecoverable: 0 };
    const byKey = /* @__PURE__ */ new Map();
    for (const row of (_a = checkpoint == null ? void 0 : checkpoint.ledger) != null ? _a : []) byKey.set(row.vuln_key, row);
    for (const e of state.episodes) {
      if (e.tags_json) {
        out.alreadyHad += 1;
        continue;
      }
      const tags = (_c = (_b = byKey.get(e.vuln_key)) == null ? void 0 : _b.tags_json) != null ? _c : null;
      if (tags) {
        e.tags_json = tags;
        out.recovered += 1;
      } else out.unrecoverable += 1;
    }
    return out;
  }
  function backfillRiskFromRecords(state, records, scanTsIso, result) {
    const episodesByKey = /* @__PURE__ */ new Map();
    for (const e of state.episodes) episodesByKey.set(e.vuln_key, e);
    for (const rec of records) {
      const key = vulnKey(rec);
      const row = state.ledger[key];
      if (row) {
        const before = row.risk_observed_at;
        mergeRiskSignals(row, rec, scanTsIso);
        if (before !== row.risk_observed_at) result.ledgerRowsTouched += 1;
        continue;
      }
      const ep = episodesByKey.get(key);
      if (ep) {
        const before = ep.risk_observed_at;
        mergeRiskSignals(ep, rec, scanTsIso);
        if (before !== ep.risk_observed_at) result.episodeRowsTouched += 1;
      }
    }
  }
  function backfillTagsFromRecords(state, records, result) {
    var _a;
    const episodesByKey = /* @__PURE__ */ new Map();
    for (const e of state.episodes) episodesByKey.set(e.vuln_key, e);
    for (const rec of records) {
      const key = vulnKey(rec);
      const target = (_a = state.ledger[key]) != null ? _a : episodesByKey.get(key);
      if (!target || target.tags_json) continue;
      const bag = tagsJson(rec);
      if (bag) {
        target.tags_json = bag;
        result.tagsRecovered += 1;
      }
    }
  }
  function countUnattributable(state) {
    let n = 0;
    for (const row of Object.values(state.ledger)) {
      if (!hasDomainInputs(row)) n += 1;
    }
    for (const e of state.episodes) {
      if (e.superseded_by_scan !== null) continue;
      if (e.vuln_key in state.ledger) continue;
      if (!hasDomainInputs(e)) n += 1;
    }
    return n;
  }
  function countUnknownRisk(state) {
    let n = 0;
    for (const row of Object.values(state.ledger)) if (row.risk_observed_at == null) n += 1;
    for (const e of state.episodes) {
      if (e.superseded_by_scan !== null) continue;
      if (e.vuln_key in state.ledger) continue;
      if (e.risk_observed_at == null) n += 1;
    }
    return n;
  }

  // src/domain/importMerge.ts
  var MIGRATION_KIND = "wiz-sidekick-migration";
  var MIGRATION_VERSION = 1;
  var MAX_SCANS = 500;
  var MAX_LEDGER_ROWS = 2e5;
  var MAX_EPISODES = 2e5;
  var MAX_HISTORY_ROWS = 5e3;
  var ImportValidationError = class extends Error {
  };
  function asArray(value, name) {
    if (value === void 0 || value === null) return [];
    if (!Array.isArray(value)) {
      throw new ImportValidationError(`Bundle field "${name}" must be a list.`);
    }
    for (const item of value) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new ImportValidationError(`Bundle field "${name}" must contain objects.`);
      }
    }
    return value;
  }
  function validateBundle(data) {
    var _a;
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new ImportValidationError("The uploaded file is not a migration bundle.");
    }
    const rec = data;
    if (rec["kind"] !== MIGRATION_KIND) {
      throw new ImportValidationError(
        `Not a migration bundle (kind ${JSON.stringify((_a = rec["kind"]) != null ? _a : null)}).`
      );
    }
    const version = Number(rec["version"]);
    if (version !== MIGRATION_VERSION) {
      throw new ImportValidationError(
        `Unsupported bundle version ${rec["version"]} \u2014 this app understands version ${MIGRATION_VERSION}. The bundle may come from a newer exporter.`
      );
    }
    const scans = asArray(rec["scans"], "scans");
    const ledger = asArray(rec["ledger"], "ledger");
    const episodes = asArray(rec["episodes"], "episodes");
    const mttrHistory = asArray(rec["mttr_history"], "mttr_history");
    if (scans.length > MAX_SCANS) {
      throw new ImportValidationError(
        `Bundle has ${scans.length} scans \u2014 over the ${MAX_SCANS}-scan import limit.`
      );
    }
    if (ledger.length > MAX_LEDGER_ROWS) {
      throw new ImportValidationError(
        `Bundle has ${ledger.length} ledger rows \u2014 over the ${MAX_LEDGER_ROWS}-row limit.`
      );
    }
    if (episodes.length > MAX_EPISODES) {
      throw new ImportValidationError(
        `Bundle has ${episodes.length} episodes \u2014 over the ${MAX_EPISODES}-row limit.`
      );
    }
    if (mttrHistory.length > MAX_HISTORY_ROWS) {
      throw new ImportValidationError(
        `Bundle has ${mttrHistory.length} history rows \u2014 over the ${MAX_HISTORY_ROWS}-row limit.`
      );
    }
    for (const s of scans) {
      if (typeof s["scan_id"] !== "string" || !s["scan_id"] || typeof s["ts"] !== "string" || !s["ts"]) {
        throw new ImportValidationError("Every bundle scan needs string scan_id and ts.");
      }
    }
    for (const [name, rows] of [["ledger", ledger], ["episodes", episodes]]) {
      for (const r of rows) {
        if (typeof r["vuln_key"] !== "string" || !r["vuln_key"]) {
          throw new ImportValidationError(`Every bundle ${name} row needs a string vuln_key.`);
        }
      }
    }
    return {
      kind: MIGRATION_KIND,
      version,
      exported_at: typeof rec["exported_at"] === "string" ? rec["exported_at"] : null,
      scans,
      ledger,
      episodes,
      mttr_history: mttrHistory
    };
  }
  var str = (v) => v === null || v === void 0 || v === "" ? null : String(v);
  function coerceScan(r) {
    var _a, _b, _c, _d, _e;
    return {
      scan_id: String(r["scan_id"]),
      ts: String(r["ts"]),
      mode: String((_a = r["mode"]) != null ? _a : "import"),
      shape: r["shape"] === "grouped" ? "grouped" : "flat",
      total: Number((_b = r["total"]) != null ? _b : 0),
      new_count: Number((_c = r["new_count"]) != null ? _c : 0),
      resolved_count: Number((_d = r["resolved_count"]) != null ? _d : 0),
      reopened_count: Number((_e = r["reopened_count"]) != null ? _e : 0),
      raw_ref: null,
      obs_ref: null,
      severities: str(r["severities"]),
      sealed: 1
    };
  }
  function coerceLedger(r) {
    var _a, _b;
    return {
      vuln_key: String(r["vuln_key"]),
      cve: str(r["cve"]),
      // Normalize at ingest (blank/null/unrecognized → explicit "UNKNOWN"), not str() — the
      // legacy migrate export stored raw values that could reach the ledger as literal null
      // and never self-heal for out-of-fetch-scope severities. UNKNOWN is auditable.
      severity: normalizeSeverity(r["severity"]),
      asset_id: str(r["asset_id"]),
      asset_name: str(r["asset_name"]),
      asset_type: str(r["asset_type"]),
      cloud: str(r["cloud"]),
      first_seen: str(r["first_seen"]),
      last_seen: str(r["last_seen"]),
      status: String((_a = r["status"]) != null ? _a : "OPEN"),
      resolved_at: str(r["resolved_at"]),
      resolution_src: str(r["resolution_src"]),
      reopened_count: Number((_b = r["reopened_count"]) != null ? _b : 0),
      first_scan_id: str(r["first_scan_id"]),
      last_scan_id: str(r["last_scan_id"]),
      subscription_name: str(r["subscription_name"]),
      subscription_ext_id: str(r["subscription_ext_id"]),
      tags_json: str(r["tags_json"]),
      fix_date: str(r["fix_date"]),
      fix_observed_at: str(r["fix_observed_at"]),
      // Not str(): these are tri-state (boolean | null) and numeric. A bundle exported before
      // the risk columns existed simply lacks the keys, and they must stay null — "not
      // captured", never a fabricated false/0. See reconcile.coerceRiskSignals.
      ...coerceRiskSignals(r)
    };
  }
  function coerceEpisode(r) {
    var _a, _b;
    return {
      vuln_key: String(r["vuln_key"]),
      cve: str(r["cve"]),
      severity: normalizeSeverity(r["severity"]),
      first_seen: str(r["first_seen"]),
      resolved_at: str(r["resolved_at"]),
      resolution_src: str(r["resolution_src"]),
      reopened_count: Number((_a = r["reopened_count"]) != null ? _a : 0),
      compaction_id: String((_b = r["compaction_id"]) != null ? _b : "import"),
      superseded_by_scan: str(r["superseded_by_scan"]),
      fix_date: str(r["fix_date"]),
      fix_observed_at: str(r["fix_observed_at"]),
      // Null on every legacy bundle — the Python exporter never had the column, and its
      // `resolved_episodes` table never had one to export. Correct at import, and no longer
      // permanent: these episodes arrive as Not attributable, then recover their bag from the
      // scan archives (the history backfill) or from the next scan that re-lists them. The one
      // route that cannot reach them is backfillTagsFromCheckpoint — they were never in a GAS
      // checkpoint to begin with.
      tags_json: str(r["tags_json"]),
      ...coerceRiskSignals(r)
    };
  }
  function importBundleCore(state, bundle, readPayload, options) {
    const existingRows = scansAsc(state.scans);
    const sealedExisting = existingRows.filter((r) => r.sealed).map((r) => r.scan_id);
    if (sealedExisting.length) {
      throw new ImportValidationError(
        `This ledger already has compacted (sealed) history (${sealedExisting.join(", ")}) \u2014 two compacted histories can't be merged. Import into a ledger that has never been compacted.`
      );
    }
    const existingIds = new Set(existingRows.map((r) => r.scan_id));
    const seen2 = /* @__PURE__ */ new Set();
    const imported = [];
    let skipped = 0;
    for (const raw of bundle.scans) {
      const row = coerceScan(raw);
      if (seen2.has(row.scan_id) || existingIds.has(row.scan_id)) {
        skipped += 1;
        continue;
      }
      seen2.add(row.scan_id);
      imported.push(row);
    }
    const importedAsc = scansAsc(imported);
    const badTs = importedAsc.filter((r) => parseTs(r.ts) === null).map((r) => r.scan_id);
    if (badTs.length) {
      throw new ImportValidationError(
        `Bundle scan(s) ${badTs.join(", ")} have unparseable timestamps.`
      );
    }
    if (importedAsc.length && existingRows.length) {
      const newestImported = importedAsc[importedAsc.length - 1];
      const oldestExisting = existingRows[0];
      const newestMs = parseTs(newestImported.ts);
      const oldestMs = parseTs(oldestExisting.ts);
      if (oldestMs === null || newestMs === null || newestMs >= oldestMs) {
        throw new ImportValidationError(
          `Imported history must be strictly older than this ledger's: bundle scan ${newestImported.scan_id} is not older than existing scan ${oldestExisting.scan_id}. Delete the overlapping scans on one side first.`
        );
      }
    }
    const importedIds = new Set(importedAsc.map((r) => r.scan_id));
    const importedCount = importedAsc.length;
    const rebuilt = {
      scans: importedAsc,
      ledger: {},
      episodes: bundle.episodes.map(coerceEpisode)
    };
    for (const raw of bundle.ledger) {
      const row = coerceLedger(raw);
      rebuilt.ledger[row.vuln_key] = row;
    }
    const vulnsImported = Object.keys(rebuilt.ledger).length;
    const unclassifiedSeverity = bundle.ledger.filter((r) => normalizeSeverity(r["severity"]) === "UNKNOWN").length + bundle.episodes.filter((r) => normalizeSeverity(r["severity"]) === "UNKNOWN").length;
    const flats = importedAsc.filter((r) => r.shape === "flat");
    const floorRow = flats.length ? flats[flats.length - 1] : null;
    const checkpoint = {
      version: CHECKPOINT_VERSION,
      floor_scan_id: floorRow ? floorRow.scan_id : null,
      floor_ts: floorRow ? floorRow.ts : null,
      ledger: Object.values(rebuilt.ledger).map((r) => ({ ...r }))
    };
    const replay = loadReplayPayloads(
      existingRows,
      readPayload,
      (scanId) => `Cannot import: the archived payload for existing scan ${scanId} is missing, so it can't be replayed over the imported history.`
    );
    const observationsByScan = replayScans(rebuilt, replay);
    const converted = settledEpisodeRows(checkpoint.ledger, rebuilt.ledger, importedIds);
    for (const live of converted) {
      rebuilt.episodes.push(toEpisodeRow(live, options.compactionId));
      delete rebuilt.ledger[live.vuln_key];
    }
    return {
      state: rebuilt,
      checkpoint,
      observationsByScan,
      counts: {
        scans_imported: importedCount,
        scans_skipped: skipped,
        vulns_imported: vulnsImported,
        episodes_imported: bundle.episodes.length,
        episodes_converted: converted.length,
        scans_replayed: replay.length,
        unclassified_severity: unclassifiedSeverity
      }
    };
  }
  function mergeMttrHistory(existing, imported) {
    var _a, _b, _c, _d, _e;
    const byDate = /* @__PURE__ */ new Map();
    for (const r of existing) {
      const date = r["date"];
      if (typeof date === "string" && !Number.isNaN(Date.parse(date))) {
        byDate.set(date.slice(0, 10), r);
      }
    }
    let added = 0;
    let skipped = 0;
    for (const r of imported) {
      const date = r["date"];
      if (typeof date !== "string" || Number.isNaN(Date.parse(date))) {
        skipped += 1;
        continue;
      }
      const key = date.slice(0, 10);
      if (byDate.has(key)) {
        skipped += 1;
        continue;
      }
      byDate.set(key, {
        date: key,
        median_days: Number((_a = r["median_days"]) != null ? _a : 0),
        resolved: Number((_b = r["resolved"]) != null ? _b : 0),
        open: Number((_c = r["open"]) != null ? _c : 0),
        total: Number((_d = r["total"]) != null ? _d : 0),
        sla_pct: r["sla_pct"] === null || r["sla_pct"] === void 0 ? null : Number(r["sla_pct"]),
        oldest_open_days: r["oldest_open_days"] === null || r["oldest_open_days"] === void 0 ? null : Number(r["oldest_open_days"]),
        open_past_sla: (_e = r["open_past_sla"]) != null ? _e : null
      });
      added += 1;
    }
    const rows = [...byDate.values()].sort(
      (a, b) => String(a["date"]) < String(b["date"]) ? -1 : String(a["date"]) > String(b["date"]) ? 1 : 0
    );
    return { rows, added, skipped };
  }

  // src/domain/exportBundle.ts
  var BUNDLE_SCAN_COLUMNS = [
    "scan_id",
    "ts",
    "mode",
    "shape",
    "total",
    "new_count",
    "resolved_count",
    "reopened_count",
    "severities",
    "sealed"
  ];
  var BUNDLE_EPISODE_COLUMNS = [
    "vuln_key",
    "cve",
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
    "risk_observed_at",
    "tags_json"
  ];
  var BUNDLE_HISTORY_COLUMNS = [
    "date",
    "median_days",
    "resolved",
    "open",
    "total",
    "sla_pct",
    "oldest_open_days",
    "open_past_sla"
  ];
  function project(row, columns) {
    var _a;
    const out = {};
    for (const c of columns) out[String(c)] = (_a = row[c]) != null ? _a : null;
    return out;
  }
  function bundleCounts(bundle) {
    return {
      scans: bundle.scans.length,
      ledger: bundle.ledger.length,
      episodes: bundle.episodes.length,
      mttr_history: bundle.mttr_history.length
    };
  }
  function buildMigrationBundle(state, history, opts) {
    var _a;
    const ledgerRows = Object.keys(state.ledger).sort().map((k) => state.ledger[k]);
    const episodes = [...state.episodes].sort(
      (a, b) => a.vuln_key < b.vuln_key ? -1 : a.vuln_key > b.vuln_key ? 1 : 0
    );
    return {
      kind: MIGRATION_KIND,
      version: MIGRATION_VERSION,
      exported_at: opts.exportedAt,
      schema_version: (_a = opts.schemaVersion) != null ? _a : null,
      scans: scansAsc(state.scans).map((s) => project(s, BUNDLE_SCAN_COLUMNS)),
      ledger: ledgerRows.map((r) => project(r, LEDGER_COLUMNS)),
      episodes: episodes.map((e) => project(e, BUNDLE_EPISODE_COLUMNS)),
      mttr_history: history.map((h) => {
        var _a2;
        const src = h;
        const out = {};
        for (const c of BUNDLE_HISTORY_COLUMNS) out[c] = (_a2 = src[c]) != null ? _a2 : null;
        return out;
      })
    };
  }

  // src/domain/insights.ts
  var AGE_BUCKET_EDGES = [7, 30, 90];
  var WIDE_KEY = "vulnerableAsset.hasWideInternetExposure";
  var LIMITED_KEY = "vulnerableAsset.hasLimitedInternetExposure";
  function isOpen3(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function sev(r) {
    const s = r["_sev"];
    return typeof s === "string" && s ? s : normalizeSeverity(r["severity"]);
  }
  function epssOf(r) {
    const v = r["epssProbability"];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  function severityStats(records) {
    var _a;
    const out = {};
    for (const r of records) {
      const s = sev(r);
      const stat = (_a = out[s]) != null ? _a : out[s] = { total: 0, open: 0, resolved: 0 };
      stat.total += 1;
      if (isOpen3(r["status"])) stat.open += 1;
      else stat.resolved += 1;
    }
    return out;
  }
  function exploitSummary(records) {
    const out = {
      open: 0,
      kev: 0,
      exploit: 0,
      highEpss: 0,
      internetExposed: 0,
      exposureKnown: records.some((r) => WIDE_KEY in r && r[WIDE_KEY] !== void 0)
    };
    for (const r of records) {
      if (!isOpen3(r["status"])) continue;
      out.open += 1;
      if (r["hasCisaKevExploit"] === true) out.kev += 1;
      if (r["hasExploit"] === true) out.exploit += 1;
      const epss = epssOf(r);
      if (epss !== null && epss >= EPSS_PRIORITY_THRESHOLD) out.highEpss += 1;
      if (r[WIDE_KEY] === true || r[LIMITED_KEY] === true) out.internetExposed += 1;
    }
    return out;
  }
  function ageBuckets(rows) {
    const { perKey, totalOpen } = ageBucketsBy(rows, (r) => normalizeSeverity(r.severity));
    return { perSev: perKey, totalOpen };
  }
  function ageBucketsBy(rows, keyOf) {
    const perKey = {};
    let totalOpen = 0;
    for (const row of rows) {
      if (!isOpen3(row.status)) continue;
      const age = row.age_days;
      if (typeof age !== "number" || !Number.isFinite(age)) continue;
      const bucket = age <= AGE_BUCKET_EDGES[0] ? 0 : age <= AGE_BUCKET_EDGES[1] ? 1 : age <= AGE_BUCKET_EDGES[2] ? 2 : 3;
      const k = keyOf(row);
      if (!perKey[k]) perKey[k] = [0, 0, 0, 0];
      perKey[k][bucket] += 1;
      totalOpen += 1;
    }
    return { perKey, totalOpen };
  }
  var AGED_OPEN_EDGE = AGE_BUCKET_EDGES[2];
  function openAge2(row) {
    if (!isOpen3(row.status)) return null;
    const age = row.age_days;
    return typeof age === "number" && Number.isFinite(age) ? age : null;
  }
  function rankGroups(rows, keyFn, topN, meta) {
    const groups = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const age = openAge2(row);
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
  function oldestOpen(rows, topN = 7) {
    const findings = rows.map((r) => ({ r, age: openAge2(r) })).filter((x) => x.age !== null).sort((a, b) => b.age - a.age).slice(0, topN).map(({ r, age }) => ({
      cve: r.cve,
      asset: r.asset_name,
      subscription: r.subscription_name,
      severity: normalizeSeverity(r.severity),
      ageDays: age
    }));
    return {
      findings,
      byAsset: rankGroups(rows, (r) => {
        var _a;
        return String((_a = r.asset_name) != null ? _a : "");
      }, topN, (r) => {
        var _a, _b;
        return {
          subscription: String((_a = r.subscription_name) != null ? _a : ""),
          domain: String((_b = r._domain) != null ? _b : "")
        };
      }),
      bySupportGroup: rankGroups(rows, (r) => {
        var _a;
        return String((_a = r._supportGroup) != null ? _a : "");
      }, topN),
      byDomain: rankGroups(rows, (r) => {
        var _a;
        return String((_a = r._domain) != null ? _a : "");
      }, topN)
    };
  }
  function movement(baseRows2, latestFlatScan, scanCount) {
    if (!latestFlatScan) {
      return { newCount: 0, resolvedCount: 0, reopenedCount: 0, persisting: 0, hasPrevious: scanCount > 1 };
    }
    let persisting = 0;
    for (const row of baseRows2) {
      if (!isOpen3(row.status)) continue;
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
    domain: "_domain",
    supportGroup: "_supportGroup",
    asset: "vulnerableAsset.name",
    atype: "vulnerableAsset.type",
    cloud: "vulnerableAsset.cloudPlatform",
    os: "vulnerableAsset.operatingSystem",
    subscription: "vulnerableAsset.subscriptionName",
    cve: "name"
  };
  var GROUP_BASE_FIELDS = {
    domain: "_domain",
    supportGroup: "_supportGroup",
    asset: "asset_name",
    atype: "asset_type",
    cloud: "cloud",
    subscription: "subscription_name",
    cve: "cve"
  };
  function groupTree(records, keys, perLevelCap = 20) {
    if (!keys.length || !records.length) return [];
    const [key, ...rest] = keys;
    const column = GROUP_COLUMNS[key];
    if (!column) return [];
    const buckets = /* @__PURE__ */ new Map();
    for (const r of records) {
      const raw = r[column];
      const k = raw === null || raw === void 0 || String(raw).trim() === "" ? "(none)" : String(raw);
      let arr = buckets.get(k);
      if (!arr) buckets.set(k, arr = []);
      arr.push(r);
    }
    const rows = [...buckets.entries()].map(([k, recs]) => {
      var _a, _b;
      const assets = /* @__PURE__ */ new Set();
      const sevCounts = {};
      let open = 0;
      let kev = false;
      let exploit = false;
      for (const r of recs) {
        if (isOpen3(r["status"])) open += 1;
        const s = sev(r);
        sevCounts[s] = ((_a = sevCounts[s]) != null ? _a : 0) + 1;
        const a = String((_b = r["vulnerableAsset.name"]) != null ? _b : "");
        if (a) assets.add(a);
        if (r["hasCisaKevExploit"] === true) kev = true;
        if (r["hasExploit"] === true) exploit = true;
      }
      const node = {
        key: k,
        dim: key,
        total: recs.length,
        open,
        assets: assets.size,
        sevCounts,
        kev,
        exploit,
        children: []
      };
      return { recs, node };
    });
    rows.sort((a, b) => b.node.total - a.node.total || a.node.key.localeCompare(b.node.key));
    const kept = rows.slice(0, perLevelCap);
    if (rest.length) {
      for (const row of kept) row.node.children = groupTree(row.recs, rest, perLevelCap);
    }
    return kept.map((row) => row.node);
  }
  function riskTierStats(rows, rule) {
    var _a;
    const perTier = {};
    for (const t of RISK_TIER_ORDER) perTier[t] = 0;
    let open = 0;
    for (const row of rows) {
      if (!isOpen3(row.status)) continue;
      open += 1;
      perTier[riskTier(row, rule)] += 1;
    }
    return { perTier, open, unclassified: (_a = perTier["unknown"]) != null ? _a : 0 };
  }
  function triageFunnel(rows, rule, exposedKeys, exposureKnown) {
    const out = {
      open: 0,
      intel: 0,
      exploitable: 0,
      exposed: 0,
      overdue: 0,
      unclassified: 0,
      exposureKnown
    };
    for (const row of rows) {
      if (!isOpen3(row.status)) continue;
      out.open += 1;
      const tier = riskTier(row, rule);
      if (tier === "unknown") {
        out.unclassified += 1;
        continue;
      }
      out.intel += 1;
      if (tier !== "kev" && tier !== "exploit") continue;
      out.exploitable += 1;
      if (!exposureKnown || !exposedKeys.has(row.vuln_key)) continue;
      out.exposed += 1;
      const target = SLA_TARGETS[normalizeSeverity(row.severity)];
      const age = row.actionable_age_days;
      if (typeof target === "number" && typeof age === "number" && Number.isFinite(age) && age > target) {
        out.overdue += 1;
      }
    }
    return out;
  }
  function concentration(records, dims, topN = 5) {
    var _a;
    const perDim = {};
    const moreDim = {};
    for (const dim of dims) {
      const column = GROUP_COLUMNS[dim];
      if (!column) continue;
      const buckets = /* @__PURE__ */ new Map();
      for (const r of records) {
        if (!isOpen3(r["status"])) continue;
        const raw = r[column];
        const k = raw === null || raw === void 0 || String(raw).trim() === "" ? "(none)" : String(raw);
        let b = buckets.get(k);
        if (!b) buckets.set(k, b = { open: 0, assets: /* @__PURE__ */ new Set(), kev: 0 });
        b.open += 1;
        const a = String((_a = r["vulnerableAsset.name"]) != null ? _a : "");
        if (a) b.assets.add(a);
        if (r["hasCisaKevExploit"] === true) b.kev += 1;
      }
      const rows = [...buckets.entries()].map(([key, b]) => ({ key, open: b.open, assets: b.assets.size, kev: b.kev })).sort((a, b) => b.open - a.open || a.key.localeCompare(b.key));
      perDim[dim] = rows.slice(0, topN);
      moreDim[dim] = Math.max(0, rows.length - topN);
    }
    return { perDim, moreDim };
  }
  function openAgeMedian(rows) {
    const ages = [];
    for (const row of rows) {
      if (!isOpen3(row.status)) continue;
      const age = row.age_days;
      if (typeof age === "number" && Number.isFinite(age)) ages.push(age);
    }
    if (!ages.length) return null;
    ages.sort((a, b) => a - b);
    const mid = (ages.length - 1) / 2;
    const lo = Math.floor(mid);
    const hi = Math.ceil(mid);
    return lo === hi ? ages[lo] : (ages[lo] + ages[hi]) / 2;
  }

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
    "mode",
    "shape",
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
  var OLDEST_VIEWS = ["findings", "byAsset", "bySupportGroup", "byDomain"];
  function overviewInsightsSlice(insights) {
    if (!insights || typeof insights !== "object") return null;
    const out = {};
    for (const [k, v] of Object.entries(insights)) if (k !== "oldest") out[k] = v;
    return out;
  }
  function oldestOpenSlice(insights, view) {
    const known = OLDEST_VIEWS.includes(view) ? view : "findings";
    const oldest = insights && typeof insights === "object" ? insights["oldest"] : void 0;
    const rows = oldest ? oldest[known] : void 0;
    return { view: known, rows: Array.isArray(rows) ? rows : [] };
  }
  function mttrGroupTableSlice(byGroup) {
    if (!byGroup || typeof byGroup !== "object") return null;
    const b = byGroup;
    return { dimension: b["dimension"], rows: Array.isArray(b["rows"]) ? b["rows"] : [] };
  }
  function mttrGroupTrendSlice(byGroup) {
    var _a;
    if (!byGroup || typeof byGroup !== "object") return null;
    return (_a = byGroup["trend"]) != null ? _a : null;
  }
  var JOB_KEYS = [
    "job_id",
    "kind",
    "phase",
    "page",
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

  // src/server/errorLog.ts
  var KEY = "RECENT_ERRORS";
  var MAX_ENTRIES = 25;
  var MAX_MESSAGE_LEN = 500;
  var MAX_BLOB_CHARS = 8500;
  function truncate(s) {
    return s.length > MAX_MESSAGE_LEN ? s.slice(0, MAX_MESSAGE_LEN) + "\u2026" : s;
  }
  function recentErrors() {
    const raw = getProp(KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((e) => Boolean(e) && typeof e === "object" && !Array.isArray(e)).map((e) => {
        var _a, _b, _c, _d;
        return {
          ts: String((_a = e["ts"]) != null ? _a : ""),
          op: String((_b = e["op"]) != null ? _b : "api"),
          kind: String((_c = e["kind"]) != null ? _c : "error"),
          message: String((_d = e["message"]) != null ? _d : "")
        };
      });
    } catch {
      return [];
    }
  }
  function recordError(op, err, kind = "error", now) {
    try {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
      const entry = { ts: nowIso(now), op, kind, message: truncate(message) };
      const next = [entry, ...recentErrors()].slice(0, MAX_ENTRIES);
      let blob = JSON.stringify(next);
      while (next.length > 1 && blob.length > MAX_BLOB_CHARS) {
        next.pop();
        blob = JSON.stringify(next);
      }
      setProp(KEY, blob);
    } catch {
    }
  }
  function clearErrors() {
    deleteProp(KEY);
  }

  // src/domain/purge.ts
  function severityOf(rec) {
    return effectiveSeverity(rec).severity;
  }
  function matchesPurge(rec, set) {
    return set.has(severityOf(rec));
  }
  function purgeSet(severities) {
    return new Set(severities.map((s) => effectiveSeverity({ severity: s }).severity));
  }
  function bump(counts, sev2) {
    var _a;
    counts[sev2] = ((_a = counts[sev2]) != null ? _a : 0) + 1;
  }
  function previewSeverityPurge(state, severities) {
    const set = purgeSet(severities);
    const bySeverity = {};
    let ledgerRows = 0;
    let episodeRows = 0;
    for (const row of Object.values(state.ledger)) {
      if (!matchesPurge(row, set)) continue;
      ledgerRows += 1;
      bump(bySeverity, severityOf(row));
    }
    for (const e of state.episodes) {
      if (!matchesPurge(e, set)) continue;
      episodeRows += 1;
      bump(bySeverity, severityOf(e));
    }
    const flat = state.scans.filter((s) => s.shape === "flat");
    return {
      severities: [...set],
      ledgerRows,
      episodeRows,
      bySeverity,
      scansToRewrite: flat.filter((s) => !s.sealed).length,
      sealedScans: flat.filter((s) => s.sealed).length
    };
  }
  function narrowScanScope(severitiesText, set) {
    var _a;
    const current = (_a = parseSeverities(severitiesText)) != null ? _a : [...SELECTABLE_SEVERITIES];
    const remaining = current.filter((s) => !set.has(s));
    if (!remaining.length || remaining.length === current.length) return severitiesText;
    return serializeSeverities(remaining);
  }
  function purgeStateBySeverity(state, severities) {
    const set = purgeSet(severities);
    const ledger = {};
    let ledgerRemoved = 0;
    for (const [key, row] of Object.entries(state.ledger)) {
      if (matchesPurge(row, set)) {
        ledgerRemoved += 1;
        continue;
      }
      ledger[key] = { ...row };
    }
    const episodes = [];
    let episodeRemoved = 0;
    for (const e of state.episodes) {
      if (matchesPurge(e, set)) {
        episodeRemoved += 1;
        continue;
      }
      episodes.push({ ...e });
    }
    let scopesNarrowed = 0;
    const scans = state.scans.map((s) => {
      const narrowed = narrowScanScope(s.severities, set);
      if (narrowed !== s.severities) scopesNarrowed += 1;
      return { ...s, severities: narrowed };
    });
    return {
      state: { scans, ledger, episodes },
      ledgerRemoved,
      episodeRemoved,
      scopesNarrowed
    };
  }
  function purgeCheckpointBySeverity(checkpoint, severities) {
    var _a, _b;
    const set = purgeSet(severities);
    const kept = ((_a = checkpoint.ledger) != null ? _a : []).filter((r) => !matchesPurge(r, set));
    return {
      checkpoint: { ...checkpoint, ledger: kept },
      removed: ((_b = checkpoint.ledger) != null ? _b : []).length - kept.length
    };
  }
  function purgeCheckpointByKeys(checkpoint, keys) {
    var _a, _b;
    if (!keys.size) return { checkpoint, removed: 0 };
    const kept = ((_a = checkpoint.ledger) != null ? _a : []).filter((r) => !keys.has(r.vuln_key));
    return {
      checkpoint: { ...checkpoint, ledger: kept },
      removed: ((_b = checkpoint.ledger) != null ? _b : []).length - kept.length
    };
  }
  function purgeRecordsBySeverity(records, severities) {
    const set = purgeSet(severities);
    const kept = records.filter((r) => !matchesPurge(r, set));
    return { records: kept, removed: records.length - kept.length };
  }
  function purgePayloadBySeverity(payload, severities) {
    var _a;
    const set = purgeSet(severities);
    if (Array.isArray(payload)) {
      const looksEnveloped = payload.some(
        (p) => p && typeof p === "object" && !Array.isArray(p) && "data" in p
      );
      if (looksEnveloped) {
        let removed = 0;
        let kept = 0;
        let recognized = false;
        const pages = payload.map((page) => {
          const out2 = purgePayloadBySeverity(page, severities);
          removed += out2.removed;
          kept += out2.kept;
          recognized = recognized || out2.recognized;
          return out2.payload;
        });
        return { payload: pages, removed, kept, recognized };
      }
      const recs = payload.filter((r) => !!r && typeof r === "object");
      if (recs.length !== payload.length) {
        return { payload, removed: 0, kept: payload.length, recognized: false };
      }
      const out = purgeRecordsBySeverity(recs, severities);
      return { payload: out.records, removed: out.removed, kept: out.records.length, recognized: true };
    }
    if (payload && typeof payload === "object") {
      const obj = payload;
      const data = obj["data"];
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const vf = data["vulnerabilityFindings"];
        if (vf && typeof vf === "object" && !Array.isArray(vf) && "nodes" in vf) {
          const nodes = (_a = vf["nodes"]) != null ? _a : [];
          const keptNodes = nodes.filter((n) => !matchesPurge(n, set));
          return {
            payload: {
              ...obj,
              data: { ...data, vulnerabilityFindings: { ...vf, nodes: keptNodes } }
            },
            removed: nodes.length - keptNodes.length,
            kept: keptNodes.length,
            recognized: true
          };
        }
      }
    }
    return { payload, removed: 0, kept: 0, recognized: false };
  }
  function episodeMatches(e, c, set) {
    if (set && !matchesPurge(e, set)) return false;
    const resolved = parseTs(e.resolved_at);
    if (resolved === null) return false;
    return resolved < c.resolvedBeforeMs;
  }
  function previewEpisodePrune(state, c) {
    const set = c.severities ? purgeSet(c.severities) : null;
    const bySeverity = {};
    let rows = 0;
    let oldest = null;
    let newest = null;
    for (const e of state.episodes) {
      if (!episodeMatches(e, c, set)) continue;
      rows += 1;
      bump(bySeverity, severityOf(e));
      const at = e.resolved_at;
      if (at !== null) {
        if (oldest === null || at < oldest) oldest = at;
        if (newest === null || at > newest) newest = at;
      }
    }
    return { rows, bySeverity, oldest, newest, remaining: state.episodes.length - rows };
  }
  function pruneEpisodesCore(state, c) {
    const set = c.severities ? purgeSet(c.severities) : null;
    const episodes = [];
    const prunedKeys = [];
    for (const e of state.episodes) {
      if (episodeMatches(e, c, set)) {
        prunedKeys.push(e.vuln_key);
        continue;
      }
      episodes.push({ ...e });
    }
    return {
      state: {
        scans: state.scans.map((s) => ({ ...s })),
        ledger: Object.fromEntries(Object.entries(state.ledger).map(([k, v]) => [k, { ...v }])),
        episodes
      },
      removed: prunedKeys.length,
      prunedKeys
    };
  }
  function trimHistoryRows(rows, beforeDate) {
    const kept = rows.filter((r) => {
      const d = r["date"];
      return typeof d !== "string" || d >= beforeDate;
    });
    let oldestKept = null;
    for (const r of kept) {
      const d = r["date"];
      if (typeof d === "string" && (oldestKept === null || d < oldestKept)) oldestKept = d;
    }
    return { rows: kept, removed: rows.length - kept.length, oldestKept };
  }
  function previewHistoryTrim(rows, beforeDate) {
    const out = trimHistoryRows(rows, beforeDate);
    let oldest = null;
    for (const r of rows) {
      const d = r["date"];
      if (typeof d === "string" && (oldest === null || d < oldest)) oldest = d;
    }
    return { rows: out.removed, remaining: out.rows.length, oldest };
  }
  function archiveWalkOrder(scans) {
    return [...scans].filter((s) => s.shape === "flat").sort((a, b) => {
      var _a, _b;
      return ((_a = parseTs(a.ts)) != null ? _a : 0) < ((_b = parseTs(b.ts)) != null ? _b : 0) ? 1 : -1;
    });
  }

  // src/domain/importShard.ts
  var MANIFEST_KIND = "wiz-sidekick-migration-manifest";
  function beginImportSession(rawManifest) {
    var _a, _b, _c, _d, _e;
    if (rawManifest === null || typeof rawManifest !== "object" || Array.isArray(rawManifest)) {
      throw new ImportValidationError("The uploaded file is not a migration manifest.");
    }
    const rec = rawManifest;
    if (rec["kind"] !== MANIFEST_KIND) {
      throw new ImportValidationError(
        `Not a migration manifest (kind ${JSON.stringify((_a = rec["kind"]) != null ? _a : null)}).`
      );
    }
    const shardCount = Number(rec["shard_count"]);
    if (!Number.isInteger(shardCount) || shardCount < 0) {
      throw new ImportValidationError(`Manifest shard_count ${rec["shard_count"]} is invalid.`);
    }
    const rawScans = Array.isArray(rec["scans"]) ? rec["scans"] : [];
    const rawHistory = Array.isArray(rec["mttr_history"]) ? rec["mttr_history"] : [];
    const seen2 = /* @__PURE__ */ new Set();
    const sealed = [];
    for (const raw of rawScans) {
      if (typeof raw["scan_id"] !== "string" || !raw["scan_id"] || typeof raw["ts"] !== "string" || !raw["ts"]) {
        throw new ImportValidationError("Every manifest scan needs string scan_id and ts.");
      }
      if (seen2.has(raw["scan_id"])) continue;
      seen2.add(raw["scan_id"]);
      sealed.push(coerceScan(raw));
    }
    const sealedAsc = scansAsc(sealed);
    const badTs = sealedAsc.filter((r) => parseTs(r.ts) === null).map((r) => r.scan_id);
    if (badTs.length) {
      throw new ImportValidationError(`Manifest scan(s) ${badTs.join(", ")} have unparseable timestamps.`);
    }
    const flats = sealedAsc.filter((r) => r.shape === "flat");
    const floorRow = flats.length ? flats[flats.length - 1] : null;
    return {
      manifest: {
        scans: rawScans,
        mttr_history: rawHistory,
        shard_count: shardCount,
        session_id: typeof rec["session_id"] === "string" ? rec["session_id"] : null,
        totals: {
          ledger: Number((_c = (_b = rec["totals"]) == null ? void 0 : _b["ledger"]) != null ? _c : 0),
          episodes: Number((_e = (_d = rec["totals"]) == null ? void 0 : _d["episodes"]) != null ? _e : 0)
        }
      },
      sealedScans: sealedAsc,
      sealedIds: new Set(sealedAsc.map((r) => r.scan_id)),
      floorScanId: floorRow ? floorRow.scan_id : null,
      floorTs: floorRow ? floorRow.ts : null
    };
  }
  function applyShardCore(shard, ctx) {
    var _a, _b, _c, _d;
    const ledgerRows = [];
    const episodeRows = [];
    const checkpointRows = [];
    let converted = 0;
    let unclassified = 0;
    for (const raw of (_a = shard.ledger) != null ? _a : []) {
      const row = coerceLedger(raw);
      checkpointRows.push(row);
      if (normalizeSeverity(raw["severity"]) === "UNKNOWN") unclassified += 1;
      if (row.status === "RESOLVED" && ctx.sealedIds.has((_b = row.last_scan_id) != null ? _b : "")) {
        episodeRows.push(toEpisodeRow(row, ctx.compactionId));
        converted += 1;
      } else {
        ledgerRows.push(row);
      }
    }
    for (const raw of (_c = shard.episodes) != null ? _c : []) {
      episodeRows.push(coerceEpisode(raw));
      if (normalizeSeverity(raw["severity"]) === "UNKNOWN") unclassified += 1;
    }
    return {
      ledgerRows,
      episodeRows,
      checkpointRows,
      vulnsImported: checkpointRows.length,
      episodesImported: ((_d = shard.episodes) != null ? _d : []).length,
      episodesConverted: converted,
      unclassifiedSeverity: unclassified
    };
  }
  function checkpointManifest(floorScanId, floorTs, parts) {
    return { version: CHECKPOINT_VERSION, floor_scan_id: floorScanId, floor_ts: floorTs, parts };
  }

  // src/server/historyStore.ts
  function todayIso(now) {
    return new Date(now != null ? now : Date.now()).toISOString().slice(0, 10);
  }
  function recordSnapshot(medianDays, resolved = 0, open = 0, counts = null, when = null, slaPct = null, oldestOpenDays = null, openPastSla2 = null) {
    try {
      const date = when != null ? when : todayIso();
      const records = loadHistory().filter((r) => r.date !== date);
      records.push({
        date,
        median_days: Math.round(medianDays * 1e3) / 1e3,
        resolved: Math.trunc(resolved),
        open: Math.trunc(open),
        total: counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0,
        sla_pct: slaPct !== null ? Math.round(slaPct * 10) / 10 : null,
        oldest_open_days: oldestOpenDays !== null ? Math.round(oldestOpenDays * 1e3) / 1e3 : null,
        open_past_sla: openPastSla2 === null ? null : Math.trunc(openPastSla2)
      });
      records.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      overwrite(TABS.mttrHistory, records);
      bumpDataVersion();
      return true;
    } catch (e) {
      console.warn(`Failed to write MTTR history: ${e}`);
      return false;
    }
  }
  function importHistory(imported) {
    const { rows, added, skipped } = mergeMttrHistory(
      loadHistory(),
      imported
    );
    if (added) {
      overwrite(TABS.mttrHistory, rows);
      bumpDataVersion();
    }
    return { added, skipped };
  }
  function loadHistory() {
    var _a, _b, _c, _d;
    const rows = readAll(TABS.mttrHistory);
    const out = [];
    for (const r of rows) {
      const date = r["date"];
      if (typeof date !== "string" || Number.isNaN(Date.parse(date))) continue;
      out.push({
        date: date.slice(0, 10),
        median_days: Number((_a = r["median_days"]) != null ? _a : 0),
        resolved: Number((_b = r["resolved"]) != null ? _b : 0),
        open: Number((_c = r["open"]) != null ? _c : 0),
        total: Number((_d = r["total"]) != null ? _d : 0),
        sla_pct: r["sla_pct"] === null ? null : Number(r["sla_pct"]),
        oldest_open_days: r["oldest_open_days"] === null ? null : Number(r["oldest_open_days"]),
        // Pre-column rows have no cell here (empty → null, or header absent → undefined);
        // both map to null so the chart draws a gap, never a fabricated zero.
        open_past_sla: r["open_past_sla"] == null ? null : Number(r["open_past_sla"])
      });
    }
    return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  }

  // src/server/jobsStore.ts
  function normError(v) {
    const s = v == null ? "" : String(v).trim();
    return s === "" || s === "null" || s === "undefined" ? null : s;
  }
  function newJobId(kind, now) {
    return `${kind}-${nowIso(now).replace(/[:]/g, "")}`;
  }
  function createJob(row, now) {
    ensureTab(TABS.jobs);
    const full = { ...row, started_at: nowIso(now), updated_at: nowIso(now) };
    appendRows(TABS.jobs, [full]);
    return full;
  }
  function updateJob(jobId, patch, now) {
    updateWhere(TABS.jobs, "job_id", jobId, {
      ...patch,
      updated_at: nowIso(now)
    });
  }
  function rowToJob(r) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
    return {
      job_id: String((_a = r["job_id"]) != null ? _a : ""),
      kind: (_b = r["kind"]) != null ? _b : "scan",
      phase: (_c = r["phase"]) != null ? _c : "FAILED",
      scan_id: (_d = r["scan_id"]) != null ? _d : null,
      cursor: (_e = r["cursor"]) != null ? _e : null,
      page: Number((_f = r["page"]) != null ? _f : 0),
      findings_so_far: Number((_g = r["findings_so_far"]) != null ? _g : 0),
      page_size: Number((_h = r["page_size"]) != null ? _h : 0),
      total_count: Number((_i = r["total_count"]) != null ? _i : 0),
      params_json: (_j = r["params_json"]) != null ? _j : null,
      journal_ref: (_k = r["journal_ref"]) != null ? _k : null,
      error: normError(r["error"]),
      started_at: String((_l = r["started_at"]) != null ? _l : ""),
      updated_at: String((_m = r["updated_at"]) != null ? _m : "")
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
    scan: "trigger_continueScan",
    backfill: "trigger_continueBackfill",
    purge: "trigger_continuePurge"
  };
  function reclaimIfStale(job, now) {
    if (!isStaleJob(job, now)) return false;
    const handler = CONTINUE_HANDLERS[job.kind];
    if (handler) clearTriggers(handler);
    updateJob(job.job_id, {
      phase: "FAILED",
      error: "Reclaimed: the job stalled with no progress."
    });
    return true;
  }
  function lastJobOfKind(kind) {
    const rows = listJobs().filter((j) => j.kind === kind);
    if (!rows.length) return null;
    return rows.reduce((a, b) => a.started_at >= b.started_at ? a : b);
  }
  function activeJob() {
    var _a;
    return (_a = listJobs().find((j) => !isTerminalPhase(j.phase))) != null ? _a : null;
  }

  // src/server/ledgerStore.ts
  function rowToScan(r) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    return {
      scan_id: String((_a = r["scan_id"]) != null ? _a : ""),
      ts: String((_b = r["ts"]) != null ? _b : ""),
      mode: String((_c = r["mode"]) != null ? _c : ""),
      shape: r["shape"] === "grouped" ? "grouped" : "flat",
      total: Number((_d = r["total"]) != null ? _d : 0),
      new_count: Number((_e = r["new_count"]) != null ? _e : 0),
      resolved_count: Number((_f = r["resolved_count"]) != null ? _f : 0),
      reopened_count: Number((_g = r["reopened_count"]) != null ? _g : 0),
      raw_ref: (_h = r["raw_ref"]) != null ? _h : null,
      obs_ref: (_i = r["obs_ref"]) != null ? _i : null,
      severities: (_j = r["severities"]) != null ? _j : null,
      sealed: r["sealed"] === 1 || r["sealed"] === "1" || r["sealed"] === true ? 1 : 0
    };
  }
  function rowToLedger(r) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t;
    return {
      vuln_key: String((_a = r["vuln_key"]) != null ? _a : ""),
      cve: (_b = r["cve"]) != null ? _b : null,
      severity: (_c = r["severity"]) != null ? _c : null,
      asset_id: (_d = r["asset_id"]) != null ? _d : null,
      asset_name: (_e = r["asset_name"]) != null ? _e : null,
      asset_type: (_f = r["asset_type"]) != null ? _f : null,
      cloud: (_g = r["cloud"]) != null ? _g : null,
      first_seen: (_h = r["first_seen"]) != null ? _h : null,
      last_seen: (_i = r["last_seen"]) != null ? _i : null,
      status: String((_j = r["status"]) != null ? _j : "OPEN"),
      resolved_at: (_k = r["resolved_at"]) != null ? _k : null,
      resolution_src: (_l = r["resolution_src"]) != null ? _l : null,
      reopened_count: Number((_m = r["reopened_count"]) != null ? _m : 0),
      first_scan_id: (_n = r["first_scan_id"]) != null ? _n : null,
      last_scan_id: (_o = r["last_scan_id"]) != null ? _o : null,
      subscription_name: (_p = r["subscription_name"]) != null ? _p : null,
      subscription_ext_id: (_q = r["subscription_ext_id"]) != null ? _q : null,
      tags_json: (_r = r["tags_json"]) != null ? _r : null,
      fix_date: (_s = r["fix_date"]) != null ? _s : null,
      fix_observed_at: (_t = r["fix_observed_at"]) != null ? _t : null,
      ...coerceRiskSignals(r)
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
  function scanRowExists(scanId) {
    return loadScanRows().some((s) => s.scan_id === scanId);
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
    for (const r of readAll(TABS.vulnLedger)) {
      const row = rowToLedger(r);
      state.ledger[row.vuln_key] = row;
    }
    state.episodes = readAll(TABS.episodes).map((r) => {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
      return {
        vuln_key: String((_a = r["vuln_key"]) != null ? _a : ""),
        cve: (_b = r["cve"]) != null ? _b : null,
        severity: (_c = r["severity"]) != null ? _c : null,
        first_seen: (_d = r["first_seen"]) != null ? _d : null,
        resolved_at: (_e = r["resolved_at"]) != null ? _e : null,
        resolution_src: (_f = r["resolution_src"]) != null ? _f : null,
        reopened_count: Number((_g = r["reopened_count"]) != null ? _g : 0),
        compaction_id: String((_h = r["compaction_id"]) != null ? _h : ""),
        superseded_by_scan: (_i = r["superseded_by_scan"]) != null ? _i : null,
        fix_date: (_j = r["fix_date"]) != null ? _j : null,
        fix_observed_at: (_k = r["fix_observed_at"]) != null ? _k : null,
        // Null on every episode sealed before this column existed — the backfill job
        // (backfillTags) recovers those from the Drive checkpoints; until it runs they read as
        // Not attributable, which is the honest answer rather than a guess.
        tags_json: (_l = r["tags_json"]) != null ? _l : null,
        ...coerceRiskSignals(r)
      };
    });
    if (useSnapshot) stateMemo = state;
    return state;
  }
  function writeStateTables(state) {
    ensureTab(TABS.vulnLedger);
    ensureTab(TABS.episodes);
    overwrite(TABS.vulnLedger, Object.values(state.ledger));
    overwrite(TABS.episodes, state.episodes);
    overwrite(TABS.scans, scansAsc(state.scans));
    writeLedgerSnapshot(state);
    invalidateLedgerMemos();
  }
  function persistFlatScan2(records, options) {
    var _a, _b, _c;
    const state = loadState();
    const scanId = options.scanId || nowIso();
    const existing = state.scans.find((s) => s.scan_id === scanId);
    if (existing) {
      return {
        deltas: {
          new_count: existing.new_count,
          resolved_count: existing.resolved_count,
          reopened_count: existing.reopened_count
        },
        scanRow: null
      };
    }
    const jobId = (_a = options.jobId) != null ? _a : newJobId("scan");
    const journalRef = writeJournal(jobId, state);
    if (options.jobId) {
      updateJob(jobId, { phase: "PERSISTING", scan_id: scanId, journal_ref: journalRef });
    } else {
      createJob({
        job_id: jobId,
        kind: "scan",
        phase: "PERSISTING",
        scan_id: scanId,
        cursor: null,
        page: 0,
        findings_so_far: records.length,
        page_size: 0,
        total_count: 0,
        params_json: null,
        journal_ref: journalRef,
        error: null
      });
    }
    const { deltas, observations, scanRow } = persistFlatScan(state, records, {
      mode: options.mode,
      scanId,
      scannedSeverities: (_b = options.scannedSeverities) != null ? _b : null,
      rawRef: (_c = options.rawRef) != null ? _c : null
    });
    const obsRef = writeObservations(scanId, observations);
    if (scanRow) scanRow.obs_ref = obsRef;
    overwrite(TABS.vulnLedger, Object.values(state.ledger));
    overwrite(TABS.episodes, state.episodes);
    writeLedgerSnapshot(state);
    if (scanRow) appendRows(TABS.scans, [scanRow]);
    invalidateLedgerMemos();
    updateJob(jobId, { phase: "DONE" });
    trashFile(journalRef);
    return { deltas, scanRow };
  }
  function persistGroupedScan2(nodes, options) {
    var _a, _b, _c;
    const state = loadState();
    const { deltas, scanRow } = persistGroupedScan(state, nodes, {
      mode: options.mode,
      scanId: (_a = options.scanId) != null ? _a : null,
      scannedSeverities: (_b = options.scannedSeverities) != null ? _b : null,
      rawRef: (_c = options.rawRef) != null ? _c : null
    });
    if (scanRow) {
      appendRows(TABS.scans, [scanRow]);
      invalidateLedgerMemos();
    }
    return { deltas, scanRow };
  }
  var readPayloadForRow = (row) => readScanPayload(row.raw_ref);
  function loadBaseRows(now) {
    return baseRows(loadState(), now);
  }
  var KM_TREND_MAX_RECONSTRUCTED = 48;
  function loadTrend(severities = null, showNoFix = true, baseOverride) {
    const state = loadState();
    const hideNoFix = !showNoFix;
    const base = (baseOverride != null ? baseOverride : baseRows(state)).map((r) => ({
      severity: r.severity,
      first_seen: r.first_seen,
      resolved_at: r.resolved_at,
      mttr_days: r.mttr_days,
      // actionable_from feeds the actionable-clock open-past-SLA plus the SLA-burn / cohort-
      // attainment decorators below (deadline = actionable_from + severity target).
      actionable_from: r.actionable_from,
      // fix_available_at feeds the as-of no-fix exclusion in the open / KM-median series when
      // the show-no-fix toggle is off (hideNoFix); ignored on the default path.
      fix_available_at: r.fix_available_at
    }));
    const points = trendFromBase(
      state.scans.map((s) => ({ ts: s.ts, shape: s.shape })),
      base,
      severities,
      { backfill: true, hideNoFix }
    );
    const withSla = withOpenPastSla(points, base, severities, "actionable_from");
    const withBurn = withSlaBurn(withSla, base, severities);
    const withAttainment = cohortSlaAttainment(withBurn, base, severities);
    return withKmMedian(withAttainment, base, severities, {
      hideNoFix,
      maxReconstructed: KM_TREND_MAX_RECONSTRUCTED
    });
  }
  function loadProgramTrend(rule, severities = null, baseOverride) {
    const state = loadState();
    const base = (baseOverride != null ? baseOverride : baseRows(state)).map((r) => ({
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
      state.scans.map((s) => ({ ts: s.ts, shape: s.shape })),
      base,
      severities,
      { backfill: true }
    );
    return withCoverageEfficiency(points, base, rule, severities);
  }
  function latestScanRow() {
    return latestScan(loadScanRows());
  }
  function latestFlatScanRow() {
    const flats = loadScanRows().filter((s) => s.shape === "flat");
    return flats.length ? flats[flats.length - 1] : null;
  }
  function latestCheckpoint() {
    const rows = readAll(TABS.compactions).filter((r) => r["checkpoint_ref"]);
    if (!rows.length) return null;
    rows.sort((a, b) => String(a["ts"]) < String(b["ts"]) ? 1 : -1);
    return readCheckpoint(rows[0]["checkpoint_ref"]);
  }
  function backfillEpisodeTags() {
    const state = loadState();
    const journalRef = writeJournal(newJobId("compact"), state);
    const result = backfillTagsFromCheckpoint(state, latestCheckpoint());
    if (result.recovered) {
      writeStateTables(state);
      writeLedgerSnapshot(state);
      invalidateLedgerMemos();
    }
    trashFile(journalRef);
    return result;
  }
  function deleteScans(scanIds, jobId) {
    const state = loadState();
    const checkpoint = latestCheckpoint();
    const jid = jobId != null ? jobId : newJobId("delete");
    const { state: rebuilt, result, observationsByScan } = deleteScansCore(
      state,
      scanIds,
      readPayloadForRow,
      checkpoint
    );
    if (!result.deleted) return result;
    const journalRef = writeJournal(jid, state);
    if (jobId) {
      updateJob(jid, { phase: "REPLAYING", journal_ref: journalRef });
    } else {
      createJob({
        job_id: jid,
        kind: "delete",
        phase: "REPLAYING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: JSON.stringify({ scanIds }),
        journal_ref: journalRef,
        error: null
      });
    }
    for (const row of rebuilt.scans) {
      const obs = observationsByScan[row.scan_id];
      if (obs) row.obs_ref = writeObservations(row.scan_id, obs);
    }
    writeStateTables(rebuilt);
    updateJob(jid, { phase: "DONE" });
    trashFile(journalRef);
    const survivorRefs = new Set(rebuilt.scans.map((r) => r.raw_ref).filter(Boolean));
    for (const r of state.scans) {
      if (rebuilt.scans.some((s) => s.scan_id === r.scan_id)) continue;
      if (r.raw_ref && !survivorRefs.has(r.raw_ref)) trashScanArchive(r.raw_ref);
      trashFile(r.obs_ref);
    }
    return result;
  }
  function importBundle(bundle) {
    const state = loadState();
    if (readAll(TABS.compactions).length) {
      throw new ImportValidationError(
        "This ledger already has a compaction record (a prior compaction or import) \u2014 the one-shot migration import needs a never-compacted ledger."
      );
    }
    const nowMs = Date.now();
    const compactionId = `imp-${nowIso(nowMs).replace(/[:]/g, "")}`;
    const { state: merged, checkpoint, observationsByScan, counts } = importBundleCore(
      state,
      bundle,
      readPayloadForRow,
      { compactionId }
    );
    if (!counts.scans_imported && !counts.vulns_imported && !counts.episodes_imported) {
      return counts;
    }
    const jobId = newJobId("import", nowMs);
    const journalRef = writeJournal(jobId, state);
    createJob(
      {
        job_id: jobId,
        kind: "import",
        phase: "REPLAYING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: JSON.stringify({
          scans: counts.scans_imported,
          vulns: counts.vulns_imported,
          episodes: counts.episodes_imported
        }),
        journal_ref: journalRef,
        error: null
      },
      nowMs
    );
    for (const row of merged.scans) {
      const obs = observationsByScan[row.scan_id];
      if (obs) row.obs_ref = writeObservations(row.scan_id, obs);
    }
    const checkpointRef = writeCheckpoint(compactionId, checkpoint);
    appendRows(TABS.compactions, [
      {
        compaction_id: compactionId,
        ts: nowIso(nowMs),
        floor_scan_id: checkpoint.floor_scan_id,
        floor_ts: checkpoint.floor_ts,
        scans_sealed: counts.scans_imported,
        episodes_created: counts.episodes_imported + counts.episodes_converted,
        observations_pruned: 0,
        archive_bytes_freed: 0,
        db_bytes_freed: 0,
        checkpoint_ref: checkpointRef
      }
    ]);
    writeStateTables(merged);
    updateJob(jobId, { phase: "DONE" }, nowMs);
    trashFile(journalRef);
    return counts;
  }
  var APPEND_CHUNK = 5e3;
  function importJobState(job) {
    var _a;
    return JSON.parse((_a = job.params_json) != null ? _a : "{}");
  }
  function activeImportJob(sessionId) {
    const job = activeJob();
    if (!job || job.kind !== "import") return null;
    const st = importJobState(job);
    if (sessionId !== void 0 && st.sessionId !== sessionId) return null;
    return { job, st };
  }
  function chunkedAppend(tab, rows) {
    for (let i = 0; i < rows.length; i += APPEND_CHUNK) {
      appendRows(tab, rows.slice(i, i + APPEND_CHUNK));
    }
  }
  function importBeginSharded(rawManifest) {
    const existing = activeImportJob();
    if (existing) {
      return {
        sessionId: existing.st.sessionId,
        jobId: existing.job.job_id,
        shardCount: existing.st.shardCount,
        appliedShards: existing.st.appliedShards
      };
    }
    if (loadScanRows().length || readAll(TABS.compactions).length) {
      throw new ImportValidationError(
        "This ledger already has scans or a compaction record \u2014 the migration import needs a fresh, never-compacted ledger."
      );
    }
    const session = beginImportSession(rawManifest);
    const nowMs = Date.now();
    const compactionId = `imp-${nowIso(nowMs).replace(/[:]/g, "")}`;
    const sessionId = session.manifest.session_id || newJobId("import", nowMs);
    overwrite(TABS.vulnLedger, []);
    overwrite(TABS.episodes, []);
    trashLedgerSnapshot();
    writeImportManifest(sessionId, {
      scans: session.manifest.scans,
      mttr_history: session.manifest.mttr_history,
      compactionId,
      floorScanId: session.floorScanId,
      floorTs: session.floorTs,
      shardCount: session.manifest.shard_count
    });
    const jobId = newJobId("import", nowMs);
    const st = {
      sessionId,
      compactionId,
      shardCount: session.manifest.shard_count,
      appliedShards: 0,
      ledgerCommitted: 0,
      episodesCommitted: 0,
      partIds: [],
      floorScanId: session.floorScanId,
      floorTs: session.floorTs,
      sealedIds: [...session.sealedIds],
      scansTotal: session.sealedScans.length,
      counts: { vulns_imported: 0, episodes_imported: 0, episodes_converted: 0, unclassified_severity: 0 }
    };
    createJob(
      {
        job_id: jobId,
        kind: "import",
        phase: "STAGING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: session.manifest.shard_count,
        params_json: JSON.stringify(st),
        journal_ref: null,
        error: null
      },
      nowMs
    );
    invalidateLedgerMemos();
    return { sessionId, jobId, shardCount: st.shardCount, appliedShards: 0 };
  }
  function importApplyShard(sessionId, index, shard) {
    const active = activeImportJob(sessionId);
    if (!active) throw new ImportValidationError("No active import session \u2014 begin the import first.");
    const { job } = active;
    const st = active.st;
    if (index < st.appliedShards) {
      return { sessionId, jobId: job.job_id, shardCount: st.shardCount, appliedShards: st.appliedShards };
    }
    if (index !== st.appliedShards) {
      throw new ImportValidationError(
        `Shards must arrive in order \u2014 expected shard ${st.appliedShards}, got ${index}.`
      );
    }
    if (dataRowCount(TABS.vulnLedger) > st.ledgerCommitted) truncateAfter(TABS.vulnLedger, st.ledgerCommitted);
    if (dataRowCount(TABS.episodes) > st.episodesCommitted) truncateAfter(TABS.episodes, st.episodesCommitted);
    stageShard(sessionId, index, shard);
    const out = applyShardCore(shard, {
      sealedIds: new Set(st.sealedIds),
      compactionId: st.compactionId
    });
    chunkedAppend(TABS.vulnLedger, out.ledgerRows);
    chunkedAppend(TABS.episodes, out.episodeRows);
    const partId = writeCheckpointPart(st.compactionId, index, out.checkpointRows);
    const next = {
      ...st,
      appliedShards: index + 1,
      ledgerCommitted: st.ledgerCommitted + out.ledgerRows.length,
      episodesCommitted: st.episodesCommitted + out.episodeRows.length,
      partIds: [...st.partIds, partId],
      counts: {
        vulns_imported: st.counts.vulns_imported + out.vulnsImported,
        episodes_imported: st.counts.episodes_imported + out.episodesImported,
        episodes_converted: st.counts.episodes_converted + out.episodesConverted,
        unclassified_severity: st.counts.unclassified_severity + out.unclassifiedSeverity
      }
    };
    updateJob(job.job_id, { phase: "APPLYING", params_json: JSON.stringify(next) });
    invalidateLedgerMemos();
    return { sessionId, jobId: job.job_id, shardCount: st.shardCount, appliedShards: next.appliedShards };
  }
  function importFinalizeSharded(sessionId) {
    var _a, _b, _c;
    const active = activeImportJob(sessionId);
    if (!active) throw new ImportValidationError("No active import session to finalize.");
    const { job } = active;
    const st = active.st;
    if (st.appliedShards !== st.shardCount) {
      throw new ImportValidationError(
        `Import incomplete \u2014 ${st.appliedShards} of ${st.shardCount} shards applied.`
      );
    }
    updateJob(job.job_id, { phase: "FINALIZING" });
    const rawManifest = readImportManifest(sessionId);
    const session = beginImportSession({
      kind: "wiz-sidekick-migration-manifest",
      version: 1,
      shard_count: st.shardCount,
      session_id: sessionId,
      scans: (_a = rawManifest == null ? void 0 : rawManifest["scans"]) != null ? _a : [],
      mttr_history: (_b = rawManifest == null ? void 0 : rawManifest["mttr_history"]) != null ? _b : [],
      totals: { ledger: 0, episodes: 0 }
    });
    const present3 = new Set(loadScanRows().map((s) => s.scan_id));
    const toAppend = session.sealedScans.filter((s) => !present3.has(s.scan_id));
    chunkedAppend(TABS.scans, toAppend);
    invalidateLedgerMemos();
    const cpRef = writeCheckpointManifest(
      st.compactionId,
      checkpointManifest(st.floorScanId, st.floorTs, st.partIds)
    );
    if (readAll(TABS.compactions).length === 0) {
      appendRows(TABS.compactions, [
        {
          compaction_id: st.compactionId,
          ts: nowIso(),
          floor_scan_id: st.floorScanId,
          floor_ts: st.floorTs,
          scans_sealed: st.scansTotal,
          episodes_created: st.counts.episodes_imported + st.counts.episodes_converted,
          observations_pruned: 0,
          archive_bytes_freed: 0,
          db_bytes_freed: 0,
          checkpoint_ref: cpRef
        }
      ]);
    }
    const hist = importHistory((_c = rawManifest == null ? void 0 : rawManifest["mttr_history"]) != null ? _c : []);
    try {
      writeLedgerSnapshot(loadState(false));
    } catch (e) {
      console.warn(`Post-import snapshot skipped: ${e}`);
    }
    invalidateLedgerMemos();
    updateJob(job.job_id, { phase: "DONE" });
    trashImportSession(sessionId);
    return {
      scans_imported: st.scansTotal,
      scans_skipped: 0,
      vulns_imported: st.counts.vulns_imported,
      episodes_imported: st.counts.episodes_imported,
      episodes_converted: st.counts.episodes_converted,
      scans_replayed: 0,
      unclassified_severity: st.counts.unclassified_severity,
      history_added: hist.added,
      history_skipped: hist.skipped
    };
  }
  function importAbortSharded(sessionId) {
    const active = activeImportJob(sessionId);
    overwrite(TABS.vulnLedger, []);
    overwrite(TABS.episodes, []);
    trashLedgerSnapshot();
    trashImportSession(sessionId);
    invalidateLedgerMemos();
    if (active) updateJob(active.job.job_id, { phase: "CANCELLED", error: null });
    return { aborted: true };
  }
  function resetLedger() {
    const counts = {
      scans: loadScanRows().length,
      vulns: dataRowCount(TABS.vulnLedger),
      episodes: dataRowCount(TABS.episodes),
      compactions: readAll(TABS.compactions).length
    };
    overwrite(TABS.scans, []);
    overwrite(TABS.vulnLedger, []);
    overwrite(TABS.episodes, []);
    overwrite(TABS.compactions, []);
    overwrite(TABS.jobs, []);
    trashLedgerSnapshot();
    invalidateLedgerMemos();
    return counts;
  }
  function rewriteCheckpoints(transform) {
    let removed = 0;
    for (const row of readAll(TABS.compactions)) {
      const ref = row["checkpoint_ref"];
      if (!ref) continue;
      const cp = readCheckpoint(ref);
      if (!cp) continue;
      const out = transform(cp);
      if (!out.removed) continue;
      const compactionId = String(row["compaction_id"]);
      const newRef = rewriteCheckpoint(compactionId, ref, out.checkpoint);
      if (newRef !== ref) {
        updateWhere(TABS.compactions, "compaction_id", compactionId, { checkpoint_ref: newRef });
      }
      removed += out.removed;
    }
    return removed;
  }
  function previewMaintenance(severities, episodes, historyBeforeDate) {
    const state = loadState();
    return {
      purge: previewSeverityPurge(state, severities),
      episodes: previewEpisodePrune(state, episodes),
      history: previewHistoryTrim(readAll(TABS.mttrHistory), historyBeforeDate)
    };
  }
  function setScanObsRef(scanId, obsRef) {
    updateWhere(TABS.scans, "scan_id", scanId, { obs_ref: obsRef });
    invalidateLedgerMemos();
  }
  function purgeSeverityTabs(severities, jobId) {
    const state = loadState();
    const { state: purged, ledgerRemoved, episodeRemoved, scopesNarrowed } = purgeStateBySeverity(
      state,
      severities
    );
    const checkpointRemoved = rewriteCheckpoints((cp) => purgeCheckpointBySeverity(cp, severities));
    if (!ledgerRemoved && !episodeRemoved && !scopesNarrowed) {
      return { ledgerRemoved: 0, episodeRemoved: 0, checkpointRemoved, scopesNarrowed: 0 };
    }
    const journalRef = writeJournal(jobId, state);
    updateJob(jobId, { phase: "PERSISTING", journal_ref: journalRef });
    writeStateTables(purged);
    shrinkTab(TABS.vulnLedger);
    shrinkTab(TABS.episodes);
    updateJob(jobId, { phase: "PURGING", journal_ref: null });
    trashFile(journalRef);
    return { ledgerRemoved, episodeRemoved, checkpointRemoved, scopesNarrowed };
  }
  function pruneEpisodes(c) {
    const state = loadState();
    const { state: pruned, removed, prunedKeys } = pruneEpisodesCore(state, c);
    if (!removed) return { removed: 0, checkpointRemoved: 0, remaining: state.episodes.length };
    const jobId = newJobId("purge");
    const journalRef = writeJournal(jobId, state);
    const keys = new Set(prunedKeys);
    const checkpointRemoved = rewriteCheckpoints((cp) => purgeCheckpointByKeys(cp, keys));
    writeStateTables(pruned);
    shrinkTab(TABS.episodes);
    trashFile(journalRef);
    return { removed, checkpointRemoved, remaining: pruned.episodes.length };
  }
  function trimHistory(beforeDate) {
    const rows = readAll(TABS.mttrHistory);
    const out = trimHistoryRows(rows, beforeDate);
    if (!out.removed) {
      return { removed: 0, remaining: rows.length, oldestKept: out.oldestKept };
    }
    overwrite(TABS.mttrHistory, out.rows);
    shrinkTab(TABS.mttrHistory);
    bumpDataVersion();
    return { removed: out.removed, remaining: out.rows.length, oldestKept: out.oldestKept };
  }
  function compactLedger(retentionDays, dryRun = false, now) {
    const state = loadState();
    const prevCheckpoint = latestCheckpoint();
    const nowMs = now != null ? now : Date.now();
    const compactionId = `cmp-${nowIso(nowMs).replace(/[:]/g, "")}`;
    const probe = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
      dryRun: true,
      now: nowMs,
      compactionId
    });
    if (probe.result.no_op) return probe.result;
    const obsCountByScan = {};
    let archiveBytes = 0;
    for (const r of probe.newly) {
      obsCountByScan[r.scan_id] = readObservations(r.obs_ref).length;
      archiveBytes += scanArchiveBytes(r.raw_ref, null);
    }
    const plan = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
      dryRun,
      now: nowMs,
      compactionId,
      obsCountByScan,
      archiveBytes
    });
    if (dryRun || plan.state === null) return plan.result;
    const jobId = newJobId("compact", nowMs);
    const journalRef = writeJournal(jobId, state);
    createJob(
      {
        job_id: jobId,
        kind: "compact",
        phase: "PERSISTING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: JSON.stringify({ retentionDays }),
        journal_ref: journalRef,
        error: null
      },
      nowMs
    );
    const checkpointRef = writeCheckpoint(compactionId, plan.checkpoint);
    const compactions = readAll(TABS.compactions).map((r) => ({
      ...r,
      checkpoint_ref: null
    }));
    compactions.push(compactionRow(plan, checkpointRef, nowMs));
    overwrite(TABS.compactions, compactions);
    writeStateTables(plan.state);
    updateJob(jobId, { phase: "DONE" }, nowMs);
    trashFile(journalRef);
    let freed = 0;
    for (const r of plan.newly) {
      freed += scanArchiveBytes(r.raw_ref, r.obs_ref);
      trashScanArchive(r.raw_ref);
      trashFile(r.obs_ref);
    }
    plan.result.archive_bytes_freed = freed;
    return plan.result;
  }

  // src/server/settingsStore.ts
  var settingsMemo;
  function loadSettings() {
    if (settingsMemo !== void 0) return settingsMemo;
    const out = {};
    for (const row of readAll(TABS.settings)) {
      const key = row["key"];
      const raw = row["value_json"];
      if (typeof key !== "string" || !key) continue;
      if (typeof raw !== "string" || raw === "") {
        out[key] = null;
        continue;
      }
      try {
        out[key] = JSON.parse(raw);
      } catch {
        console.warn(`Unreadable settings value for ${key}; ignoring`);
      }
    }
    settingsMemo = out;
    return out;
  }
  function saveSettings(settings) {
    overwrite(
      TABS.settings,
      Object.entries(settings).map(([key, value]) => ({
        key,
        value_json: JSON.stringify(value != null ? value : null)
      }))
    );
    settingsMemo = settings;
    bumpDataVersion();
  }
  var getFetchSeverities2 = () => getFetchSeverities(loadSettings());
  var getDisplaySeverities2 = () => getDisplaySeverities(loadSettings());
  var getRetentionDays2 = () => getRetentionDays(loadSettings());
  var getAutoCompact2 = () => getAutoCompact(loadSettings());
  var getShowNoFix2 = () => getShowNoFix(loadSettings());
  var getIncludeEol2 = () => getIncludeEol(loadSettings());
  var getRiskRule2 = () => getRiskRule(loadSettings());
  var getDomains2 = () => getDomains(loadSettings());
  var sgMapMemo;
  function supportGroupRowsToMap(rows) {
    const map = {};
    for (const r of rows) {
      const token = r["token"];
      const group = r["group"];
      if (typeof token === "string" && token && typeof group === "string" && group) {
        map[token] = group;
      }
    }
    return map;
  }
  function supportGroupMapToRows(map) {
    const rows = [];
    if (map && typeof map === "object" && !Array.isArray(map)) {
      for (const [token, group] of Object.entries(map)) {
        if (typeof token === "string" && token && typeof group === "string" && group) {
          rows.push({ token, group });
        }
      }
    }
    return rows;
  }
  function getSupportGroupMap2() {
    if (sgMapMemo !== void 0) return { version: 0, map: sgMapMemo };
    ensureTab(TABS.supportGroupMap);
    const rows = readAll(TABS.supportGroupMap);
    const map = rows.length ? supportGroupRowsToMap(rows) : getSupportGroupMap(loadSettings()).map;
    sgMapMemo = map;
    return { version: 0, map };
  }
  function setFetchSeverities(sevs) {
    saveSettings(withFetchSeverities(loadSettings(), sevs));
  }
  function setDisplaySeverities(sevs) {
    saveSettings(withDisplaySeverities(loadSettings(), sevs));
  }
  function setRetentionDays(days) {
    saveSettings(withRetentionDays(loadSettings(), days));
  }
  function setAutoCompact(enabled) {
    saveSettings(withAutoCompact(loadSettings(), enabled));
  }
  function setShowNoFix(enabled) {
    saveSettings(withShowNoFix(loadSettings(), enabled));
  }
  function setIncludeEol(enabled) {
    saveSettings(withIncludeEol(loadSettings(), enabled));
  }
  function setRiskRule(rule) {
    saveSettings(withRiskRule(loadSettings(), rule));
  }
  function setRetentionAndCompact(days, enabled) {
    saveSettings(withAutoCompact(withRetentionDays(loadSettings(), days), enabled));
  }
  function setDomains(items) {
    saveSettings(withDomains(loadSettings(), items));
  }
  function setSupportGroupMap(map) {
    const rows = supportGroupMapToRows(map);
    ensureTab(TABS.supportGroupMap);
    overwrite(TABS.supportGroupMap, rows);
    sgMapMemo = supportGroupRowsToMap(rows);
    const settings = loadSettings();
    if ("support_group_map" in settings) {
      const cleaned = { ...settings };
      delete cleaned["support_group_map"];
      saveSettings(cleaned);
    } else {
      bumpDataVersion();
    }
  }

  // src/server/bizDomains.ts
  function configuredDomainTagKey() {
    return resolveDomainTagKey(getProp(PROP_KEYS.wizDomainTagKey));
  }
  function bizDomainOf(record, key) {
    return domainOfTags(recordTags(record), key);
  }
  function attachBizDomains(records) {
    const key = configuredDomainTagKey();
    for (const r of records) {
      const domain = bizDomainOf(r, key);
      if (domain) r["_bizDomain"] = domain;
    }
  }

  // src/server/wizSubscriptionsQuery.ts
  var PAGE_SIZE2 = 100;
  var PAGE_SIZE_FALLBACK2 = 50;
  var MAX_PAGES2 = 50;
  function isSafeTagKey(key) {
    return /^[\w/.:-]{1,120}$/.test(key);
  }
  function subscriptionsByTagQuery(tagKey) {
    if (!isSafeTagKey(tagKey)) {
      throw new Error(
        `Unsafe WIZ_SUPPORT_GROUP_TAG_KEY ${JSON.stringify(tagKey)} \u2014 allowed: letters, digits, _ . : / - (max 120 chars).`
      );
    }
    return 'query GetSubscriptionsByWizProvisioningTag($first: Int, $after: String) {\n  graphSearch(\n    query: {\n      type: [SUBSCRIPTION]\n      select: true\n      where: { tags: { CONTAINS: [{ key: "' + tagKey + '" }] } }\n    }\n    first: $first\n    after: $after\n  ) {\n    pageInfo { hasNextPage endCursor }\n    nodes { entities { id name properties } }\n  }\n}\n';
  }

  // src/server/supportGroups.ts
  function foldToken(v) {
    return String(v).trim().toLowerCase();
  }
  var FRAME_ID_COLS = [
    "vulnerableAsset.subscriptionId",
    "vulnerableAsset.subscriptionExternalId",
    "vulnerableAsset.subscriptionName"
  ];
  var LEDGER_ID_COLS = ["subscription_ext_id", "subscription_name"];
  function recordIdentityTokens(record) {
    const out = [];
    const va = record["vulnerableAsset"];
    for (const col of FRAME_ID_COLS) {
      const v = record[col];
      if (present(v)) out.push(String(v));
      else if (va && typeof va === "object" && !Array.isArray(va)) {
        const leaf = va[col.split(".").pop()];
        if (present(leaf)) out.push(String(leaf));
      }
    }
    for (const col of LEDGER_ID_COLS) {
      const v = record[col];
      if (present(v)) out.push(String(v));
    }
    return out;
  }
  function resolveSupportGroup(record, map) {
    for (const token of recordIdentityTokens(record)) {
      const group = map[foldToken(token)];
      if (group) return group;
    }
    return null;
  }
  function attachSupportGroups(records) {
    const { map } = getSupportGroupMap2();
    if (!Object.keys(map).length) return;
    for (const r of records) {
      const group = resolveSupportGroup(r, map);
      if (group) r["_supportGroup"] = group;
    }
  }
  function configuredTagKey() {
    var _a;
    return ((_a = getProp(PROP_KEYS.wizSupportGroupTagKey)) == null ? void 0 : _a.trim()) || DEFAULT_SUPPORT_GROUP_TAG_KEY;
  }
  function entityProperties(entity) {
    const p = entity["properties"];
    if (p && typeof p === "object" && !Array.isArray(p)) return p;
    if (typeof p === "string" && p) {
      try {
        const parsed = JSON.parse(p);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch {
      }
    }
    return {};
  }
  var PROP_ID_KEYS = [
    "subscriptionId",
    "subscriptionExternalId",
    "externalId",
    "cloudProviderID",
    "providerId",
    "subscriptionName",
    "name"
  ];
  function supportGroupValue(props, tagKey) {
    const tags = props["tags"];
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
      const v = tags[tagKey];
      if (present(v) && String(v).trim()) return String(v).trim();
    }
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (t && typeof t === "object" && String(t["key"]) === tagKey) {
          const v = t["value"];
          if (present(v) && String(v).trim()) return String(v).trim();
        }
      }
    }
    const flat = props[`tag:${tagKey}`];
    if (present(flat) && String(flat).trim()) return String(flat).trim();
    return null;
  }
  function parseSubscriptionEntity(entity, tagKey) {
    const props = entityProperties(entity);
    const group = supportGroupValue(props, tagKey);
    const tokens = [];
    if (group) {
      for (const k of PROP_ID_KEYS) {
        const v = props[k];
        if (present(v) && String(v).trim()) tokens.push(foldToken(v));
      }
      for (const k of ["id", "name"]) {
        const v = entity[k];
        if (present(v) && String(v).trim()) tokens.push(foldToken(v));
      }
    }
    return { group, tokens };
  }
  function recordSubscription(map, entity, tagKey) {
    const { group, tokens } = parseSubscriptionEntity(entity, tagKey);
    if (!group) return null;
    for (const token of tokens) map[token] = group;
    return group;
  }
  function fetchSupportGroups() {
    var _a;
    const tagKey = configuredTagKey();
    const query = subscriptionsByTagQuery(tagKey);
    const map = {};
    const groups = /* @__PURE__ */ new Set();
    let cursor = null;
    let subscriptions = 0;
    let logged = false;
    for (let page = 0; page < MAX_PAGES2; page++) {
      const result = graphSearchPage(query, { first: PAGE_SIZE2, after: cursor }, PAGE_SIZE_FALLBACK2);
      for (const node of result.nodes) {
        const entities = (_a = node["entities"]) != null ? _a : [];
        for (const entity of entities) {
          if (!logged) {
            console.log(`Support-group sample entity: ${JSON.stringify(entity).slice(0, 800)}`);
            logged = true;
          }
          const group = recordSubscription(map, entity, tagKey);
          if (group) {
            subscriptions += 1;
            groups.add(group);
          }
        }
      }
      if (!result.hasNextPage || !result.endCursor) break;
      cursor = result.endCursor;
    }
    return {
      map,
      stats: { subscriptions, keys: Object.keys(map).length, groups: groups.size, tagKey }
    };
  }
  function refreshSupportGroups() {
    const { map, stats } = fetchSupportGroups();
    setSupportGroupMap(map);
    return stats;
  }

  // src/server/findings.ts
  var memo2;
  function invalidateFrameMemo() {
    memo2 = void 0;
  }
  function currentScan() {
    if (memo2 !== void 0) return memo2;
    const row = latestFlatScanRow();
    if (!row) {
      memo2 = null;
      return memo2;
    }
    const domains = getDomains2();
    const compiled = compileDomains(domains.items);
    const frame = readFrame(row.scan_id);
    let records;
    if (frame) {
      records = frame.map((flat) => {
        flat["_sev"] = normalizeSeverity(flat["severity"]);
        return flat;
      });
    } else {
      let slim = readSlimRecords(row.scan_id);
      if (!slim) {
        const payload = readScanPayload(row.raw_ref);
        slim = payload ? extractNodes(payload) : [];
      }
      records = (slim != null ? slim : []).map((n) => {
        const flat = flattenNode(n);
        flat["_vuln_key"] = vulnKey(n);
        flat["_sev"] = normalizeSeverity(flat["severity"]);
        return flat;
      });
    }
    attachSupportGroups(records);
    attachBizDomains(records);
    for (const flat of records) {
      const resolved = resolveDomain(flat, compiled);
      flat["_domain"] = resolved.name;
      flat["_domainSource"] = resolved.source;
    }
    memo2 = {
      scanId: row.scan_id,
      ts: row.ts,
      mode: row.mode,
      shape: row.shape,
      total: row.total,
      severities: row.severities,
      records
    };
    return memo2;
  }
  function applyFilters(records, f) {
    var _a, _b, _c, _d, _e, _f;
    let out = records;
    if ((_a = f.severities) == null ? void 0 : _a.length) {
      const keep = new Set(f.severities.map(normalizeSeverity));
      out = out.filter((r) => keep.has(String(r["_sev"])));
    }
    if ((_b = f.statuses) == null ? void 0 : _b.length) {
      const keep = new Set(f.statuses.map((s) => s.toUpperCase()));
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["status"]) != null ? _a2 : "").toUpperCase());
      });
    }
    if ((_c = f.assetTypes) == null ? void 0 : _c.length) {
      const keep = new Set(f.assetTypes);
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["vulnerableAsset.type"]) != null ? _a2 : ""));
      });
    }
    if ((_d = f.clouds) == null ? void 0 : _d.length) {
      const keep = new Set(f.clouds);
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["vulnerableAsset.cloudPlatform"]) != null ? _a2 : ""));
      });
    }
    if ((_e = f.domains) == null ? void 0 : _e.length) {
      const keep = new Set(f.domains);
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["_domain"]) != null ? _a2 : UNASSIGNED));
      });
    }
    if ((_f = f.supportGroups) == null ? void 0 : _f.length) {
      const keep = new Set(f.supportGroups);
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
      });
    }
    if (f.q && f.q.trim()) {
      const q = f.q.trim().toLowerCase();
      out = out.filter(
        (r) => {
          var _a2, _b2;
          return String((_a2 = r["name"]) != null ? _a2 : "").toLowerCase().includes(q) || String((_b2 = r["vulnerableAsset.name"]) != null ? _b2 : "").toLowerCase().includes(q);
        }
      );
    }
    return out;
  }
  function distinct(records, column) {
    const seen2 = /* @__PURE__ */ new Set();
    for (const r of records) {
      const v = r[column];
      if (present(v)) seen2.add(String(v));
    }
    return [...seen2].sort();
  }
  var TABLE_COLUMNS = [
    "_vuln_key",
    "_sev",
    "_domain",
    "_supportGroup",
    "name",
    "severity",
    "status",
    "detailedName",
    "fixedVersion",
    "firstDetectedAt",
    "resolvedAt",
    "lastDetectedAt",
    "score",
    "epssSeverity",
    "hasExploit",
    "hasCisaKevExploit",
    "vulnerableAsset.name",
    "vulnerableAsset.type",
    "vulnerableAsset.cloudPlatform",
    "vulnerableAsset.subscriptionName",
    "vulnerableAsset.operatingSystem"
  ];

  // src/server/readModelStore.ts
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
  var folderMemo;
  function readModelFolder() {
    if (folderMemo === void 0) folderMemo = subfolder("readmodels");
    return folderMemo;
  }
  function readModelFileName(name, params) {
    return `rm-${name}-${paramsHash(params)}.json.gz`;
  }
  function l2Read(name, params) {
    if (disabled) return { hit: false, why: "disabled" };
    try {
      const parsed = readGzJsonNamed("readmodels", readModelFileName(name, params));
      if (parsed === null || typeof parsed !== "object") return { hit: false, why: "absent" };
      const env = parsed;
      if (env.v !== ENVELOPE_V || env.name !== name) return { hit: false, why: "stale" };
      if (env.stamp !== currentStamp()) return { hit: false, why: "stale" };
      if (!(typeof env.writtenAtMs === "number") || Date.now() - env.writtenAtMs > MAX_AGE_MS) return { hit: false, why: "stale" };
      return { hit: true, value: env.value };
    } catch (e) {
      disabled = true;
      console.warn(`Durable read-model read (${name}) failed, L2 disabled for this run: ${e}`);
      return { hit: false, why: "unreadable" };
    }
  }
  function l2Write(name, params, value) {
    if (disabled) return;
    try {
      const env = {
        v: ENVELOPE_V,
        stamp: currentStamp(),
        name,
        paramsHash: paramsHash(params),
        writtenAtMs: Date.now(),
        value
      };
      writeGzJson(readModelFolder(), readModelFileName(name, params), env);
    } catch (e) {
      disabled = true;
      console.warn(`Durable read-model write (${name}) failed, L2 disabled for this run: ${e}`);
    }
  }
  function durablyCached(name, params, compute, ttlSec) {
    if (warming && touched) touched.add(readModelFileName(name, params));
    return cached(name, params, () => {
      const hit = l2Read(name, params);
      if (hit.hit) return hit.value;
      const value = compute();
      if (warming && (hit.why === "absent" || hit.why === "stale")) l2Write(name, params, value);
      return value;
    }, ttlSec);
  }
  function sweepReadModels() {
    if (disabled) return;
    if (!touched) return;
    const keep = touched;
    try {
      for (const name of listNames("readmodels")) {
        if (!keep.has(name)) trashNamed("readmodels", name);
      }
    } catch (e) {
      console.warn(`Durable read-model sweep failed: ${e}`);
    }
  }

  // src/server/locks.ts
  var LedgerBusyError = class extends Error {
  };
  function withScriptLock(fn, timeoutMs = 3e4) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(timeoutMs)) {
      throw new LedgerBusyError(
        "The ledger is busy (a scan or maintenance job is writing). Try again shortly."
      );
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }
  function recoverIfNeeded() {
    const job = activeJob();
    if (!job) return;
    if (job.phase !== "PERSISTING" && job.phase !== "REPLAYING") return;
    if (job.phase === "PERSISTING" && job.scan_id && scanRowExists(job.scan_id)) {
      updateJob(job.job_id, { phase: "DONE" });
      trashFile(job.journal_ref);
      return;
    }
    const journal = readJournal(job.journal_ref);
    if (journal) {
      writeStateTables(journal);
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Recovered: execution died mid-write; ledger restored from journal."
      });
      trashFile(job.journal_ref);
    } else {
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Execution died mid-write and no journal was found; run a fresh scan."
      });
    }
  }

  // src/server/backfillJobs.ts
  var backfillJobs_exports = {};
  __export(backfillJobs_exports, {
    backfillStatus: () => backfillStatus,
    continueBackfill: () => continueBackfill,
    startBackfill: () => startBackfill
  });
  var BUDGET_MS = 27e4;
  var FIRST_STEP_BUDGET_MS = 45e3;
  var CONTINUE_DELAY_MS = 1e3;
  var CONTINUE_HANDLER = "trigger_continueBackfill";
  function scheduleContinuation() {
    ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(CONTINUE_DELAY_MS).create();
  }
  function clearContinuationTriggers() {
    clearTriggers(CONTINUE_HANDLER);
  }
  function readResult(job) {
    var _a;
    try {
      return { ...emptyBackfillResult(), ...JSON.parse((_a = job.params_json) != null ? _a : "{}") };
    } catch {
      return emptyBackfillResult();
    }
  }
  function recordsForScan(row) {
    const slim = readSlimRecords(row.scan_id);
    if (slim && slim.length) return slim;
    const frame = readFrame(row.scan_id);
    if (frame && frame.length) return frame;
    const payload = readScanPayload(row.raw_ref);
    if (payload === null) return null;
    const nodes = recordsFromPayload(payload);
    return nodes.length ? nodes : null;
  }
  function replayOrder(scans) {
    return scansAsc(scans).filter((s) => s.shape === "flat").reverse();
  }
  function startBackfill() {
    return withScriptLock(() => {
      var _a;
      const existing = activeJob();
      if (existing) {
        if (!reclaimIfStale(existing)) {
          if (existing.kind !== "backfill") {
            throw new Error(
              `Another job (${existing.kind}) is running. Wait for it to finish, then retry.`
            );
          }
          return statusOf(existing);
        }
      }
      clearContinuationTriggers();
      const scans = replayOrder(loadScanRows());
      const job = createJob({
        job_id: newJobId("backfill"),
        kind: "backfill",
        phase: "BACKFILLING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: scans.length,
        params_json: JSON.stringify(emptyBackfillResult()),
        journal_ref: null,
        error: null
      });
      step(job, FIRST_STEP_BUDGET_MS);
      return statusOf((_a = getJob(job.job_id)) != null ? _a : job);
    }, 12e4);
  }
  function step(job, budgetMs = BUDGET_MS) {
    const t0 = Date.now();
    const state = loadState();
    const scans = replayOrder(state.scans);
    const result = readResult(job);
    let done = job.page;
    let dirty = false;
    const journalRef = writeJournal(job.job_id, state);
    updateJob(job.job_id, { journal_ref: journalRef });
    if (done === 0) {
      try {
        const scan = currentScan();
        if (scan) {
          backfillRiskFromRecords(state, scan.records, scan.ts, result);
          backfillTagsFromRecords(state, scan.records, result);
          dirty = true;
        }
      } catch (e) {
        console.warn(`Backfill frame seed failed: ${e}`);
        recordError("backfillFrame", e);
      }
    }
    while (done < scans.length && Date.now() - t0 < budgetMs) {
      const row = scans[done];
      done += 1;
      if (row.sealed) {
        result.scansSealed += 1;
        continue;
      }
      let records = null;
      try {
        records = recordsForScan(row);
      } catch (e) {
        console.warn(`Backfill could not read scan ${row.scan_id}: ${e}`);
      }
      if (records === null) {
        result.scansUnreadable += 1;
        continue;
      }
      backfillRiskFromRecords(state, records, row.ts, result);
      backfillTagsFromRecords(state, records, result);
      result.scansReplayed += 1;
      dirty = true;
    }
    if (dirty) writeStateTables(state);
    trashFile(journalRef);
    result.stillUnknown = countUnknownRisk(state);
    result.stillUnattributable = countUnattributable(state);
    updateJob(job.job_id, {
      page: done,
      findings_so_far: result.ledgerRowsTouched + result.episodeRowsTouched,
      params_json: JSON.stringify(result),
      journal_ref: null,
      phase: done >= scans.length ? "DONE" : "BACKFILLING"
    });
    if (done < scans.length) scheduleContinuation();
    else clearContinuationTriggers();
  }
  function continueBackfill(_e) {
    withScriptLock(() => {
      var _a;
      clearContinuationTriggers();
      const job = activeJob();
      if (!job || job.kind !== "backfill" || job.phase !== "BACKFILLING") return;
      try {
        step(job);
      } catch (e) {
        console.warn(`Backfill hop failed: ${e}`);
        recordError("backfillHop", e);
        updateJob(job.job_id, { phase: "FAILED", error: String((_a = e.message) != null ? _a : e) });
      }
    }, 12e4);
  }
  function statusOf(job) {
    return {
      jobId: job.job_id,
      phase: job.phase,
      // 0 means "not recorded", not "no scans" — a deployment whose jobs tab predates the
      // total_count column drops the write (jobsStore.createJob now heals that, but rows
      // written before the fix keep their blank). The UI must render this as an unknown total
      // rather than inventing a denominator.
      scansTotal: job.total_count,
      scansDone: job.page,
      result: readResult(job),
      error: job.error,
      updatedAt: job.updated_at,
      stale: job.phase === "BACKFILLING" && isStaleJob(job)
    };
  }
  function backfillStatus() {
    const active = activeJob();
    if (active && active.kind === "backfill") return statusOf(active);
    const last = lastJobOfKind("backfill");
    return last ? statusOf(last) : null;
  }

  // src/server/purgeJobs.ts
  var purgeJobs_exports = {};
  __export(purgeJobs_exports, {
    activePurgeJob: () => activePurgeJob,
    continuePurge: () => continuePurge,
    emptyPurgeResult: () => emptyPurgeResult,
    purgeStatus: () => purgeStatus,
    startSeverityPurge: () => startSeverityPurge
  });
  var BUDGET_MS2 = 27e4;
  var FIRST_STEP_BUDGET_MS2 = 45e3;
  var CONTINUE_DELAY_MS2 = 1e3;
  var CONTINUE_HANDLER2 = "trigger_continuePurge";
  function scheduleContinuation2() {
    ScriptApp.newTrigger(CONTINUE_HANDLER2).timeBased().after(CONTINUE_DELAY_MS2).create();
  }
  function clearContinuationTriggers2() {
    clearTriggers(CONTINUE_HANDLER2);
  }
  function emptyPurgeResult() {
    return {
      severities: [],
      scopeNarrowed: false,
      ledgerRemoved: 0,
      episodeRemoved: 0,
      checkpointRemoved: 0,
      scopesNarrowed: 0,
      scansRewritten: 0,
      recordsRemoved: 0,
      scansSealed: 0,
      scansUnreadable: 0,
      cellsBefore: 0,
      cellsAfter: 0
    };
  }
  function readResult2(job) {
    var _a;
    try {
      return { ...emptyPurgeResult(), ...JSON.parse((_a = job.params_json) != null ? _a : "{}") };
    } catch {
      return emptyPurgeResult();
    }
  }
  function cellsNow() {
    try {
      return cellUsage().total;
    } catch (e) {
      console.warn(`Purge cell measurement skipped: ${e}`);
      return 0;
    }
  }
  function purgeScanArchives(row, severities) {
    let removed = 0;
    let touched2 = false;
    let readable = false;
    for (const pageNo of listScanPageNumbers(row.raw_ref)) {
      const page = readScanPage(row.scan_id, pageNo);
      if (page === null) continue;
      readable = true;
      const out = purgePayloadBySeverity(page, severities);
      if (!out.recognized || !out.removed) continue;
      writeScanPage(row.scan_id, pageNo, out.payload);
      removed += out.removed;
      touched2 = true;
    }
    const slim = readSlimRecords(row.scan_id);
    if (slim) {
      readable = true;
      const out = purgeRecordsBySeverity(slim, severities);
      if (out.removed) {
        writeSlimRecords(row.scan_id, out.records);
        touched2 = true;
      }
    }
    const frame = readFrame(row.scan_id);
    if (frame) {
      const out = purgeRecordsBySeverity(frame, severities);
      if (out.removed) {
        writeFrame(row.scan_id, out.records);
        touched2 = true;
      }
    }
    if (row.obs_ref) {
      const obs = readObservations(row.obs_ref);
      if (obs.length) {
        const out = purgeRecordsBySeverity(obs, severities);
        if (out.removed) {
          const ref = writeObservations(row.scan_id, out.records);
          setScanObsRef(row.scan_id, ref);
          touched2 = true;
        }
      }
    }
    if (touched2) trashPageRuns(row.scan_id);
    return { removed, touched: touched2, readable };
  }
  function startSeverityPurge(severities, alsoNarrowScope) {
    return withScriptLock(() => {
      var _a, _b;
      if (!severities.length) throw new Error("Pick at least one severity to purge.");
      const existing = activeJob();
      if (existing && !reclaimIfStale(existing)) {
        throw new Error(
          `Another job (${existing.kind}) is running. Wait for it to finish, then retry.`
        );
      }
      clearContinuationTriggers2();
      const result = emptyPurgeResult();
      result.severities = [...severities];
      result.cellsBefore = cellsNow();
      const jobId = newJobId("purge");
      const scans = archiveWalkOrder(loadScanRows());
      const job = createJob({
        job_id: jobId,
        kind: "purge",
        phase: "PURGING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: scans.length,
        params_json: JSON.stringify(result),
        journal_ref: null,
        error: null
      });
      try {
        const tabs = purgeSeverityTabs(severities, jobId);
        result.ledgerRemoved = tabs.ledgerRemoved;
        result.episodeRemoved = tabs.episodeRemoved;
        result.checkpointRemoved = tabs.checkpointRemoved;
        result.scopesNarrowed = tabs.scopesNarrowed;
        if (alsoNarrowScope) {
          const purged = new Set(severities);
          const remaining = getFetchSeverities2().filter((s) => !purged.has(s));
          if (remaining.length) {
            setFetchSeverities(remaining);
            result.scopeNarrowed = true;
          }
        }
      } catch (e) {
        updateJob(jobId, { phase: "FAILED", error: String((_a = e.message) != null ? _a : e) });
        throw e;
      }
      updateJob(jobId, { params_json: JSON.stringify(result) });
      step2({ ...job, params_json: JSON.stringify(result) }, FIRST_STEP_BUDGET_MS2);
      return statusOf2((_b = getJob(jobId)) != null ? _b : job);
    }, 12e4);
  }
  function step2(job, budgetMs = BUDGET_MS2) {
    const t0 = Date.now();
    const result = readResult2(job);
    const severities = result.severities;
    const scans = archiveWalkOrder(loadScanRows());
    let done = job.page;
    while (done < scans.length && Date.now() - t0 < budgetMs) {
      const row = scans[done];
      done += 1;
      if (row.sealed) {
        result.scansSealed += 1;
        continue;
      }
      try {
        const out = purgeScanArchives(row, severities);
        if (!out.readable) {
          result.scansUnreadable += 1;
          continue;
        }
        result.recordsRemoved += out.removed;
        result.scansRewritten += 1;
      } catch (e) {
        console.warn(`Purge could not rewrite scan ${row.scan_id}: ${e}`);
        result.scansUnreadable += 1;
      }
    }
    const finished = done >= scans.length;
    if (finished) result.cellsAfter = cellsNow();
    updateJob(job.job_id, {
      page: done,
      findings_so_far: result.ledgerRemoved + result.episodeRemoved + result.recordsRemoved,
      params_json: JSON.stringify(result),
      phase: finished ? "DONE" : "PURGING"
    });
    if (finished) clearContinuationTriggers2();
    else scheduleContinuation2();
  }
  function continuePurge(_e) {
    withScriptLock(() => {
      var _a;
      clearContinuationTriggers2();
      const job = activeJob();
      if (!job || job.kind !== "purge" || job.phase !== "PURGING") return;
      try {
        step2(job);
      } catch (e) {
        console.warn(`Purge hop failed: ${e}`);
        recordError("purgeHop", e);
        updateJob(job.job_id, { phase: "FAILED", error: String((_a = e.message) != null ? _a : e) });
      }
    }, 12e4);
  }
  function statusOf2(job) {
    return {
      jobId: job.job_id,
      phase: job.phase,
      // 0 means "not recorded", not "no scans" — the UI must not print it as a denominator.
      scansTotal: job.total_count,
      scansDone: job.page,
      result: readResult2(job),
      error: job.error,
      updatedAt: job.updated_at,
      stale: job.phase === "PURGING" && isStaleJob(job)
    };
  }
  function activePurgeJob() {
    const job = activeJob();
    return job && job.kind === "purge" && !isTerminalPhase(job.phase) ? job : null;
  }
  function purgeStatus() {
    const active = activeJob();
    if (active && active.kind === "purge") return statusOf2(active);
    const last = lastJobOfKind("purge");
    return last ? statusOf2(last) : null;
  }

  // src/server/scanJobs.ts
  var scanJobs_exports = {};
  __export(scanJobs_exports, {
    cancelScan: () => cancelScan,
    clearContinuationTriggers: () => clearContinuationTriggers3,
    continueJob: () => continueJob,
    dailyScan: () => dailyScan,
    jobStatus: () => jobStatus,
    resetStuckJob: () => resetStuckJob,
    slimRecord: () => slimRecord,
    startScan: () => startScan
  });

  // src/server/frameCore.ts
  function buildFrame(records, pageOf) {
    return records.map((n, i) => {
      const flat = flattenNode(n);
      flat["_vuln_key"] = vulnKey(n);
      if (pageOf) flat["_page"] = pageOf(i);
      return flat;
    });
  }
  function pageOfFromRuns(runs, total) {
    if (!runs) return null;
    const pages = [];
    for (const [page, count] of runs) {
      for (let k = 0; k < count; k++) pages.push(page);
    }
    if (pages.length !== total) return null;
    return (i) => pages[i];
  }

  // src/server/sampleData.ts
  var SAMPLE_FLAT = { "data": { "vulnerabilityFindings": { "nodes": [{ "id": "vf_2b1c9e4a-6f3d-4a2b-9c1e-8d7f6a5b4c3d", "name": "CVE-2025-32463", "detailedName": "sudo 1.9.13p3-1ubuntu3.4", "description": "A flaw was found in sudo's chroot handling that allows a local user with limited sudo privileges to escalate to root by supplying a crafted /etc/nsswitch.conf inside a controlled chroot.", "severity": "CRITICAL", "status": "OPEN", "fixedVersion": "1.9.15p2-3ubuntu2", "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-04-01T08:12:44Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "lastDetectedAt": "2026-06-09T08:39:37Z", "resolvedAt": null, "validatedInRuntime": true, "runtimeValidationResult": "CONFIRMED", "reachability": "NETWORK", "hasTriggerableRemediation": false, "remediationPullRequestAvailable": false, "dataSourceName": "Wiz Sensor", "fixDate": null, "fixDateBefore": null, "publishedDate": "2026-03-28T00:00:00Z", "version": "1.9.13p3-1ubuntu3.4", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "1.9.13p3-1ubuntu3.4" }, "isOperatingSystemEndOfLife": false, "recommendedVersion": "1.9.15p2-3ubuntu2", "locationPath": "/usr/bin/sudo", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [], "note": null, "layerMetadata": null, "vulnerableAsset": { "id": "b06695d5-b271-58f3-9e27-c5b97658142e", "type": "VIRTUAL_MACHINE", "name": "web-prod-01", "cloudPlatform": "AWS", "subscriptionName": "prod-account", "subscriptionExternalId": "111122223333", "subscriptionId": "2b2211fb-742f-5566-af67-ab8992b58cfb", "tags": { "env": "prod", "team": "platform", "owner": "sre" }, "operatingSystem": "Ubuntu", "operatingSystemDistribution": { "id": "os-ubuntu-2404", "name": "Ubuntu 24.04", "icon": "ubuntu" }, "imageName": "ami-0a1b2c3d4e5f6a7b8", "imageId": "ami-0a1b2c3d4e5f6a7b8", "imageNativeType": "AMI", "hasLimitedInternetExposure": false, "hasWideInternetExposure": true, "isAccessibleFromVPN": false, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": { "id": "asg-web-prod", "externalId": "asg-web-prod-01", "name": "web-prod-asg", "replicaCount": 4, "tags": { "env": "prod" } }, "nativeType": "ec2", "isUsedOnPrem": false, "resourceGroupExternalId": null }, "sourceMappedCodeFindings": [], "transitivity": null, "rootComponent": null, "isHighProfileThreat": true, "vendorSeverity": "CRITICAL", "nvdSeverity": "HIGH", "weightedSeverity": "CRITICAL", "hasExploit": true, "usedInCodeResult": null, "hasCisaKevExploit": true, "cisaKevReleaseDate": "2026-04-03T00:00:00Z", "cisaKevDueDate": "2026-04-24T00:00:00Z", "score": 9.3, "epssSeverity": "CRITICAL", "epssPercentile": 0.981, "epssProbability": 0.91, "categories": ["PRIVILEGE_ESCALATION"], "hasInitialAccessPotential": false, "isClientSide": false, "affectedBySettings": false, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "EXPLOITABLE", "cvssv2": null, "cvssv3": { "attackVector": "LOCAL", "attackComplexity": "LOW", "confidentialityImpact": "HIGH", "integrityImpact": "HIGH", "privilegesRequired": "LOW", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "HIGH", "cnaScore": 7.8, "vendorScore": 9.3, "origin": "CONTEXTUAL", "duplicateOf": null }, { "id": "vf_7a4e1f2b-3c5d-4e6f-8a9b-1c2d3e4f5a6b", "name": "CVE-2026-0985", "detailedName": "openssl 3.0.13-0ubuntu3.4", "description": "An out-of-bounds read in the X.509 certificate parser can cause a denial of service when processing a malformed certificate chain.", "severity": "HIGH", "status": "RESOLVED", "fixedVersion": "3.0.13-0ubuntu3.6", "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-03-11T14:02:09Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "lastDetectedAt": "2026-03-25T06:11:52Z", "resolvedAt": "2026-03-26T09:45:00Z", "validatedInRuntime": false, "runtimeValidationResult": null, "reachability": "NETWORK", "hasTriggerableRemediation": true, "remediationPullRequestAvailable": true, "dataSourceName": "Wiz Sensor", "fixDate": "2026-03-26T09:45:00Z", "fixDateBefore": null, "publishedDate": "2026-02-18T00:00:00Z", "version": "3.0.13-0ubuntu3.4", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "3.0.13-0ubuntu3.4" }, "isOperatingSystemEndOfLife": false, "recommendedVersion": "3.0.13-0ubuntu3.6", "locationPath": "/usr/lib/x86_64-linux-gnu/libssl.so.3", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [], "note": { "id": "note-91f2", "text": "Patched during the March maintenance window." }, "layerMetadata": null, "vulnerableAsset": { "id": "66457926-3513-53eb-a09f-0e90b6f4feff", "type": "VIRTUAL_MACHINE", "name": "api-prod-02", "cloudPlatform": "Azure", "subscriptionName": "core-prod", "subscriptionExternalId": "azure-sub-001", "subscriptionId": "1fafc3d1-bbe3-5d13-8698-3df1f4514e37", "tags": { "env": "prod", "tier": "api" }, "operatingSystem": "Ubuntu", "operatingSystemDistribution": { "id": "os-ubuntu-2204", "name": "Ubuntu 22.04", "icon": "ubuntu" }, "imageName": null, "imageId": null, "imageNativeType": null, "hasLimitedInternetExposure": true, "hasWideInternetExposure": false, "isAccessibleFromVPN": true, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": null, "nativeType": "virtualMachine", "isUsedOnPrem": false, "resourceGroupExternalId": "rg-core-prod" }, "sourceMappedCodeFindings": [], "transitivity": "DIRECT", "rootComponent": { "name": "openssl" }, "isHighProfileThreat": false, "vendorSeverity": "HIGH", "nvdSeverity": "MEDIUM", "weightedSeverity": "HIGH", "hasExploit": false, "usedInCodeResult": null, "hasCisaKevExploit": false, "cisaKevReleaseDate": null, "cisaKevDueDate": null, "score": 7.5, "epssSeverity": "MEDIUM", "epssPercentile": 0.44, "epssProbability": 0.06, "categories": ["DENIAL_OF_SERVICE"], "hasInitialAccessPotential": false, "isClientSide": false, "affectedBySettings": false, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "NOT_EXPLOITABLE", "cvssv2": null, "cvssv3": { "attackVector": "NETWORK", "attackComplexity": "HIGH", "confidentialityImpact": "NONE", "integrityImpact": "NONE", "privilegesRequired": "NONE", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "HIGH", "cnaScore": 7.5, "vendorScore": 7.5, "origin": "CONTEXTUAL", "duplicateOf": null }, { "id": "vf_9c3d5e6f-4a2b-4c1d-8e7f-6a5b4c3d2e1f", "name": "CVE-2026-1442", "detailedName": "glibc 2.35-0ubuntu3.8", "description": "A buffer overflow in the DNS stub resolver can be triggered by a malicious DNS response, potentially leading to remote code execution in services performing name resolution.", "severity": "MEDIUM", "status": "OPEN", "fixedVersion": "2.35-0ubuntu3.9", "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-05-02T11:30:18Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "lastDetectedAt": "2026-06-11T10:07:38Z", "resolvedAt": null, "validatedInRuntime": false, "runtimeValidationResult": null, "reachability": null, "hasTriggerableRemediation": false, "remediationPullRequestAvailable": false, "dataSourceName": "Wiz Sensor", "fixDate": null, "fixDateBefore": "2026-08-02T00:00:00Z", "publishedDate": "2026-04-22T00:00:00Z", "version": "2.35-0ubuntu3.8", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "2.35-0ubuntu3.8" }, "isOperatingSystemEndOfLife": false, "recommendedVersion": "2.35-0ubuntu3.9", "locationPath": "/lib/x86_64-linux-gnu/libc.so.6", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [{ "id": "ignore-rule-4471" }], "note": null, "layerMetadata": null, "vulnerableAsset": { "id": "3aabb810-5c5d-5603-922e-e21fe60d8d73", "type": "VIRTUAL_MACHINE", "name": "batch-worker-03", "cloudPlatform": "GCP", "subscriptionName": "inix-tt4k", "subscriptionExternalId": "inix-tt4k", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "tags": { "env": "prod", "cluster_name": "inix-gke-eu-pr" }, "operatingSystem": "Ubuntu", "operatingSystemDistribution": { "id": "os-ubuntu-2204", "name": "Ubuntu 22.04", "icon": "ubuntu" }, "imageName": null, "imageId": null, "imageNativeType": null, "hasLimitedInternetExposure": false, "hasWideInternetExposure": false, "isAccessibleFromVPN": false, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": { "id": "gke-inix-gke-eu-pr-n4-shared", "externalId": "gke-inix-gke-eu-pr-n4-shared-19b3", "name": "n4-shared-19b3", "replicaCount": 12, "tags": { "goog-k8s-cluster-name": "inix-gke-eu-pr" } }, "nativeType": "instance", "isUsedOnPrem": false, "resourceGroupExternalId": null }, "sourceMappedCodeFindings": [], "transitivity": null, "rootComponent": null, "isHighProfileThreat": false, "vendorSeverity": "MEDIUM", "nvdSeverity": "MEDIUM", "weightedSeverity": "MEDIUM", "hasExploit": false, "usedInCodeResult": null, "hasCisaKevExploit": false, "cisaKevReleaseDate": null, "cisaKevDueDate": null, "score": 5.9, "epssSeverity": "LOW", "epssPercentile": 0.21, "epssProbability": 0.01, "categories": ["REMOTE_CODE_EXECUTION"], "hasInitialAccessPotential": true, "isClientSide": false, "affectedBySettings": true, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "UNKNOWN", "cvssv2": { "attackVector": "NETWORK", "attackComplexity": "MEDIUM", "confidentialityImpact": "PARTIAL", "integrityImpact": "PARTIAL", "privilegesRequired": null, "userInteractionRequired": false, "vectorString": "AV:N/AC:M/Au:N/C:P/I:P/A:P", "scope": null }, "cvssv3": { "attackVector": "NETWORK", "attackComplexity": "HIGH", "confidentialityImpact": "LOW", "integrityImpact": "LOW", "privilegesRequired": "NONE", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "LOW", "cnaScore": 5.9, "vendorScore": 5.9, "origin": "CONTEXTUAL", "duplicateOf": null }, { "id": "vf_1e2d3c4b-5a6f-4e8d-9c1b-2a3b4c5d6e7f", "name": "CVE-2025-58234", "detailedName": "linux-image-6.8.0-1015-aws 6.8.0-1015.16", "description": "A use-after-free in the kernel's netfilter subsystem allows a local unprivileged user to crash the system or potentially escalate privileges.", "severity": "LOW", "status": "RESOLVED", "fixedVersion": "6.8.0-1016.17", "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-01-20T05:44:11Z", "lastDetectedAt": "2026-02-09T07:00:00Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "resolvedAt": "2026-02-10T13:22:00Z", "validatedInRuntime": false, "runtimeValidationResult": null, "reachability": "INTERNAL", "hasTriggerableRemediation": false, "remediationPullRequestAvailable": false, "dataSourceName": "Wiz Sensor", "fixDate": "2026-02-10T13:22:00Z", "fixDateBefore": null, "publishedDate": "2025-12-30T00:00:00Z", "version": "6.8.0-1015.16", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "6.8.0-1015.16" }, "isOperatingSystemEndOfLife": false, "recommendedVersion": "6.8.0-1016.17", "locationPath": "/boot/vmlinuz-6.8.0-1015-aws", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [], "note": null, "layerMetadata": null, "vulnerableAsset": { "id": "c433c9a9-e631-5d56-8bd8-3c1cddd93103", "type": "VIRTUAL_MACHINE", "name": "dev-box-07", "cloudPlatform": "AWS", "subscriptionName": "dev-account", "subscriptionExternalId": "444455556666", "subscriptionId": "f391b2ee-ffdf-58e1-a3af-a59bfeaba3dc", "tags": { "env": "dev" }, "operatingSystem": "Amazon Linux", "operatingSystemDistribution": { "id": "os-al2023", "name": "Amazon Linux 2023", "icon": "amazon-linux" }, "imageName": "ami-0f1e2d3c4b5a6f7e8", "imageId": "ami-0f1e2d3c4b5a6f7e8", "imageNativeType": "AMI", "hasLimitedInternetExposure": false, "hasWideInternetExposure": false, "isAccessibleFromVPN": true, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": null, "nativeType": "ec2", "isUsedOnPrem": false, "resourceGroupExternalId": null }, "sourceMappedCodeFindings": [], "transitivity": null, "rootComponent": null, "isHighProfileThreat": false, "vendorSeverity": "LOW", "nvdSeverity": "LOW", "weightedSeverity": "LOW", "hasExploit": false, "usedInCodeResult": null, "hasCisaKevExploit": false, "cisaKevReleaseDate": null, "cisaKevDueDate": null, "score": 3.3, "epssSeverity": "LOW", "epssPercentile": 0.08, "epssProbability": 1e-3, "categories": ["PRIVILEGE_ESCALATION", "DENIAL_OF_SERVICE"], "hasInitialAccessPotential": false, "isClientSide": false, "affectedBySettings": false, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "NOT_EXPLOITABLE", "cvssv2": null, "cvssv3": { "attackVector": "LOCAL", "attackComplexity": "HIGH", "confidentialityImpact": "NONE", "integrityImpact": "NONE", "privilegesRequired": "LOW", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "LOW", "cnaScore": 3.3, "vendorScore": 3.3, "origin": "CONTEXTUAL", "duplicateOf": null }, { "id": "vf_eol-awaiting-0001", "name": "CVE-2026-4400", "detailedName": "openssl 1.0.2g-eol", "description": "A heap overflow in the TLS record layer. The host runs an end-of-life OS release; no fixed package is available from the vendor.", "severity": "HIGH", "status": "OPEN", "fixedVersion": null, "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-07-05T08:00:00Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "lastDetectedAt": "2026-07-16T08:00:00Z", "resolvedAt": null, "validatedInRuntime": true, "runtimeValidationResult": "CONFIRMED", "reachability": "NETWORK", "hasTriggerableRemediation": false, "remediationPullRequestAvailable": false, "dataSourceName": "Wiz Sensor", "fixDate": null, "fixDateBefore": null, "publishedDate": "2026-06-20T00:00:00Z", "version": "1.0.2g", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "1.9.13p3-1ubuntu3.4" }, "isOperatingSystemEndOfLife": true, "recommendedVersion": null, "locationPath": "/usr/lib/x86_64-linux-gnu/libssl.so.1.0.2", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [], "note": null, "layerMetadata": null, "vulnerableAsset": { "id": "e01dead0-0000-5eol-9999-legacyhost0001", "type": "VIRTUAL_MACHINE", "name": "legacy-host-01", "cloudPlatform": "AWS", "subscriptionName": "prod-account", "subscriptionExternalId": "111122223333", "subscriptionId": "2b2211fb-742f-5566-af67-ab8992b58cfb", "tags": { "env": "prod", "team": "platform", "owner": "sre" }, "operatingSystem": "Ubuntu", "operatingSystemDistribution": { "id": "os-ubuntu-1604", "name": "Ubuntu 16.04 (EOL)", "icon": "ubuntu" }, "imageName": "ami-0a1b2c3d4e5f6a7b8", "imageId": "ami-0a1b2c3d4e5f6a7b8", "imageNativeType": "AMI", "hasLimitedInternetExposure": false, "hasWideInternetExposure": true, "isAccessibleFromVPN": false, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": { "id": "asg-web-prod", "externalId": "asg-web-prod-01", "name": "web-prod-asg", "replicaCount": 4, "tags": { "env": "prod" } }, "nativeType": "ec2", "isUsedOnPrem": false, "resourceGroupExternalId": null }, "sourceMappedCodeFindings": [], "transitivity": null, "rootComponent": null, "isHighProfileThreat": false, "vendorSeverity": "HIGH", "nvdSeverity": "HIGH", "weightedSeverity": "HIGH", "hasExploit": true, "usedInCodeResult": null, "hasCisaKevExploit": false, "cisaKevReleaseDate": null, "cisaKevDueDate": null, "score": 7.5, "epssSeverity": "CRITICAL", "epssPercentile": 0.981, "epssProbability": 0.91, "categories": ["PRIVILEGE_ESCALATION"], "hasInitialAccessPotential": false, "isClientSide": false, "affectedBySettings": false, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "EXPLOITABLE", "cvssv2": null, "cvssv3": { "attackVector": "LOCAL", "attackComplexity": "LOW", "confidentialityImpact": "HIGH", "integrityImpact": "HIGH", "privilegesRequired": "LOW", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "HIGH", "cnaScore": 7.5, "vendorScore": 7.5, "origin": "CONTEXTUAL", "duplicateOf": null }], "pageInfo": { "hasNextPage": false, "endCursor": null } } } };
  var SAMPLE_GROUPED = { "data": { "vulnerabilityFindingsGroupedByValues": { "nodes": [{ "id": "CLCh_PAJEgEBIigKJhokYjA2Njk1ZDUtYjI3MS01OGYzLTllMjctYzViOTc2NTgxNDJl", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "b06695d5-b271-58f3-9e27-c5b97658142e", "type": "VIRTUAL_MACHINE", "name": "gke-inix-gke-eu-pr-n4-shared-19b3-fc6dab19-05ru", "cloudPlatform": "GCP", "externalId": "4787123027339367533", "subscriptionId": "2b2211fb-742f-5566-af67-ab8992b58cfb", "subscriptionName": "inix-tt4k", "subscriptionExternalId": "inix-tt4k", "tags": { "cluster_name": "inix-gke-eu-pr", "gke-inix-eu-pr-nodes-europe-west4": "gke-inix-eu-pr-nodes-europe-west4", "gke-inix-gke-eu-pr": "gke-inix-gke-eu-pr", "gke-inix-gke-eu-pr-b3192bb3-node": "gke-inix-gke-eu-pr-b3192bb3-node", "gke-inix-gke-eu-pr-n4-shared": "gke-inix-gke-eu-pr-n4-shared", "goog-gke-cluster-id-base32": "wmmsxm4ye5fsxldvevyserwhpfnupmogu4ausbma6yys6hfhup2q", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "inix-gke-eu-pr", "goog-k8s-node-pool-name": "n4-shared-19b3", "goog-terraform-provisioned": "true", "project": "inix-tt4k", "tag-inix-gke-eu-pr-ingress": "tag-inix-gke-eu-pr-ingress" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 63, "criticalSeverityFindingCount": 63, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokNjY0NTc5MjYtMzUxMy01M2ViLWEwOWYtMGU5MGI2ZjRmZWZm", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "66457926-3513-53eb-a09f-0e90b6f4feff", "type": "VIRTUAL_MACHINE", "name": "ENMFV0APP02", "cloudPlatform": "Alibaba", "externalId": "i-uf623aepimaj7zev1n25", "subscriptionId": "1fafc3d1-bbe3-5d13-8698-3df1f4514e37", "subscriptionName": "ENMS-PP", "subscriptionExternalId": "1985932850711133", "tags": { "Account": "1985932850711133", "Base_nsg_type": "VMPPD", "Domain": "VMM", "Env": "preprod", "Environment": "PREPROD", "Project": "ENM", "Terraform": "yes", "Vendor": "aliyun" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 57, "criticalSeverityFindingCount": 57, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokM2FhYmI4MTAtNWM1ZC01NjAzLTkyMmUtZTIxZmU2MGQ4ZDcz", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "3aabb810-5c5d-5603-922e-e21fe60d8d73", "type": "VIRTUAL_MACHINE", "name": "ENMFV0APP01", "cloudPlatform": "Alibaba", "externalId": "i-uf6eef938p2fzi1of1en", "subscriptionId": "1fafc3d1-bbe3-5d13-8698-3df1f4514e37", "subscriptionName": "ENMS-PP", "subscriptionExternalId": "1985932850711133", "tags": { "Account": "1985932850711133", "Base_nsg_type": "VMPPD", "Domain": "VMM", "Env": "preprod", "Environment": "PREPROD", "Project": "ENM", "Terraform": "yes", "Vendor": "aliyun" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 57, "criticalSeverityFindingCount": 57, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokYzQzM2M5YTktZTYzMS01ZDU2LThiZDgtM2MxY2RkZDkzMTAz", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "c433c9a9-e631-5d56-8bd8-3c1cddd93103", "type": "VIRTUAL_MACHINE", "name": "gke-vctech-gke-eu-pp-n4-shared-0d05f181-ep29", "cloudPlatform": "GCP", "externalId": "7603203856350539437", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "subscriptionName": "INIX-VCTECH", "subscriptionExternalId": "inix-vctech-0alr", "tags": { "cost_center": "50001z0536-001", "gke-vctech-gke-eu-pp": "gke-vctech-gke-eu-pp", "gke-vctech-gke-eu-pp-6830a116-node": "gke-vctech-gke-eu-pp-6830a116-node", "gke-vctech-gke-eu-pp-shared": "gke-vctech-gke-eu-pp-shared", "goog-fleet-project": "464185428346", "goog-gke-cluster-id-base32": "naykcfw275ezfoxzjnzpvvbquab2ieq336dell4s2ntdywfh43gq", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "vctech-gke-eu-pp", "goog-k8s-node-pool-name": "n4-shared", "net-gkenodes-inix-azae-prod-europe-west4": "net-gkenodes-inix-azae-prod-europe-west4", "net-main-gkenodes": "net-main-gkenodes", "owner": "jkrawc50", "project": "vctech-gke-eu-pp", "tag-vctech-gke-eu-pp-client": "tag-vctech-gke-eu-pp-client", "terraform": "true" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 56, "criticalSeverityFindingCount": 56, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokY2UwMGQ3ODQtMmE5OC01NjRlLThkM2UtYjZhYzNmNjQ5Mjdk", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "ce00d784-2a98-564e-8d3e-b6ac3f64927d", "type": "VIRTUAL_MACHINE", "name": "gke-inix-gke-eu-pp-pdk-72ab-941a6f69-fqrw", "cloudPlatform": "GCP", "externalId": "1511864616192343110", "subscriptionId": "f391b2ee-ffdf-58e1-a3af-a59bfeaba3dc", "subscriptionName": "inix-horsprod-n0wq", "subscriptionExternalId": "inix-horsprod-n0wq", "tags": { "cluster_name": "inix-gke-eu-pp", "gke-inix-eu-pp-nodes-europe-west4": "gke-inix-eu-pp-nodes-europe-west4", "gke-inix-gke-eu-pp": "gke-inix-gke-eu-pp", "gke-inix-gke-eu-pp-988606d9-node": "gke-inix-gke-eu-pp-988606d9-node", "gke-inix-gke-eu-pp-pdk": "gke-inix-gke-eu-pp-pdk", "goog-fleet-project": "inix-horsprod-n0wq", "goog-gke-cluster-id-base32": "tcdanwnkgndvzlohnlhmoapayhybvkjeqbfuokve2ufprzvps45q", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "spot", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "inix-gke-eu-pp", "goog-k8s-node-pool-name": "pdk-72ab", "goog-terraform-provisioned": "true", "project": "inix-horsprod-n0wq", "tag-inix-gke-eu-pp-ingress": "tag-inix-gke-eu-pp-ingress" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 49, "criticalSeverityFindingCount": 49, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokMTRlODJlYTAtOTgwNC01ZDJlLWE2OWUtNjhkNjg4NTU3OGY4", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "14e82ea0-9804-5d2e-a69e-68d6885578f8", "type": "VIRTUAL_MACHINE", "name": "gke-vctech-gke-eu-pr-n4-shared-c8e798db-duig", "cloudPlatform": "GCP", "externalId": "3799583756770569928", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "subscriptionName": "INIX-VCTECH", "subscriptionExternalId": "inix-vctech-0alr", "tags": { "cost_center": "50001z0536-001", "gke-vctech-gke-eu-pr": "gke-vctech-gke-eu-pr", "gke-vctech-gke-eu-pr-860fef39-node": "gke-vctech-gke-eu-pr-860fef39-node", "gke-vctech-gke-eu-pr-shared": "gke-vctech-gke-eu-pr-shared", "goog-gke-cluster-id-base32": "qyh66omu7jhr3bmgaftrfvltkjzc5ifdvowuvqm4dikservhcbua", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "vctech-gke-eu-pr", "goog-k8s-node-pool-name": "n4-shared", "net-gkenodes-inix-azae-prod-europe-west4": "net-gkenodes-inix-azae-prod-europe-west4", "net-main-gkenodes": "net-main-gkenodes", "owner": "jkrawc50", "project": "vctech-gke-eu-pr", "tag-vctech-gke-eu-pr-client": "tag-vctech-gke-eu-pr-client", "terraform": "true" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 49, "criticalSeverityFindingCount": 49, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokYjQ2ZWYyZDMtNTEyMS01YTg4LWFkMTEtNzNhNDYwZjI0OWFm", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "b46ef2d3-5121-5a88-ad11-73a460f249af", "type": "VIRTUAL_MACHINE", "name": "ENMFN0APP01", "cloudPlatform": "Alibaba", "externalId": "i-uf67w5ntp88b10tn592w", "subscriptionId": "d7297fe3-6ae8-59e5-b456-5050a1ca195b", "subscriptionName": "ENMS-pr", "subscriptionExternalId": "1950243589136840", "tags": { "Account": "1950243589136840", "Base_nsg_type": "VMPRD", "Domain": "VMM", "Env": "production", "Environment": "PROD", "Project": "ENM", "Terraform": "yes", "Vendor": "aliyun" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 43, "criticalSeverityFindingCount": 43, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokYjM0YTQ1YmEtZTg2MC01NTc5LWE3MzYtNzYzMmQ0NTdlYjIw", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "b34a45ba-e860-5579-a736-7632d457eb20", "type": "VIRTUAL_MACHINE", "name": "ENMFN0APP02", "cloudPlatform": "Alibaba", "externalId": "i-uf60a6i74bym0d8wjtx0", "subscriptionId": "d7297fe3-6ae8-59e5-b456-5050a1ca195b", "subscriptionName": "ENMS-pr", "subscriptionExternalId": "1950243589136840", "tags": { "Account": "1950243589136840", "Base_nsg_type": "VMPRD", "Domain": "VMM", "Env": "production", "Environment": "PROD", "Project": "ENM", "Terraform": "yes", "Vendor": "aliyun" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 43, "criticalSeverityFindingCount": 43, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokYzk4Mjg1MjktODNiZS01YTU4LTlhOGEtYTA5NGY3MGE3MjZh", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "c9828529-83be-5a58-9a8a-a094f70a726a", "type": "VIRTUAL_MACHINE", "name": "gke-vctech-gke-eu-pr-n4-shared-ada1118f-g9m6", "cloudPlatform": "GCP", "externalId": "8251205178823763465", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "subscriptionName": "INIX-VCTECH", "subscriptionExternalId": "inix-vctech-0alr", "tags": { "cost_center": "50001z0536-001", "gke-vctech-gke-eu-pr": "gke-vctech-gke-eu-pr", "gke-vctech-gke-eu-pr-860fef39-node": "gke-vctech-gke-eu-pr-860fef39-node", "gke-vctech-gke-eu-pr-shared": "gke-vctech-gke-eu-pr-shared", "goog-gke-cluster-id-base32": "qyh66omu7jhr3bmgaftrfvltkjzc5ifdvowuvqm4dikservhcbua", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "vctech-gke-eu-pr", "goog-k8s-node-pool-name": "n4-shared", "net-gkenodes-inix-azae-prod-europe-west4": "net-gkenodes-inix-azae-prod-europe-west4", "net-main-gkenodes": "net-main-gkenodes", "owner": "jkrawc50", "project": "vctech-gke-eu-pr", "tag-vctech-gke-eu-pr-client": "tag-vctech-gke-eu-pr-client", "terraform": "true" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 42, "criticalSeverityFindingCount": 42, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokOWQzNDg5N2UtNDRjZi01YTU1LThmZjctYjE5NmZhNWU4ZmQ4", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "9d34897e-44cf-5a55-8ff7-b196fa5e8fd8", "type": "VIRTUAL_MACHINE", "name": "gke-vctech-gke-eu-pp-n4-shared-c95b019b-qhwp", "cloudPlatform": "GCP", "externalId": "5646838182778991520", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "subscriptionName": "INIX-VCTECH", "subscriptionExternalId": "inix-vctech-0alr", "tags": { "cost_center": "50001z0536-001", "gke-vctech-gke-eu-pp": "gke-vctech-gke-eu-pp", "gke-vctech-gke-eu-pp-6830a116-node": "gke-vctech-gke-eu-pp-6830a116-node", "gke-vctech-gke-eu-pp-shared": "gke-vctech-gke-eu-pp-shared", "goog-fleet-project": "464185428346", "goog-gke-cluster-id-base32": "naykcfw275ezfoxzjnzpvvbquab2ieq336dell4s2ntdywfh43gq", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "vctech-gke-eu-pp", "goog-k8s-node-pool-name": "n4-shared", "net-gkenodes-inix-azae-prod-europe-west4": "net-gkenodes-inix-azae-prod-europe-west4", "net-main-gkenodes": "net-main-gkenodes", "owner": "jkrawc50", "project": "vctech-gke-eu-pp", "tag-vctech-gke-eu-pp-client": "tag-vctech-gke-eu-pp-client", "terraform": "true" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 35, "criticalSeverityFindingCount": 35, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }], "pageInfo": { "hasNextPage": true, "endCursor": "eyJmaWVsZHMiOlt7IkZpZWxkIjoiY3JpdGljYWxTZXZlcml0eUZpbmRpbmdDb3VudCIsIlZhbHVlIjozNX0seyJGaWVsZCI6ImhpZ2hTZXZlcml0eUZpbmRpbmdDb3VudCIsIlZhbHVlIjowfSx7IkZpZWxkIjoibWVkaXVtU2V2ZXJpdHlGaW5kaW5nQ291bnQiLCJWYWx1ZSI6MH0seyJGaWVsZCI6Imxvd1NldmVyaXR5RmluZGluZ0NvdW50IiwiVmFsdWUiOjB9LHsiRmllbGQiOiJpbmZvcm1hdGlvbmFsU2V2ZXJpdHlGaW5kaW5nQ291bnQiLCJWYWx1ZSI6MH0seyJGaWVsZCI6Imdyb3VwQnlLZXkiLCJWYWx1ZSI6IjlkMzQ4OTdlLTQ0Y2YtNWE1NS04ZmY3LWIxOTZmYTVlOGZkOCJ9XX0=" } } } };

  // src/server/scanJobs.ts
  var BUDGET_MS3 = 27e4;
  var FIRST_STEP_BUDGET_MS3 = 45e3;
  var CONTINUE_DELAY_MS3 = 3e4;
  var CONTINUE_RETRY_MS = 9e4;
  var CONTINUE_HANDLER3 = "trigger_continueScan";
  var DELTA_OVERLAP_MINUTES = 15;
  var FORCE_STOP_LOCK_MS = 1e4;
  var ScanCancelled = class extends Error {
  };
  var cancelKey = (jobId) => `CANCEL_${jobId}`;
  function isCancelRequested(jobId) {
    return Boolean(getProp(cancelKey(jobId)));
  }
  function clearCancel(jobId) {
    deleteProp(cancelKey(jobId));
  }
  function cancelScan(jobId) {
    const job = getJob(jobId);
    if (!job) return { jobId, stopped: false, message: "No such job." };
    if (isTerminalPhase(job.phase)) {
      return { jobId, stopped: true, message: "Scan already finished." };
    }
    if (job.kind !== "scan") return { jobId, ...forceStopOtherKind(job) };
    setProp(cancelKey(jobId), "1");
    const message = forceStop(jobId);
    return message === null ? { jobId, stopped: false, message: "Stopping scan\u2026" } : { jobId, stopped: true, message };
  }
  function forceStop(jobId) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(FORCE_STOP_LOCK_MS)) return null;
    try {
      recoverIfNeeded();
      const job = getJob(jobId);
      if (!job || job.kind !== "scan") return null;
      if (isTerminalPhase(job.phase)) {
        clearContinuationTriggers3();
        clearCancel(jobId);
        return "Scan stopped.";
      }
      if (job.phase === "FETCHING" || job.phase === "RECONCILING") {
        clearContinuationTriggers3();
        finalizeCancel(job);
        return "Scan stopped.";
      }
      return null;
    } finally {
      lock.releaseLock();
    }
  }
  function forceStopOtherKind(job) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(FORCE_STOP_LOCK_MS)) {
      return { stopped: false, message: `A ${job.kind} job is running and can't be interrupted.` };
    }
    try {
      recoverIfNeeded();
      const fresh = getJob(job.job_id);
      if (!fresh || isTerminalPhase(fresh.phase)) return { stopped: true, message: "Job stopped." };
      if (reclaimIfStale(fresh)) return { stopped: true, message: "Job stopped." };
      return { stopped: false, message: `A ${job.kind} job is still working \u2014 let it finish.` };
    } finally {
      lock.releaseLock();
    }
  }
  function finalizeCancel(job) {
    try {
      if (job.scan_id) trashScanArchive(scanFolder(job.scan_id).getId());
    } catch {
    }
    updateJob(job.job_id, { phase: "CANCELLED", error: null });
    clearCancel(job.job_id);
  }
  var SLIM_TOP = [
    "id",
    "name",
    "severity",
    "status",
    "firstDetectedAt",
    "firstSeenAt",
    "createdAt",
    "lastDetectedAt",
    "resolvedAt",
    "remediatedAt",
    "fixedAt",
    "detailedName",
    "detailedNameV2",
    "fixedVersion",
    "detectionMethod",
    "vendorSeverity",
    "nvdSeverity",
    "weightedSeverity",
    "score",
    "epssSeverity",
    "epssProbability",
    "hasExploit",
    "hasCisaKevExploit",
    "publishedDate",
    "dataSourceName",
    // Vendor-fix signals for the actionable clock / awaiting-vendor-fix segment.
    // Additive: frames persisted before this simply lack the keys (read as null).
    "fixDate",
    "fixDateBefore",
    "isOperatingSystemEndOfLife"
  ];
  var SLIM_ASSET = [
    "id",
    "name",
    "type",
    "cloudPlatform",
    "region",
    "subscriptionName",
    "subscriptionExternalId",
    "subscriptionId",
    "tags",
    "operatingSystem",
    // Exposure signals for the insights view. Additive: frames persisted before this
    // simply lack the keys, and the client reports exposure as "not captured".
    "hasWideInternetExposure",
    "hasLimitedInternetExposure"
  ];
  function slimRecord(node) {
    const out = {};
    for (const k of SLIM_TOP) {
      if (k in node) out[k] = node[k];
    }
    const eff = effectiveSeverity(node);
    if (eff.source !== null && eff.source !== "severity") {
      out["severity"] = eff.severity;
      out["severity_source"] = eff.source;
    }
    const va = node["vulnerableAsset"];
    if (va && typeof va === "object" && !Array.isArray(va)) {
      const slim = {};
      for (const k of SLIM_ASSET) {
        if (k in va) slim[k] = va[k];
      }
      out["vulnerableAsset"] = slim;
    }
    return out;
  }
  function writeFrameSafely(scanId, records, pageOf) {
    try {
      writeFrame(scanId, buildFrame(records, pageOf));
    } catch (e) {
      console.warn(`Failed to write findings frame for ${scanId}: ${e}`);
    }
  }
  function envelope(nodes) {
    return { data: { vulnerabilityFindings: { nodes } } };
  }
  function startScan(options = {}) {
    return withScriptLock(() => {
      recoverIfNeeded();
      const active = activeJob();
      if (active && !reclaimStaleJob(active)) {
        return { jobId: active.job_id, message: "A scan is already in progress." };
      }
      if (!hasWizCredentials()) return dryRunScan(options);
      if (options.incremental) return startIncremental();
      const scanId = nowIso();
      const job = createJob({
        job_id: newJobId("scan"),
        kind: "scan",
        phase: "FETCHING",
        scan_id: scanId,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: JSON.stringify({
          mode: "live",
          severities: getFetchSeverities2(),
          extraFilterBy: null,
          incremental: false,
          baselineScanId: null
        }),
        journal_ref: null,
        error: null
      });
      step3(job, FIRST_STEP_BUDGET_MS3);
      return { jobId: job.job_id, message: "Scan started." };
    });
  }
  function reclaimStaleJob(job) {
    if (!reclaimIfStale(job)) return false;
    clearCancel(job.job_id);
    return true;
  }
  function startIncremental() {
    const baseline = latestFlatScanRow();
    if (!baseline) {
      return { jobId: null, message: "Run a full scan first \u2014 quick refresh needs a baseline." };
    }
    const baseTs = parseTs(baseline.ts);
    if (baseTs === null) {
      return { jobId: null, message: "The saved baseline has no timestamp \u2014 run a full scan." };
    }
    const sinceIso = toIso(baseTs - DELTA_OVERLAP_MINUTES * 6e4);
    const baselineScope = parseSeverities(baseline.severities);
    const scanId = nowIso();
    const job = createJob({
      job_id: newJobId("scan"),
      kind: "scan",
      phase: "FETCHING",
      scan_id: scanId,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: JSON.stringify({
        mode: "incremental",
        severities: baselineScope,
        extraFilterBy: { updatedAt: { after: sinceIso } },
        incremental: true,
        baselineScanId: baseline.scan_id
      }),
      journal_ref: null,
      error: null
    });
    step3(job);
    return { jobId: job.job_id, message: "Quick refresh started." };
  }
  function dryRunScan(options) {
    const scanId = nowIso();
    if (options.sampleShape === "grouped") {
      const nodes2 = extractNodes(SAMPLE_GROUPED);
      writeScanPage(scanId, 1, SAMPLE_GROUPED);
      persistGroupedScan2(nodes2, {
        mode: "dry-run",
        scanId,
        rawRef: scanFolder(scanId).getId()
      });
      return { jobId: null, message: "Dry-run grouped scan saved." };
    }
    const seq = loadScanRows().filter((s) => s.mode.startsWith("dry-run")).length;
    const nodes = extractNodes(SAMPLE_FLAT).map((n) => ({ ...n }));
    const open = nodes.filter((n) => !n["resolvedAt"]);
    for (let i = 0; i < Math.min(seq, open.length); i++) {
      open[i]["resolvedAt"] = scanId;
      open[i]["status"] = "RESOLVED";
    }
    writeScanPage(scanId, 1, envelope(nodes));
    const slim = nodes.map(slimRecord);
    writeSlimRecords(scanId, slim);
    writeFrameSafely(scanId, slim, () => 1);
    persistFlatScan2(slim, {
      mode: options.incremental ? "dry-run-incremental" : "dry-run",
      scanId,
      scannedSeverities: null,
      rawRef: scanFolder(scanId).getId()
    });
    afterPersist(slim);
    return { jobId: null, message: "Dry-run scan saved." };
  }
  function step3(job, budgetMs = BUDGET_MS3) {
    var _a, _b, _c;
    const started = Date.now();
    const params = JSON.parse((_a = job.params_json) != null ? _a : "{}");
    const scanId = job.scan_id;
    let slim = job.page > 0 ? (_b = readSlimRecords(scanId)) != null ? _b : [] : [];
    const pageRuns = job.page > 0 ? (_c = readPageRuns(scanId)) != null ? _c : [] : [];
    let cursor = job.cursor;
    let page = job.page;
    let findings = job.findings_so_far;
    let totalCount = job.total_count;
    try {
      for (; ; ) {
        if (isCancelRequested(job.job_id)) throw new ScanCancelled();
        const result = fetchPage({
          severities: params.severities,
          extraFilterBy: params.extraFilterBy,
          cursor,
          pageNumber: page
        });
        const pageName = params.incremental ? page + 1001 : page + 1;
        writeScanPage(scanId, pageName, envelope(result.nodes));
        pushAll(slim, result.nodes.map(slimRecord));
        pageRuns.push([pageName, result.nodes.length]);
        page += 1;
        findings += result.nodes.length;
        cursor = result.endCursor;
        if (result.totalCount !== null) totalCount = result.totalCount;
        updateJob(job.job_id, { cursor, page, findings_so_far: findings, total_count: totalCount });
        if (!result.hasNextPage || page >= MAX_PAGES) break;
        if (Date.now() - started > budgetMs) {
          writeSlimRecords(scanId, slim);
          writePageRuns(scanId, pageRuns);
          scheduleContinuation3();
          return;
        }
      }
      writeSlimRecords(scanId, slim);
      writePageRuns(scanId, pageRuns);
      updateJob(job.job_id, { phase: "RECONCILING" });
      finishScan(job.job_id, scanId, params, slim);
    } catch (e) {
      if (e instanceof ScanCancelled) {
        finalizeCancel(job);
        return;
      }
      if (e instanceof WizDeltaFilterError) {
        clearCancel(job.job_id);
        updateJob(job.job_id, {
          phase: "FAILED",
          error: "The tenant rejected the updatedAt filter \u2014 quick refresh is unavailable; run a full scan."
        });
        return;
      }
      clearCancel(job.job_id);
      updateJob(job.job_id, {
        phase: "FAILED",
        error: e == null ? "Scan failed." : String(e).slice(0, 1e3)
      });
      recordError("scan", e);
      throw e;
    }
  }
  function finishScan(jobId, scanId, params, slim) {
    clearCancel(jobId);
    let records = slim;
    if (params.incremental) {
      if (!slim.length) {
        updateJob(jobId, { phase: "DONE", error: null });
        trashScanArchive(scanFolder(scanId).getId());
        return;
      }
      const baselineSlim = loadBaselineSlim(params.baselineScanId);
      if (baselineSlim === null) {
        updateJob(jobId, {
          phase: "FAILED",
          error: "The baseline scan's archive couldn't be read \u2014 run a full scan."
        });
        return;
      }
      records = mergeNodes(baselineSlim, slim);
      let pageNo = 1;
      for (let i = 0; i < records.length; i += 500) {
        writeScanPage(scanId, pageNo++, envelope(records.slice(i, i + 500)));
      }
      writeSlimRecords(scanId, records);
      writeFrameSafely(scanId, records, (i) => Math.floor(i / 500) + 1);
    } else {
      writeFrameSafely(scanId, records, pageOfFromRuns(readPageRuns(scanId), records.length));
    }
    updateJob(jobId, { phase: "PERSISTING", scan_id: scanId });
    scheduleContinuation3();
    persistFlatScan2(records, {
      mode: params.mode,
      scanId,
      scannedSeverities: params.severities,
      rawRef: scanFolder(scanId).getId(),
      jobId
    });
    afterPersist(records);
    updateJob(jobId, { phase: "DONE" });
    clearContinuationTriggers3();
    clearCancel(jobId);
  }
  function loadBaselineSlim(baselineScanId) {
    const slim = readSlimRecords(baselineScanId);
    if (slim && slim.length) return slim;
    const row = loadScanRows().find((s) => s.scan_id === baselineScanId);
    const payload = row ? readScanPayload(row.raw_ref) : null;
    if (!payload) return null;
    const nodes = extractNodes(payload);
    return nodes.length ? nodes.map(slimRecord) : null;
  }
  function afterPersist(records) {
    var _a, _b;
    refreshSupportGroupsAfterScan();
    try {
      const { perSev, overall } = calculateMttr(records);
      const median2 = overall.mttr_median;
      if (median2 !== null && median2 !== void 0) {
        const { slaPct, oldestDays } = overallSlaOldest(perSev);
        recordSnapshot(
          median2,
          (_a = overall.resolved) != null ? _a : 0,
          (_b = overall.open) != null ? _b : 0,
          countBySeverity(records),
          null,
          slaPct,
          oldestDays,
          openPastSlaFromRecords(records)
        );
      }
    } catch (e) {
      console.warn(`Failed to record MTTR snapshot: ${e}`);
      recordError("mttrSnapshot", e);
    }
    autoCompactIfDue();
    try {
      warmReadModels();
    } catch (e) {
      console.warn(`Cache warming after scan failed: ${e}`);
      recordError("cacheWarm", e);
    }
  }
  function autoCompactIfDue() {
    try {
      if (!getAutoCompact2()) return;
      const days = getRetentionDays2();
      if (days === null) return;
      compactLedger(days);
    } catch (e) {
      console.warn(`Auto-compaction failed: ${e}`);
      recordError("autoCompact", e);
    }
  }
  function refreshSupportGroupsAfterScan() {
    if (!hasWizCredentials()) return;
    try {
      refreshSupportGroups();
    } catch (e) {
      console.warn(`Support-group refresh after scan failed: ${e}`);
      recordError("supportGroupRefresh", e);
    }
  }
  function scheduleContinuation3(delayMs = CONTINUE_DELAY_MS3) {
    ScriptApp.newTrigger(CONTINUE_HANDLER3).timeBased().after(delayMs).create();
  }
  function clearContinuationTriggers3() {
    for (const t of ScriptApp.getProjectTriggers()) {
      if (t.getHandlerFunction() === CONTINUE_HANDLER3) ScriptApp.deleteTrigger(t);
    }
  }
  function continueJob(_e) {
    try {
      withScriptLock(() => {
        var _a, _b;
        clearContinuationTriggers3();
        const job = activeJob();
        if (!job || job.kind !== "scan") return;
        if (job.phase === "FETCHING") {
          if (isCancelRequested(job.job_id)) {
            finalizeCancel(job);
            return;
          }
          step3(job);
        } else if (job.phase === "RECONCILING") {
          const params = JSON.parse((_a = job.params_json) != null ? _a : "{}");
          const slim = (_b = readSlimRecords(job.scan_id)) != null ? _b : [];
          finishScan(job.job_id, job.scan_id, params, slim);
        } else if (job.phase === "PERSISTING" || job.phase === "REPLAYING") {
          recoverIfNeeded();
          clearCancel(job.job_id);
        }
      }, 12e4);
    } catch (e) {
      if (e instanceof LedgerBusyError) scheduleContinuation3(CONTINUE_RETRY_MS);
      throw e;
    }
  }
  function dailyScan() {
    if (!hasWizCredentials()) return;
    startScan({ incremental: false });
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
  function run(fn, label = "api") {
    try {
      return { ok: true, data: fn() };
    } catch (e) {
      const kind = e instanceof SealedScanError ? "sealed" : e instanceof LedgerRebuildError ? "rebuild" : e instanceof LedgerBusyError ? "busy" : "error";
      if (kind !== "busy") recordError(label, e, kind);
      return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: kind };
    }
  }
  function mutate(fn, label = "api") {
    return run(
      () => withScriptLock(() => {
        recoverIfNeeded();
        return fn();
      }),
      label
    );
  }
  function bootstrap(_p) {
    return run(() => ({
      // The core is a pure function of ledger + settings state — cached per DATA_VERSION.
      // "bootstrapCore" → "bootstrapCore2": counts / unassigned / filterOptions now honor the
      // show-no-fix toggle and settings gained `showNoFix`; params null → {showNoFix} so the
      // on/off states cache separately and no stale old-shape entry survives the deploy.
      // "bootstrapCore2" → "bootstrapCore3": the payload gained `scopeCounts`, which the header's
      // scope switcher reads for its denominator. A cached old-shape entry has none, and the
      // caption would render "undefined of undefined" until the next data version.
      // "bootstrapCore3" → "bootstrapCore4": it gained the business-domain catalogue and its
      // counts, for the switcher's third group, and WIZ_DOMAIN_TAG_KEY joined the params.
      // "bootstrapCore4" → "bootstrapCore5": `domainNames` is now the RESOLVED universe (tag
      // values first) and `scopeCounts` gained `baseRows` / `notAttributable`. A cached
      // old-shape entry would offer only the manual groups in the switcher — the one thing this
      // change exists to fix — and print an undefined second figure in its caption.
      //
      // WIZ_DOMAIN_TAG_KEY HAS LEFT THESE PARAMS, and is not missing: it moved into the GLOBAL
      // cache stamp (`serverCache.domainTagStamp`). It belonged there all along — it changes
      // which tag every row is read from, which now moves the domain split on every cached
      // payload in the app, not just this one — and carrying it here as well would only hash a
      // value the key already carries.
      // "bootstrapCore5" → "bootstrapCore6": the payload SHED its unread fields — `prevCounts`
      // (which cost a Drive fetch, ungzip and parse of the previous scan's entire observation
      // set for six integers nothing rendered), the `statuses`/`assetTypes`/`clouds` filter
      // vocabularies (three O(N) passes over the frame, no reader), `scopeCounts.noBizDomain`
      // (whose own comment admitted as much), `palette.glyphs`/`slaTargets`, and
      // `latestScan.shape`/`severities`. Bump so no stale fat entry survives the persistent
      // dataVersion; a reader that wanted any of them would have been broken already.
      // "bootstrapCore6" → "bootstrapCore7": the payload gained `openCounts`. A cached
      // old-shape entry has none, and the Executive severity tiles read it directly, so they
      // would render "0" across the board until the next data version.
      ...durablyCached("bootstrapCore7", { showNoFix: getShowNoFix2() }, bootstrapCore),
      // Live per-request fields: never cached (activeJob changes every poll tick).
      hasCredentials: hasWizCredentials(),
      activeJob: activeJobSummary()
    }));
  }
  function bootstrapCore() {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const scan = currentScan();
    const latest = latestScanRow();
    const showNoFix = getShowNoFix2();
    const records = scan ? visibleFrame(scan.records) : [];
    const counts = {};
    const openCounts = {};
    let unassignedCount = 0;
    const domainCounts = {};
    const supportGroupCounts = {};
    const seenTags = /* @__PURE__ */ new Set();
    let noSupportGroup = 0;
    let noBizDomain = 0;
    for (const r of records) {
      const sev2 = String(r["_sev"]);
      counts[sev2] = ((_a = counts[sev2]) != null ? _a : 0) + 1;
      if (isOpenStatus(r["status"])) {
        openCounts[sev2] = ((_b = openCounts[sev2]) != null ? _b : 0) + 1;
      }
      const dom = String((_c = r["_domain"]) != null ? _c : "");
      if (dom) domainCounts[dom] = ((_d = domainCounts[dom]) != null ? _d : 0) + 1;
      if (dom === UNASSIGNED) unassignedCount += 1;
      const sg = String((_e = r["_supportGroup"]) != null ? _e : "");
      if (sg) supportGroupCounts[sg] = ((_f = supportGroupCounts[sg]) != null ? _f : 0) + 1;
      else noSupportGroup += 1;
      const bd = String((_g = r["_bizDomain"]) != null ? _g : "");
      if (bd) seenTags.add(bd);
      else noBizDomain += 1;
    }
    const domainItems = getDomains2().items;
    const compiled = compileDomains(domainItems);
    const baseRows2 = loadBaseRows();
    attachBizDomains(baseRows2);
    let notAttributable = 0;
    for (const r of baseRows2) {
      const bd = String((_h = r["_bizDomain"]) != null ? _h : "");
      if (bd) {
        seenTags.add(bd);
        continue;
      }
      if (!hasDomainInputs(r)) notAttributable += 1;
    }
    return {
      // The deployed code stamp (esbuild-injected source hash; "dev" locally). Surfaced so an
      // operator can confirm at a glance whether a `clasp push` actually took — the recurring "I
      // deployed the fix but still see the old behaviour" confusion.
      buildId: BUILD_ID,
      palette: {
        order: SEVERITY_ORDER,
        colors: SEVERITY_COLORS,
        selectable: SELECTABLE_SEVERITIES
      },
      settings: {
        fetchSeverities: getFetchSeverities2(),
        displaySeverities: getDisplaySeverities2(),
        retentionDays: getRetentionDays2(),
        autoCompact: getAutoCompact2(),
        showNoFix,
        includeEol: getIncludeEol2(),
        domains: getDomains2(),
        riskRule: getRiskRule2()
      },
      latestScan: latest ? {
        scanId: latest.scan_id,
        ts: latest.ts,
        mode: latest.mode,
        total: latest.total
      } : null,
      counts,
      // Open-only severity tally over the same frame. `counts` stays register-wide because the
      // scope switcher's denominators are; anything answering "how much is live risk" reads this.
      openCounts,
      unassignedCount,
      // THE RESOLVED UNIVERSE, not the rule list. A tag value is a domain a finding can actually
      // land in, so a switcher built from `domainNames(items)` alone would offer only the manual
      // groups and leave every tag-attributed bucket unreachable — the exact failure the tag-first
      // model exists to fix. Order comes from `resolvedDomainNames`: tag values, then rules in
      // priority order, then Unassigned, then Not attributable.
      domainNames: resolvedDomainNames(seenTags, domainNames(domainItems)),
      // The scope switcher's arithmetic, kept apart from `filterOptions.supportGroups` and
      // `domainNames` so the readers that already take those as bare name lists (the domains
      // editor, the switcher's own option builders) keep their shape. `register` is the
      // denominator every caption carries: "1,204" alone cannot tell a small manual group from a
      // small register, and those call for opposite reactions.
      scopeCounts: {
        register: records.length,
        domains: domainCounts,
        supportGroups: supportGroupCounts,
        unassigned: unassignedCount,
        noSupportGroup,
        // Both over base rows, and paired on purpose: "412 not attributable" is unreadable
        // without the population it is 412 of, and that population is not `register`.
        baseRows: baseRows2.length,
        notAttributable
      },
      // Which tag the business domain was read off. Surfaced because the figure beside it is
      // meaningless without it: "82 carry no domain" is a fact about `Wiz/Domain` specifically,
      // and an operator who mistyped WIZ_DOMAIN_TAG_KEY would otherwise read a tenant-wide
      // tagging failure off their own typo.
      domainTagKey: configuredDomainTagKey(),
      filterOptions: scan ? {
        subscriptions: distinct(records, "vulnerableAsset.subscriptionName"),
        supportGroups: distinct(records, "_supportGroup")
      } : {
        statuses: [],
        assetTypes: [],
        clouds: [],
        subscriptions: [],
        supportGroups: []
      }
    };
  }
  function jobSummary(job) {
    if (!job) return null;
    return jobSummarySlice(job, !isTerminalPhase(job.phase) && isStaleJob(job));
  }
  function activeJobSummary() {
    return jobSummary(activeJob());
  }
  function readStringArray(p, key) {
    const raw = p == null ? void 0 : p[key];
    return Array.isArray(raw) ? raw.map(String) : [];
  }
  function supportGroupPredicate(single, set) {
    const keep = set.length ? new Set(set) : null;
    return (v) => (!single || v === single) && (!keep || keep.has(v));
  }
  function sevCountsOf(rows) {
    var _a;
    const out = {};
    for (const r of rows) {
      const sev2 = String(r["_sev"]);
      out[sev2] = ((_a = out[sev2]) != null ? _a : 0) + 1;
    }
    return out;
  }
  function insightsData(p) {
    var _a, _b;
    const scan = currentScan();
    if (!scan) return { flatScan: false };
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    const sgActive = Boolean(supportGroup) || supportGroupSet.length > 0;
    const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
    let recs = scan.records;
    let base = loadBaseRows();
    attachSupportGroups(base);
    attachBizDomains(base);
    const compiled = compileDomains(getDomains2().items);
    for (const r of base) r["_domain"] = resolveDomainName(r, compiled);
    if (domain || sgActive) {
      if (sgActive) {
        recs = recs.filter((r) => {
          var _a2;
          return sgMatch(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
        });
        base = base.filter((r) => {
          var _a2;
          return sgMatch(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
        });
      }
      if (domain) {
        recs = recs.filter((r) => {
          var _a2;
          return String((_a2 = r["_domain"]) != null ? _a2 : UNASSIGNED) === domain;
        });
        base = base.filter((r) => {
          var _a2;
          return String((_a2 = r["_domain"]) != null ? _a2 : UNASSIGNED) === domain;
        });
      }
    }
    const severities = readSeverities(p);
    recs = filterSeverities(recs, severities);
    base = filterSeverities(base, severities);
    const includeEol = getIncludeEol2();
    recs = filterEolFrame(recs, includeEol);
    base = filterEolBase(base, includeEol);
    const showNoFix = getShowNoFix2();
    const recsVisible = filterNoFixFrame(recs, showNoFix);
    const baseVisible = filterNoFixBase(base, showNoFix);
    const latestFlat = latestFlatScanRow();
    const exploitSummaryScoped = exploitSummary(recsVisible);
    return {
      flatScan: true,
      domain,
      supportGroup,
      scan: { scanId: scan.scanId, ts: scan.ts, total: scan.total },
      // Domain-scoped severity counts + total so the Overview headline can stay
      // coherent under a filter (the KPI band otherwise reads whole-scan bootstrap
      // counts). Movement's new/resolved/reopened remain chain-wide — see below.
      counts: sevCountsOf(recsVisible),
      total: recsVisible.length,
      // Per-severity total/open/resolved for the severity breakdown card.
      sevStats: severityStats(recsVisible),
      // Open findings per severity over time — powers the breakdown line chart. Uses the
      // UNFILTERED base + severities and the as-of no-fix exclusion, so the series matches the
      // counts shown beside it while letting a fixed-later finding re-enter at the right date.
      openTrend: openBySeverityTrend(
        loadScanRows(),
        base,
        severities,
        { hideNoFix: !showNoFix }
      ),
      exploit: exploitSummaryScoped,
      // --------------------------------------------------------------- the risk ladder
      // Severity is a constant in a single-severity register, so exploitability is this
      // page's spine instead. The classifier is program.riskTier — a REFINEMENT of the
      // Program page's classifyRisk, never a second opinion, so the two pages can never
      // print different unclassified counts for one fleet (pinned in test/program.test.ts).
      ...riskLadder(
        recsVisible,
        baseVisible,
        base,
        severities,
        showNoFix,
        exploitSummaryScoped
      ),
      // Open findings awaiting a vendor fix (no patch available yet) over the same scoped base
      // rows — sourced here so the Overview can explain the post-rollout open-count step-up.
      // (Naturally zero when the toggle hides them, so the client drops the surface entirely.)
      awaiting: awaitingVendorFix(baseVisible),
      aging: ageBuckets(baseVisible),
      // Oldest open findings + 90+ backlog per asset / support group / domain, for the aging
      // panel's toggle. Capped at 100 (up from the old top-7) so the client can page through the
      // aged tail with prev/next controls — the whole set ships once and repaints client-side,
      // no per-page RPC. The panel triages the oldest backlog, so 100 rows is ample depth.
      oldest: oldestOpen(
        baseVisible,
        100
      ),
      // Movement's Persisting is filtered (it's derived from these base rows); New/Resolved/
      // Reopened come from scan-wide reconcile deltas and stay scan-wide (see movement()).
      movement: movement(baseVisible, latestFlat, loadScanRows().length)
    };
  }
  function riskLadder(recsVisible, baseVisible, base, severities, showNoFix, exposure) {
    var _a;
    const rule = getRiskRule2().rule;
    const tierOf = (r) => riskTier(r, rule);
    const exposedKeys = /* @__PURE__ */ new Set();
    if (exposure.exposureKnown) {
      for (const r of recsVisible) {
        if (r["vulnerableAsset.hasWideInternetExposure"] === true || r["vulnerableAsset.hasLimitedInternetExposure"] === true) {
          const k = String((_a = r["_vuln_key"]) != null ? _a : "");
          if (k) exposedKeys.add(k);
        }
      }
    }
    const agingTier = ageBucketsBy(
      baseVisible,
      tierOf
    );
    return {
      riskRule: { rule, sentence: ruleSentence(rule) },
      tiers: riskTierStats(baseVisible, rule),
      funnel: triageFunnel(
        baseVisible,
        rule,
        exposedKeys,
        exposure.exposureKnown
      ),
      tierTrend: openByGroupTrend(
        loadScanRows(),
        base,
        tierOf,
        RISK_TIER_ORDER,
        { severities, hideNoFix: !showNoFix, includeOther: false }
      ),
      agingTier: { perTier: agingTier.perKey, totalOpen: agingTier.totalOpen },
      concentration: concentration(recsVisible, ["asset", "cve", "supportGroup", "os"], 5),
      pastSla: openPastSla(actionableView(baseVisible)),
      medianOpenAge: openAgeMedian(baseVisible)
    };
  }
  var cachedInsightsData = (p) => {
    var _a, _b;
    return cached(
      // "insights" → "insights2": the payload now honors the show-no-fix toggle (counts,
      // total, sevStats, exploit, aging, oldest, awaiting, movement, and the as-of openTrend
      // all reflect it); key gains showNoFix so on/off states don't share an entry.
      // "insights2" → "insights3": `oldest.*` now carries up to 100 rows (was 7) for the aging
      // panel's prev/next pagination; bump so stale 7-row entries can't survive the deploy.
      // "insights3" → "insights4": the risk-ladder block (tiers, funnel, tierTrend, agingTier,
      // concentration, pastSla, medianOpenAge). A stale insights3 entry has none of those
      // fields, and the rebuilt page reads them unconditionally, so it must not be served.
      // The key gains riskRuleVersion for the same reason it does on the Program page: the
      // operator can change which signals classify a row, and every tier figure moves with it.
      "insights4",
      {
        domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
        supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
        supportGroups: readStringArray(p, "supportGroups"),
        severities: readSeverities(p),
        showNoFix: getShowNoFix2(),
        riskRuleVersion: getRiskRule2().version
      },
      () => insightsData(p),
      3600
    );
  };
  function getInsights(p) {
    return run(() => overviewInsightsSlice(cachedInsightsData(p)));
  }
  function getOldestOpen(p) {
    return run(() => {
      var _a;
      return oldestOpenSlice(cachedInsightsData(p), String((_a = p == null ? void 0 : p["view"]) != null ? _a : ""));
    });
  }
  function scopedFrameRecords(domain, supportGroup, supportGroupSet) {
    const scan = currentScan();
    if (!scan) return [];
    let recs = scan.records;
    if (supportGroup || supportGroupSet.length) {
      const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
      recs = recs.filter((r) => {
        var _a;
        return sgMatch(String((_a = r["_supportGroup"]) != null ? _a : ""));
      });
    }
    if (domain) recs = recs.filter((r) => {
      var _a;
      return String((_a = r["_domain"]) != null ? _a : UNASSIGNED) === domain;
    });
    return visibleFrame(recs);
  }
  function groupingData(p) {
    var _a, _b;
    const scan = currentScan();
    if (!scan) return { flatScan: false, keys: [], groups: [] };
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    const raw = p == null ? void 0 : p["keys"];
    const keys = (Array.isArray(raw) ? raw.map(String) : []).filter((k) => k in GROUP_COLUMNS);
    return {
      flatScan: true,
      keys,
      groups: groupTree(
        filterSeverities(
          scopedFrameRecords(domain, supportGroup, supportGroupSet),
          readSeverities(p)
        ),
        keys
      )
    };
  }
  var cachedGroupingData = (p) => {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    const raw = p == null ? void 0 : p["keys"];
    const keys = Array.isArray(raw) ? raw.map(String) : [];
    return cached(
      "grouping2",
      {
        domain,
        supportGroup,
        supportGroups: supportGroupSet,
        keys,
        severities: readSeverities(p),
        showNoFix: getShowNoFix2()
      },
      () => groupingData(p),
      3600
    );
  };
  function getGrouping(p) {
    return run(() => cachedGroupingData(p));
  }
  function groupTrendData(p) {
    var _a, _b, _c;
    const key = String((_a = p == null ? void 0 : p["key"]) != null ? _a : "");
    const groups = readStringArray(p, "groups");
    const field2 = GROUP_BASE_FIELDS[key];
    const scan = currentScan();
    if (!field2 || !scan) return { supported: false, key, groups: [], points: [] };
    const domain = String((_b = p == null ? void 0 : p["domain"]) != null ? _b : "");
    const supportGroup = String((_c = p == null ? void 0 : p["supportGroup"]) != null ? _c : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    const sgActive = Boolean(supportGroup) || supportGroupSet.length > 0;
    const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
    let base = loadBaseRows();
    attachSupportGroups(base);
    attachBizDomains(base);
    const compiled = compileDomains(getDomains2().items);
    for (const r of base) r["_domain"] = resolveDomainName(r, compiled);
    if (sgActive) base = base.filter((r) => {
      var _a2;
      return sgMatch(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
    });
    if (domain) base = base.filter((r) => {
      var _a2;
      return String((_a2 = r["_domain"]) != null ? _a2 : UNASSIGNED) === domain;
    });
    const points = openByGroupTrend(
      loadScanRows(),
      base,
      (r) => {
        var _a2;
        return String((_a2 = r[field2]) != null ? _a2 : "");
      },
      groups,
      { severities: readSeverities(p), hideNoFix: !getShowNoFix2() }
    );
    return { supported: true, key, groups, points };
  }
  function getGroupTrend(p) {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    return run(
      () => {
        var _a2;
        return (
          // "groupTrend" → "groupTrend2": the open-by-group series now excludes no-fix findings
          // as-of-date when the toggle is off; key gains showNoFix so on/off states cache apart.
          cached(
            "groupTrend2",
            {
              domain,
              supportGroup,
              supportGroups: supportGroupSet,
              key: String((_a2 = p == null ? void 0 : p["key"]) != null ? _a2 : ""),
              groups: readStringArray(p, "groups"),
              severities: readSeverities(p),
              showNoFix: getShowNoFix2()
            },
            () => groupTrendData(p),
            3600
          )
        );
      }
    );
  }
  function attributionData(p) {
    var _a;
    const scan = currentScan();
    if (!scan) return { flatScan: false };
    const recs = visibleFrame(filterSeverities(scan.records, readSeverities(p)));
    const dom = getDomains2();
    const compiled = compileDomains(dom.items);
    const sgMap = getSupportGroupMap2();
    const sgKeys = Object.keys(sgMap.map);
    const sgMapGroups = new Set(Object.values(sgMap.map)).size;
    const seenTags = /* @__PURE__ */ new Set();
    for (const r of recs) {
      const t = String((_a = r["_bizDomain"]) != null ? _a : "");
      if (t) seenTags.add(t);
    }
    return {
      flatScan: true,
      scan: { scanId: scan.scanId, ts: scan.ts },
      coverage: coverage(recs, resolvedDomainNames(seenTags, domainNames(dom.items))),
      ruleHealth: ruleHealth(recs, compiled),
      unassignedAll: unassignedResources(recs, compiled),
      // Findings split by resolved support group — the support-group coverage table + the
      // resolved/unresolved headline the page needs to troubleshoot the join.
      supportGroups: supportGroupBreakdown(recs),
      untagged: untaggedSubscriptions(recs).slice(0, 200),
      supportGroupMap: {
        configured: sgKeys.length > 0,
        keys: sgKeys.length,
        groups: sgMapGroups,
        tagKey: configuredTagKey(),
        // A sample of the identity tokens the map is actually indexed under (folded, as the
        // join compares them) — the concrete map side of the join, to eyeball against the
        // subscription id / ext id / name the findings carry when nothing resolves.
        sampleKeys: sgKeys.slice(0, 12)
      }
    };
  }
  var cachedAttributionData = (p) => (
    // "attribution" → "attribution2": coverage / rule-health / unassigned now honor the
    // show-no-fix toggle; key gains showNoFix so on/off states cache apart.
    // "attribution2" → "attribution3": payload gained the support-group breakdown
    // (`supportGroups`) and richer `supportGroupMap` (groups + tagKey); bump so a stale
    // old-shape entry can't survive the persistent dataVersion.
    // "attribution3" → "attribution4": `supportGroupMap` gained `sampleKeys` (indexed
    // subscription identities); bump so a stale sampleKeys-less entry can't survive.
    // "attribution4" → "attribution5": `coverage` gained `bySource` and the domain is now
    // resolved tag-first, so both the per-domain rows and the KPIs mean something different. An
    // old-shape entry would render the by-source strip as four blanks and split by rules only.
    durablyCached(
      "attribution5",
      { severities: readSeverities(p), showNoFix: getShowNoFix2() },
      () => attributionData(p)
    )
  );
  function getAttribution(p) {
    return run(() => {
      var _a, _b;
      const data = cachedAttributionData(p);
      if (!data["flatScan"]) return data;
      const { unassignedAll, ...rest } = data;
      const params = p != null ? p : {};
      const pageSize = Math.min(Math.max(Number((_a = params["pageSize"]) != null ? _a : 50), 1), 200);
      const pageCount = Math.max(1, Math.ceil(unassignedAll.length / pageSize));
      const page = Math.min(Math.max(Number((_b = params["page"]) != null ? _b : 0), 0), pageCount - 1);
      return {
        ...rest,
        unassigned: {
          rows: unassignedAll.slice(page * pageSize, (page + 1) * pageSize),
          total: unassignedAll.length,
          page,
          pageCount
        }
      };
    });
  }
  function readSeverities(p) {
    const raw = p == null ? void 0 : p["severities"];
    return Array.isArray(raw) ? raw.map(String) : null;
  }
  function filterSeverities(rows, severities) {
    if (severities === null || !rows.length) return rows;
    const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
    return rows.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  function filterNoFixBase(rows, showNoFix) {
    if (showNoFix || !rows.length) return rows;
    return rows.filter((r) => !baseRowNoFix(r));
  }
  function filterNoFixFrame(records, showNoFix) {
    if (showNoFix || !records.length) return records;
    return records.filter((r) => !recordNoFix(r));
  }
  function eolVulnKeys() {
    const keys = cached("eolKeys", {}, () => {
      const scan = currentScan();
      if (!scan) return [];
      const out = [];
      for (const r of scan.records) {
        if (recordEol(r)) out.push(vulnKey(r));
      }
      return out;
    });
    return new Set(keys);
  }
  function filterEolBase(rows, includeEol) {
    if (includeEol || !rows.length) return rows;
    const keys = eolVulnKeys();
    return rows.filter(
      (r) => {
        var _a;
        return !(keys.has(String((_a = r["vuln_key"]) != null ? _a : "")) || isEndOfLifeName(r["cve"]));
      }
    );
  }
  function filterEolFrame(records, includeEol) {
    if (includeEol || !records.length) return records;
    return records.filter((r) => !recordEol(r));
  }
  function visibleFrame(records) {
    return filterEolFrame(
      filterNoFixFrame(records, getShowNoFix2()),
      getIncludeEol2()
    );
  }
  function visibleBase(rows) {
    return filterEolBase(
      filterNoFixBase(rows, getShowNoFix2()),
      getIncludeEol2()
    );
  }
  function scopedBaseRows(domain, supportGroup) {
    let rows = loadBaseRows();
    if (domain || supportGroup) {
      attachSupportGroups(rows);
      if (supportGroup) rows = rows.filter((r) => {
        var _a;
        return String((_a = r["_supportGroup"]) != null ? _a : "") === supportGroup;
      });
      if (domain) {
        const compiled = compileDomains(getDomains2().items);
        attachBizDomains(rows);
        rows = rows.filter((r) => resolveDomainName(r, compiled) === domain);
      }
    }
    return rows;
  }
  function mttrData(p) {
    var _a, _b, _c;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    let rows = scopedBaseRows(domain, supportGroup);
    rows = filterSeverities(rows, readSeverities(p));
    rows = visibleBase(rows);
    const { perSev, overall } = mttrFromLedger(rows);
    const { slaPct, oldestDays } = overallSlaOldest(perSev);
    const remRows = rows;
    const kmMedianPerSev = {};
    const kmP90PerSev = {};
    {
      const bySev = {};
      for (const r of remRows) {
        const s = normalizeSeverity(r["severity"]);
        ((_c = bySev[s]) != null ? _c : bySev[s] = []).push(r);
      }
      for (const [s, rs] of Object.entries(bySev)) {
        const k = kaplanMeier(rs);
        kmMedianPerSev[s] = k.median;
        kmP90PerSev[s] = kmQuantileFromCurve(k.curve, 0.9);
      }
    }
    const kmFull = kaplanMeier(remRows);
    const km = { ...kmFull, curve: kmFull.curve.map((p2) => ({ t: p2.t, s: p2.s })) };
    const remediation = {
      pctiles: mttrPercentiles(remRows),
      buckets: resolutionBuckets(remRows),
      km,
      // Overall censoring-aware KM p90 off that same curve (smallest t with S(t) ≤ 0.10) — the
      // slow-tail sibling of the KM median that replaces the naive `pctiles.overall.p90` in the
      // KPI band. Null (renders "—") when too much is still open to observe it.
      kmP90: kmQuantileFromCurve(kmFull.curve, 0.9),
      kmMedianPerSev,
      kmP90PerSev,
      openPastSla: openPastSla(remRows),
      // Actionable-clock companion (clock starts at vendor-fix availability): the same function
      // over the actionableView projection. Awaiting-vendor-fix rows carry null actionable
      // fields, so they drop out of it while staying in `awaiting`.
      //
      // ITS KM ESTIMATE USED TO SIT BESIDE IT and had no reader anywhere — a second complete
      // `KMResult`, curve included, built by a second `kaplanMeier` over a second
      // `actionableView` pass, serialized on every MTTR and Executive load. The actionable
      // CLOCK is read (`mttr.js` draws `openPastSlaActionable` in the KPI band and the
      // per-severity table); only its survival estimate never was. Removing it is compute as
      // well as transfer.
      openPastSlaActionable: openPastSla(actionableView(remRows)),
      awaiting: awaitingVendorFix(remRows)
    };
    return { perSev, overall, slaPct, oldestDays, rowCount: rows.length, remediation };
  }
  function programData(p) {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const rule = getRiskRule2().rule;
    let rows = scopedBaseRows(domain, supportGroup);
    rows = filterSeverities(rows, readSeverities(p));
    rows = visibleBase(rows);
    const riskRows = rows;
    const { perSev, overall } = confusionBySeverity(riskRows, rule);
    const capacityRows = rows;
    const scans = loadScanRows();
    return {
      rule,
      ruleSentence: ruleSentence(rule),
      matrix: overall,
      perSev,
      signals: signalBreakdown(riskRows, rule),
      sensitivity: ruleSensitivity(riskRows, rule),
      // Whole-register capacity and the high-risk-only cut: P2P v3's net remediation capacity
      // is specifically about the high-risk population, but the overall close rate is the
      // figure the 1-in-10 benchmark refers to, so the page shows both.
      capacity: capacityByMonth(capacityRows, scans, { rule, maxMonths: 24 }),
      capacityHighRisk: capacityByMonth(capacityRows, scans, {
        rule,
        highRiskOnly: true,
        maxMonths: 24
      }),
      observationDays: observationWindowDays(rows),
      rowCount: rows.length,
      // Named so the methodology block can state what was excluded before any of this counted.
      toggles: {
        showNoFix: getShowNoFix2(),
        includeEol: getIncludeEol2()
      }
    };
  }
  function programTrendData(p) {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const rule = getRiskRule2().rule;
    const rows = visibleBase(
      filterSeverities(scopedBaseRows(domain, supportGroup), readSeverities(p))
    );
    return { trend: loadProgramTrend(rule, readSeverities(p), rows) };
  }
  function mttrTrendData(p) {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const severities = readSeverities(p);
    const scoped = Boolean(domain || supportGroup);
    const includeEol = getIncludeEol2();
    const rows = filterEolBase(
      scopedBaseRows(domain, supportGroup),
      includeEol
    );
    return {
      history: scoped || !includeEol ? [] : loadHistory(),
      // showNoFix off → the open / KM-median series exclude no-fix findings as-of-date; the
      // resolved / median / SLA-burn / attainment series are untouched (see loadTrend).
      trend: loadTrend(severities, getShowNoFix2(), rows)
    };
  }
  var NONE_SUPPORT_GROUP = "(none)";
  function remediationGroups(rows, keyField, orderedNames, scanRows) {
    var _a, _b, _c, _d;
    const buckets = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const name = String((_a = r[keyField]) != null ? _a : "");
      let arr = buckets.get(name);
      if (!arr) buckets.set(name, arr = []);
      arr.push(r);
    }
    const out = [];
    for (const name of orderedNames) {
      const drows = buckets.get(name);
      if (!drows || !drows.length) continue;
      const { perSev, overall } = mttrFromLedger(drows);
      const { slaPct } = overallSlaOldest(perSev);
      const rem = drows;
      const km = kaplanMeier(rem);
      out.push({
        group: name,
        median: (_b = overall.mttr_median) != null ? _b : null,
        // Censoring-aware KM p90 (open findings right-censored), the slow-tail sibling of the KM
        // median below — read off the same survival curve (smallest t with S(t) ≤ 0.10) so the
        // tail isn't biased low by the fast-patched vulns that close first, the way a closed-only
        // percentile would be. Null (renders "—") when too much is still open to observe it.
        p90: kmQuantileFromCurve(km.curve, 0.9),
        // Censoring-aware KM median (open findings right-censored) — the column that replaces
        // the old "Excl. fast lane" tail median.
        kmMedian: km.median,
        slaPct,
        // Actionable-clock open-past-SLA (measured from vendor-fix availability, awaiting
        // rows excluded) — the same basis the hero and severity table now use.
        openPastSla: openPastSla(actionableView(rem)).overall,
        // Open findings in this bucket still awaiting a vendor fix — surfaced as a footnote
        // under the table, not a column.
        awaiting: awaitingVendorFix(rem).overall,
        open: (_c = overall.open) != null ? _c : 0,
        resolved: (_d = overall.resolved) != null ? _d : 0
      });
    }
    const groups = out.filter((r) => r["resolved"] > 0).sort((a, b) => b["resolved"] - a["resolved"]).slice(0, 5).map((r) => String(r["group"]));
    const keyOf = (r) => {
      var _a2;
      return String((_a2 = r[keyField]) != null ? _a2 : "");
    };
    const points = medianMttrByGroupTrend(scanRows, rows, keyOf, groups, { severities: null });
    const kmPoints = kmMedianByGroupTrend(scanRows, rows, keyOf, groups, { severities: null });
    return { rows: out, trend: { groups, points, kmPoints } };
  }
  function mttrByDomainData(p) {
    var _a, _b;
    const supportGroup = String((_a = p == null ? void 0 : p["supportGroup"]) != null ? _a : "");
    let rows = filterSeverities(
      loadBaseRows(),
      readSeverities(p)
    );
    rows = visibleBase(rows);
    attachSupportGroups(rows);
    if (supportGroup) rows = rows.filter((r) => {
      var _a2;
      return String((_a2 = r["_supportGroup"]) != null ? _a2 : "") === supportGroup;
    });
    attachBizDomains(rows);
    const items = getDomains2().items;
    const compiled = compileDomains(items);
    const seenTags = /* @__PURE__ */ new Set();
    for (const r of rows) {
      r["_domain"] = resolveDomainName(r, compiled);
      const tag = String((_b = r["_bizDomain"]) != null ? _b : "");
      if (tag) seenTags.add(tag);
    }
    const scanRows = loadScanRows();
    const { rows: out, trend } = remediationGroups(
      rows,
      "_domain",
      resolvedDomainNames(seenTags, domainNames(items)),
      scanRows
    );
    for (const r of out) r["domain"] = r["group"];
    return { dimension: "domain", rows: out, trend };
  }
  function mttrBySupportGroupData(p) {
    var _a, _b, _c, _d;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    let rows = filterSeverities(
      loadBaseRows(),
      readSeverities(p)
    );
    rows = visibleBase(rows);
    attachSupportGroups(rows);
    const compiled = compileDomains(getDomains2().items);
    if (domain) {
      attachBizDomains(rows);
      rows = rows.filter((r) => resolveDomainName(r, compiled) === domain);
    }
    if (supportGroup) rows = rows.filter((r) => {
      var _a2;
      return String((_a2 = r["_supportGroup"]) != null ? _a2 : "") === supportGroup;
    });
    for (const r of rows) r["_supportGroup"] = String((_c = r["_supportGroup"]) != null ? _c : "") || NONE_SUPPORT_GROUP;
    const sizes = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const g = String(r["_supportGroup"]);
      sizes.set(g, ((_d = sizes.get(g)) != null ? _d : 0) + 1);
    }
    const orderedNames = [...sizes.keys()].sort((a, b) => {
      var _a2, _b2;
      if (a === NONE_SUPPORT_GROUP) return 1;
      if (b === NONE_SUPPORT_GROUP) return -1;
      return ((_a2 = sizes.get(b)) != null ? _a2 : 0) - ((_b2 = sizes.get(a)) != null ? _b2 : 0);
    });
    const scanRows = loadScanRows();
    const { rows: out, trend } = remediationGroups(rows, "_supportGroup", orderedNames, scanRows);
    return { dimension: "supportGroup", rows: out, trend };
  }
  var cachedMttrData = (p) => {
    var _a, _b;
    return cached(
      // "mttr" → "mttr2": payload gained the `remediation` block; dataVersion persists across
      // deploys, so bumping the namespace prevents serving a stale old-shape entry (up to 1h).
      // "mttr2" → "mttr3": remediation gained the actionable-clock keys (kmMedianActionable,
      // openPastSlaActionable, awaiting); same reasoning — bump so no stale entry lacks them.
      // "mttr3" → "mttr4": fast-lane machinery removed; remediation now carries the full KM
      // estimate (km / kmActionable) and dropped fastLane / scalar kmMedian; bump so no stale
      // old-shape entry survives the persistent dataVersion.
      // "mttr4" → "mttr5": the remediation block now honors the show-no-fix toggle (awaiting
      // rows dropped when off); key gains showNoFix so on/off states don't share an entry.
      // "mttr5" → "mttr6": remediation gained `kmMedianPerSev` (per-severity KM median for the
      // per-severity table); bump so no stale entry lacks it.
      // "mttr7" → "mttr8": remediation DROPPED `kmActionable` (a full second KMResult with no
      // reader in the client) and `km.curve` points lost `atRisk`/`events` (the survival chart
      // plots only `t` and `s`). A stale entry is not merely fatter — it is a different shape —
      // so bump rather than let one survive the persistent dataVersion.
      // "mttr6" → "mttr7": remediation gained the censoring-aware KM p90 — `kmP90` (overall, for
      // the KPI band) and `kmP90PerSev` (per-severity table) — replacing the naive `pctiles` p90
      // at those call sites; bump so no stale entry lacks them.
      "mttr8",
      {
        domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
        supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
        severities: readSeverities(p),
        showNoFix: getShowNoFix2()
      },
      () => mttrData(p),
      3600
    );
  };
  var cachedMttrTrendData = (p) => {
    var _a, _b;
    return (
      // "mttrTrend" → "mttrTrend2": trend points gained `open_past_sla`; namespace bump avoids a
      // stale old-shape entry surviving the deploy under the persistent dataVersion.
      // "mttrTrend2" → "mttrTrend3": trend points gained the backlog-flow series (sla_net /
      // sla_entered / sla_cleared, sla_attainment_pct) and open_past_sla switched to the
      // actionable clock; bump so a stale old-shape entry can't survive the persistent dataVersion.
      // "mttrTrend3" → "mttrTrend4": the tail-median series (tail_median_days) became the KM-median
      // series (km_median_days) and the fast-lane window left the key; bump so no stale entry
      // survives.
      // "mttrTrend4" → "mttrTrend5": the open / KM-median series now exclude no-fix findings
      // as-of-date when the toggle is off; key gains showNoFix so on/off states cache apart.
      // "mttrTrend5" → "mttrTrend6": the reconstructed trend now scopes to the active domain /
      // Support group (was always whole-register); key gains domain + supportGroup so scopes cache
      // apart.
      durablyCached(
        "mttrTrend6",
        {
          domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
          supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
          severities: readSeverities(p),
          showNoFix: getShowNoFix2()
        },
        () => mttrTrendData(p)
      )
    );
  };
  var cachedProgramData = (p) => {
    var _a, _b;
    return cached(
      "program1",
      {
        domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
        supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
        severities: readSeverities(p),
        showNoFix: getShowNoFix2(),
        includeEol: getIncludeEol2(),
        riskRuleVersion: getRiskRule2().version
      },
      () => programData(p),
      3600
    );
  };
  var cachedProgramTrendData = (p) => {
    var _a, _b;
    return durablyCached(
      "programTrend1",
      {
        domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
        supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
        severities: readSeverities(p),
        showNoFix: getShowNoFix2(),
        includeEol: getIncludeEol2(),
        riskRuleVersion: getRiskRule2().version
      },
      () => programTrendData(p)
    );
  };
  var cachedMttrByDomainData = (p) => {
    var _a;
    return cached(
      // "mttrByDomain" → "mttrByDomain2": payload shape changed (added p90/tailMedian/
      // openPastSla, dropped tracked/oldestDays); dataVersion persists across deploys, so
      // bumping the namespace prevents serving a stale old-shape entry.
      // "mttrByDomain2" → "mttrByDomain3": payload gained `trend` (median-MTTR-by-domain
      // lines); same reasoning — bump the namespace so a stale trend-less entry can't survive.
      // "mttrByDomain3" → "mttrByDomain4": trend gained `tailPoints` (fast-lane-excluded
      // medians for the chart's Median / Excl. fast lane toggle).
      // "mttrByDomain4" → "mttrByDomain5": rows gained `tailResolved` (the toggle now also
      // drives the Remediation-share pie).
      // "mttrByDomain5" → "mttrByDomain6": rows gained `awaiting` and switched `openPastSla`
      // to the actionable-clock view; bump so a stale from-detection entry can't survive.
      // "mttrByDomain6" → "mttrByDomain7": fast-lane machinery removed — rows' `tailMedian` /
      // `tailResolved` became a single `kmMedian`, `trend` lost `tailPoints`, the payload
      // dropped `thresholdDays`, and the fast-lane window left the key; bump so no stale
      // old-shape entry survives.
      // "mttrByDomain7" → "mttrByDomain8": the per-domain split now honors the show-no-fix
      // toggle (awaiting rows dropped when off); key gains showNoFix so on/off states cache apart.
      // "mttrByDomain8" → "mttrByDomain9": `trend` gained the KM-median-by-domain series
      // (`kmPoints`) that the chart now defaults to; bump so a stale kmPoints-less entry can't
      // survive the persistent dataVersion.
      // "mttrByDomain9" → "mttrByDomain10": rows/trend now exclude rows with no domain inputs
      // (unattributable compacted/imported resolved history) and the payload gained `excluded`;
      // bump so no stale old-shape entry survives the persistent dataVersion.
      // "mttrByDomain10" → "mttrByDomain11": `p90` switched from the naive closed-only percentile
      // to the censoring-aware KM p90 (off the same survival curve as the KM median); same shape,
      // new value, so bump the namespace to retire stale naive-p90 entries.
      // "mttrByDomain11" → "mttrByDomain12": the colored-group cap dropped from 8 to 5 (matching the
      // new categorical palette), so `trend.groups`/`points`/`kmPoints` now carry fewer groups and a
      // larger pooled "Other"; bump so a stale 8-group entry can't survive the persistent dataVersion.
      // "mttrByDomain12" → "mttrByDomain13": rows gained a generic `group` label + the payload a
      // `dimension` tag (shared with the by-support-group split); bump so no stale entry lacks them.
      // "mttrByDomain13" → "mttrByDomain14": the domain is now RESOLVED tag-first, the
      // input-less rows are a `Not attributable` bucket instead of an exclusion, and the payload
      // dropped `excluded`. Every row's group label can change, so a stale entry is not merely
      // incomplete — it is a different split. Bump.
      //
      // The key still omits `bizDomain`, and that is now correct rather than a defect: it used to
      // be one, because `mttrByDomainData` filtered on a param the key never carried, so a scoped
      // payload could be served from another scope's entry. That dimension is gone. `domain` is
      // omitted for a different reason and it is NOT a repeat of that bug: both callers route a
      // domain scope to `cachedMttrBySupportGroupData` instead (getMttrPage, getExecutivePage), so
      // this entry is only ever reached with `domain === ""` and cannot be read at another. The
      // `supportGroup` it DOES read is in the key.
      "mttrByDomain14",
      {
        supportGroup: String((_a = p == null ? void 0 : p["supportGroup"]) != null ? _a : ""),
        severities: readSeverities(p),
        showNoFix: getShowNoFix2()
      },
      () => mttrByDomainData(p),
      3600
    );
  };
  var cachedMttrBySupportGroupData = (p) => {
    var _a, _b;
    return cached(
      // "mttrBySupportGroup1" → "mttrBySupportGroup2": the payload dropped its always-zero
      // `excluded` block and the `domain` scope now resolves tag-first, so the rows a domain
      // scope selects can differ. Bump so no stale entry survives the persistent dataVersion.
      "mttrBySupportGroup2",
      {
        domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
        supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
        severities: readSeverities(p),
        showNoFix: getShowNoFix2()
      },
      () => mttrBySupportGroupData(p),
      3600
    );
  };
  function getMttr(p) {
    return run(() => cachedMttrData(p));
  }
  function getMttrTrend(p) {
    return run(() => historyTrendSlice(cachedMttrTrendData(p)));
  }
  function getMttrPage(p) {
    var _a;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    return run(() => ({
      // THE SUMMARY IS NOT MISSING — it is the other RPC's job. `mttr.js` already fires
      // `api_getMttr` with identical params, and both endpoints resolve the SAME
      // `cachedMttrData` entry, so returning it here too shipped it twice per page load: 9,372
      // bytes on the seeded estate, two Kaplan-Meier curves included. On a cold cache it was
      // worse than duplicate transfer — the two RPCs are separate GAS executions, so both
      // computed it. The page composes the two payloads instead; see `mttrPaintPlan`.
      trends: mttrPageTrendSlice(cachedMttrTrendData(p)),
      byDomain: mttrGroupTableSlice(
        domain ? cachedMttrBySupportGroupData(p) : cachedMttrByDomainData(p)
      )
    }));
  }
  function getMttrByDomainTrend(p) {
    var _a;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    return run(() => mttrGroupTrendSlice(
      domain ? cachedMttrBySupportGroupData(p) : cachedMttrByDomainData(p)
    ));
  }
  function startRiskBackfill(_p) {
    return mutate(() => startBackfill());
  }
  function getRiskBackfillStatus(_p) {
    return run(() => ({ backfill: backfillStatus() }));
  }
  function getProgramPage(p) {
    return run(() => ({
      program: cachedProgramData(p),
      // Four fields of twelve: the coverage/efficiency pair the two lines are drawn from. The
      // rest is the shared `TrendPoint` base plus the high-risk decorator, none of it read here,
      // multiplied by a backbone that carries one point per day of pre-scan history.
      trends: programTrendSlice(cachedProgramTrendData(p))
    }));
  }
  function getRiskCohort(p) {
    return run(() => {
      var _a, _b, _c;
      const params = p != null ? p : {};
      const quadrant = String((_a = params["quadrant"]) != null ? _a : "");
      const rows = cachedRiskCohortRows(p, quadrant);
      const page = Math.max(0, Number((_b = params["page"]) != null ? _b : 0));
      const pageSize = Math.min(500, Math.max(1, Number((_c = params["pageSize"]) != null ? _c : 100)));
      const start = page * pageSize;
      return {
        quadrant,
        total: rows.length,
        page,
        pageCount: Math.ceil(rows.length / pageSize),
        rows: rows.slice(start, start + pageSize)
      };
    });
  }
  function getExportCoverageCsv(p) {
    return run(() => {
      var _a;
      const quadrant = String((_a = p == null ? void 0 : p["quadrant"]) != null ? _a : "");
      const rows = riskCohortRows(p, quadrant);
      const cols = [
        "vuln_key",
        "cve",
        "severity",
        "status",
        "first_seen",
        "resolved_at",
        "resolution_src",
        "has_kev",
        "has_exploit",
        "epss",
        "risk_observed_at",
        "risk_class",
        "fired_signals",
        "matrix_cell"
      ];
      const lines = [cols.join(",")];
      for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
      return {
        content: lines.join("\r\n"),
        filename: "wiz-coverage-" + (quadrant || "all") + "-" + nowIso().slice(0, 10) + ".csv",
        rows: rows.length
      };
    });
  }
  var cachedRiskCohortRows = (p, quadrant) => {
    var _a, _b;
    return cached(
      "riskCohort1",
      {
        domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
        supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
        severities: readSeverities(p),
        quadrant,
        showNoFix: getShowNoFix2(),
        riskRuleVersion: getRiskRule2().version
      },
      () => riskCohortRows(p, quadrant),
      3600
    );
  };
  function riskCohortRows(p, quadrant) {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const rule = getRiskRule2().rule;
    const rows = visibleBase(
      filterSeverities(scopedBaseRows(domain, supportGroup), readSeverities(p))
    );
    const out = [];
    for (const r of rows) {
      const riskRow = r;
      const cls = classifyRisk(riskRow, rule);
      const open = isOpenStatus(r["status"]);
      const cell = cls === "unknown" ? open ? "unknownOpen" : "unknownRemediated" : cls === "high" ? open ? "fn" : "tp" : open ? "tn" : "fp";
      if (quadrant && cell !== quadrant) continue;
      out.push({
        vuln_key: r["vuln_key"],
        cve: r["cve"],
        severity: r["severity"],
        status: r["status"],
        first_seen: r["first_seen"],
        resolved_at: r["resolved_at"],
        resolution_src: r["resolution_src"],
        asset_name: r["asset_name"],
        has_kev: r["has_kev"],
        has_exploit: r["has_exploit"],
        epss: r["epss"],
        risk_observed_at: r["risk_observed_at"],
        risk_class: cls,
        fired_signals: firedSignals(riskRow, rule).join(" "),
        matrix_cell: cell
      });
    }
    return out;
  }
  var WEEK_MS = 7 * 864e5;
  function executiveWeekTrend(p) {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const severities = readSeverities(p);
    const hideNoFix = !getShowNoFix2();
    const base = filterEolBase(scopedBaseRows(domain, supportGroup), getIncludeEol2());
    if (!base.length) return null;
    let earliest = Infinity;
    for (const r of base) {
      const f = parseTs(r["first_seen"]);
      if (f !== null && f < earliest) earliest = f;
    }
    const now = Date.now();
    const weekAgo = now - WEEK_MS;
    if (!Number.isFinite(earliest) || earliest > weekAgo) return null;
    const current = kmMedianAsOf(base, severities, now, { hideNoFix });
    const previous = kmMedianAsOf(base, severities, weekAgo, { hideNoFix });
    if (current === null || previous === null) return null;
    return {
      current,
      previous,
      deltaDays: Math.round((current - previous) * 1e3) / 1e3,
      days: 7
    };
  }
  var cachedExecutiveWeekTrend = (p) => {
    var _a, _b;
    return cached(
      "execWeekTrend",
      {
        domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
        supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
        severities: readSeverities(p),
        showNoFix: getShowNoFix2()
      },
      () => executiveWeekTrend(p),
      3600
    );
  };
  function executiveSeverityCounts(p) {
    var _a, _b;
    const scan = currentScan();
    if (!scan) return { flatScan: false, counts: {}, total: 0 };
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const recs = filterSeverities(
      scopedFrameRecords(domain, supportGroup, []),
      readSeverities(p)
    ).filter((r) => isOpenStatus(r["status"]));
    return { flatScan: true, counts: sevCountsOf(recs), total: recs.length };
  }
  var cachedExecutiveSeverityCounts = (p) => {
    var _a, _b;
    return cached(
      // "execSevCounts1" → "execSevCounts2": the tally is open-only now. Same shape, different
      // population — exactly the kind of change a stale entry serves without any symptom.
      "execSevCounts2",
      {
        domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
        supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
        severities: readSeverities(p),
        showNoFix: getShowNoFix2()
      },
      () => executiveSeverityCounts(p),
      3600
    );
  };
  function getExecutivePage(p) {
    var _a;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    return run(() => ({
      mttr: execMttrSlice(cachedMttrData(p)),
      // The same dimension switch getMttrPage makes: splitting BY domain while scoped TO one
      // domain yields a single row, so a domain scope splits by support group within it instead.
      byDomain: execGroupSlice(
        domain ? cachedMttrBySupportGroupData(p) : cachedMttrByDomainData(p)
      ),
      // Already minimal — four scalars and a per-severity tally — so these two ship whole.
      weekTrend: cachedExecutiveWeekTrend(p),
      severityCounts: cachedExecutiveSeverityCounts(p)
    }));
  }
  function scanHistoryData() {
    var _a;
    const scans = loadScanRows().slice().reverse();
    const base = visibleBase(loadBaseRows());
    const open = base.filter((r) => r.status === "OPEN").length;
    const resolved = base.filter((r) => r.status === "RESOLVED").length;
    const { overall } = mttrFromLedger(base);
    return {
      scans,
      kpis: {
        tracked: base.length,
        open,
        resolvedAllTime: resolved,
        medianMttr: (_a = overall.mttr_median) != null ? _a : null
      }
    };
  }
  var cachedScanHistoryData = () => (
    // "scanHistory" → "scanHistory2": the KPI band now drops no-fix findings when the toggle is
    // off; params null → {showNoFix} so on/off states cache apart and no stale entry survives.
    durablyCached("scanHistory2", { showNoFix: getShowNoFix2() }, scanHistoryData)
  );
  function getScanHistory(_p) {
    return run(() => {
      const d = cachedScanHistoryData();
      return { ...d, scans: scanRowsSlice(d["scans"]) };
    });
  }
  function runScan(p) {
    const params = p != null ? p : {};
    return run(
      () => {
        var _a;
        return startScan({
          incremental: Boolean(params["incremental"]),
          sampleShape: (_a = params["sampleShape"]) != null ? _a : void 0
        });
      },
      "scan"
    );
  }
  function getJobStatus(p) {
    return run(() => {
      var _a;
      const jobId = String((_a = p == null ? void 0 : p["jobId"]) != null ? _a : "");
      return jobId ? jobSummary(getJob(jobId)) : activeJobSummary();
    });
  }
  function cancelScan2(p) {
    return run(() => {
      var _a;
      return cancelScan(String((_a = p == null ? void 0 : p["jobId"]) != null ? _a : ""));
    });
  }
  function assertNoActivePurge(what) {
    if (activePurgeJob()) {
      throw new LedgerBusyError(
        `A severity purge is still rewriting scan archives \u2014 ${what} would replay the ones it hasn't reached yet. Wait for it to finish, then retry.`
      );
    }
  }
  function deleteScans2(p) {
    var _a;
    const scanIds = ((_a = p == null ? void 0 : p["scanIds"]) != null ? _a : []).map(String);
    return mutate(() => {
      assertNoActivePurge("deleting a scan");
      return deleteScans(scanIds);
    });
  }
  function compact(p) {
    const params = p != null ? p : {};
    const dryRun = Boolean(params["dryRun"]);
    const days = params["retentionDays"] !== void 0 ? Number(params["retentionDays"]) : getRetentionDays2();
    if (dryRun) return run(() => compactLedger(days, true));
    return mutate(() => {
      assertNoActivePurge("compacting");
      return compactLedger(days, false);
    });
  }
  function cutoffDate(days, now) {
    return new Date((now != null ? now : Date.now()) - days * 864e5).toISOString().slice(0, 10);
  }
  function severityList(v) {
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
  }
  function previewMaintenance2(p) {
    var _a, _b;
    const params = p != null ? p : {};
    const episodeDays = Math.max(1, Number((_a = params["episodeDays"]) != null ? _a : 365));
    const historyDays = Math.max(1, Number((_b = params["historyDays"]) != null ? _b : 365));
    const now = Date.now();
    return run(
      () => previewMaintenance(
        severityList(params["severities"]),
        {
          resolvedBeforeMs: now - episodeDays * 864e5,
          severities: severityList(params["episodeSeverities"]).length ? severityList(params["episodeSeverities"]) : null
        },
        cutoffDate(historyDays, now)
      )
    );
  }
  function startSeverityPurge2(p) {
    const params = p != null ? p : {};
    return run(
      () => startSeverityPurge(
        severityList(params["severities"]),
        params["alsoNarrowScope"] !== false
      ),
      "startSeverityPurge"
    );
  }
  function getPurgeStatus(_p) {
    return run(() => ({ purge: purgeStatus() }));
  }
  function pruneEpisodes2(p) {
    var _a;
    const params = p != null ? p : {};
    const days = Math.max(1, Number((_a = params["days"]) != null ? _a : 365));
    const sevs = severityList(params["severities"]);
    return mutate(() => {
      assertNoActivePurge("pruning episodes");
      return pruneEpisodes({
        resolvedBeforeMs: Date.now() - days * 864e5,
        severities: sevs.length ? sevs : null
      });
    });
  }
  function trimHistory2(p) {
    var _a;
    const days = Math.max(1, Number((_a = (p != null ? p : {})["days"]) != null ? _a : 365));
    return mutate(() => trimHistory(cutoffDate(days)));
  }
  function payloadOf(params, fallbackKey) {
    if (typeof params["gzipB64"] === "string") {
      return JSON.parse(
        Utilities.ungzip(
          Utilities.newBlob(Utilities.base64Decode(params["gzipB64"]), "application/x-gzip")
        ).getDataAsString("UTF-8")
      );
    }
    return params[fallbackKey];
  }
  function importMigration(p) {
    return mutate(() => {
      const params = p != null ? p : {};
      const bundle = validateBundle(payloadOf(params, "bundle"));
      const counts = importBundle(bundle);
      const hist = importHistory(bundle.mttr_history);
      return { ...counts, history_added: hist.added, history_skipped: hist.skipped };
    });
  }
  function importBegin(p) {
    return mutate(() => importBeginSharded(payloadOf(p != null ? p : {}, "manifest")));
  }
  function importShard(p) {
    return mutate(() => {
      var _a, _b, _c, _d, _e;
      const params = p != null ? p : {};
      const shard = payloadOf(params, "shard");
      const index = Number((_b = (_a = params["index"]) != null ? _a : shard == null ? void 0 : shard["index"]) != null ? _b : 0);
      return importApplyShard(String((_c = params["sessionId"]) != null ? _c : ""), index, {
        ledger: (_d = shard == null ? void 0 : shard["ledger"]) != null ? _d : [],
        episodes: (_e = shard == null ? void 0 : shard["episodes"]) != null ? _e : []
      });
    });
  }
  function importFinalize(p) {
    return mutate(
      () => {
        var _a;
        return importFinalizeSharded(String((_a = (p != null ? p : {})["sessionId"]) != null ? _a : ""));
      }
    );
  }
  function importAbort(p) {
    return mutate(
      () => {
        var _a;
        return importAbortSharded(String((_a = (p != null ? p : {})["sessionId"]) != null ? _a : ""));
      }
    );
  }
  function importStatus(p) {
    return run(() => {
      var _a;
      const jobId = String((_a = (p != null ? p : {})["jobId"]) != null ? _a : "");
      return jobId ? getJob(jobId) : activeJobSummary();
    });
  }
  function resetLedger2() {
    return mutate(() => {
      try {
        clearContinuationTriggers3();
      } catch (e) {
        console.warn(`resetLedger: continuation-trigger cleanup skipped: ${e}`);
      }
      return resetLedger();
    });
  }
  var REPORT_SOURCE = "OS vulnerabilities";
  function getReport(p) {
    return run(() => {
      var _a, _b, _c, _d, _e, _f;
      const params = p != null ? p : {};
      const format = String((_a = params["format"]) != null ? _a : "markdown");
      const scan = currentScan();
      if (!scan) return { content: "", filename: "", matrix: [] };
      const domains = (_b = params["domains"]) != null ? _b : [];
      const sgFilter = (_c = params["supportGroups"]) != null ? _c : [];
      const displayed = visibleFrame(
        applyFilters(scan.records, {
          severities: getDisplaySeverities2(),
          domains,
          supportGroups: sgFilter
        })
      );
      const counts = sevCountsOf(displayed);
      let baseRows2 = loadBaseRows();
      if (domains.length || sgFilter.length) {
        attachSupportGroups(baseRows2);
        if (sgFilter.length) {
          const keep = new Set(sgFilter);
          baseRows2 = baseRows2.filter((r) => {
            var _a2;
            return keep.has(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
          });
        }
        if (domains.length) {
          const compiled = compileDomains(getDomains2().items);
          attachBizDomains(baseRows2);
          baseRows2 = baseRows2.filter((r) => domains.includes(resolveDomainName(r, compiled)));
        }
      }
      baseRows2 = visibleBase(baseRows2);
      const { perSev, overall } = mttrFromLedger(baseRows2);
      void perSev;
      const generated = (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
      const matrix = [
        {
          source: REPORT_SOURCE,
          ...Object.fromEntries(SEVERITY_ORDER.map((s) => {
            var _a2;
            return [s, (_a2 = counts[s]) != null ? _a2 : 0];
          })),
          total: displayed.length,
          medianMttr: (_d = overall.mttr_median) != null ? _d : null,
          open: (_e = overall.open) != null ? _e : 0
        }
      ];
      if (format === "json") {
        return {
          content: JSON.stringify({ generated, sources: matrix }, null, 2),
          filename: `wiz-report-${generated.slice(0, 10)}.json`,
          matrix
        };
      }
      if (format === "csv") {
        const cols = TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
        const lines = [cols.join(",")];
        for (const r of displayed) {
          lines.push(cols.map((c) => csvCell(r[c])).join(","));
        }
        return {
          content: lines.join("\r\n"),
          filename: `wiz-report-${generated.slice(0, 10)}.csv`,
          matrix
        };
      }
      const md = [
        `# Security summary \u2014 ${generated}`,
        "",
        `## ${REPORT_SOURCE}`,
        "",
        `| Severity | Count |`,
        `| --- | ---: |`,
        ...SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `| ${s} | ${counts[s]} |`),
        `| **Total** | **${displayed.length}** |`,
        "",
        `Median MTTR: ${overall.mttr_median != null ? overall.mttr_median.toFixed(1) + " days" : "\u2014"}`,
        `Open findings: ${(_f = overall.open) != null ? _f : 0}`
      ].join("\n");
      return { content: md, filename: `wiz-report-${generated.slice(0, 10)}.md`, matrix };
    });
  }
  function csvCell(v) {
    if (v === null || v === void 0) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function getExportCsv(p) {
    return run(() => {
      var _a, _b, _c, _d, _e, _f, _g;
      const params = p != null ? p : {};
      const scan = currentScan();
      if (!scan) return { content: "", filename: "" };
      const filtered = visibleFrame(
        applyFilters(scan.records, {
          severities: (_a = params["severities"]) != null ? _a : getDisplaySeverities2(),
          statuses: (_b = params["statuses"]) != null ? _b : [],
          assetTypes: (_c = params["assetTypes"]) != null ? _c : [],
          clouds: (_d = params["clouds"]) != null ? _d : [],
          domains: (_e = params["domains"]) != null ? _e : [],
          supportGroups: (_f = params["supportGroups"]) != null ? _f : [],
          q: (_g = params["q"]) != null ? _g : ""
        })
      );
      const cols = TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
      const lines = [cols.join(",")];
      for (const r of filtered) lines.push(cols.map((c) => csvCell(r[c])).join(","));
      return {
        content: lines.join("\r\n"),
        filename: `wiz-os-vulnerabilities-${scan.scanId.slice(0, 10)}.csv`
      };
    });
  }
  function getExportRawUrl(p) {
    return run(() => {
      var _a;
      const scanId = String((_a = p == null ? void 0 : p["scanId"]) != null ? _a : "");
      const row = scanId ? loadScanRows().find((s) => s.scan_id === scanId) : latestScanRow();
      if (!(row == null ? void 0 : row.raw_ref)) return { urls: [] };
      const folder = DriveApp.getFolderById(row.raw_ref);
      const urls = [];
      const files = folder.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (/^page-\d+\.json(\.gz)?$/.test(f.getName())) {
          urls.push({ name: f.getName(), url: f.getDownloadUrl() });
        }
      }
      urls.sort((a, b) => a.name < b.name ? -1 : 1);
      return { urls, folderUrl: folder.getUrl() };
    });
  }
  function exportMigrationBundle(_p) {
    return run(() => {
      const exportedAt = nowIso();
      const bundle = buildMigrationBundle(loadState(), loadHistory(), {
        exportedAt,
        schemaVersion: SCHEMA_VERSION
      });
      const stamp2 = exportedAt.replace(/[:]/g, "");
      const written = writeMigrationExport(`migration-${stamp2}.json.gz`, bundle);
      return { ...written, exported_at: exportedAt, counts: bundleCounts(bundle) };
    });
  }
  function getSettings(_p) {
    return run(() => ({
      fetchSeverities: getFetchSeverities2(),
      displaySeverities: getDisplaySeverities2(),
      retentionDays: getRetentionDays2(),
      autoCompact: getAutoCompact2(),
      showNoFix: getShowNoFix2(),
      includeEol: getIncludeEol2(),
      domains: getDomains2(),
      riskRule: getRiskRule2()
    }));
  }
  function setSeverities(p) {
    const params = p != null ? p : {};
    return mutate(() => {
      if (params["fetch"]) setFetchSeverities(params["fetch"]);
      if (params["display"]) setDisplaySeverities(params["display"]);
      return {
        fetchSeverities: getFetchSeverities2(),
        displaySeverities: getDisplaySeverities2()
      };
    });
  }
  function setRetention(p) {
    const days = p == null ? void 0 : p["days"];
    return mutate(() => {
      setRetentionDays(days === null || days === void 0 ? null : Number(days));
      return { retentionDays: getRetentionDays2() };
    });
  }
  function setAutoCompact2(p) {
    return mutate(() => {
      setAutoCompact(Boolean(p == null ? void 0 : p["on"]));
      return { autoCompact: getAutoCompact2() };
    });
  }
  function setShowNoFix2(p) {
    return mutate(() => {
      setShowNoFix(Boolean(p == null ? void 0 : p["on"]));
      return { showNoFix: getShowNoFix2() };
    });
  }
  function setIncludeEol2(p) {
    return mutate(() => {
      setIncludeEol(Boolean(p == null ? void 0 : p["on"]));
      return { includeEol: getIncludeEol2() };
    });
  }
  function setRiskRule2(p) {
    return mutate(() => {
      setRiskRule(p == null ? void 0 : p["rule"]);
      return { riskRule: getRiskRule2() };
    });
  }
  function setRetentionSettings(p) {
    const params = p != null ? p : {};
    const days = params["days"];
    return mutate(() => {
      setRetentionAndCompact(
        days === null || days === void 0 ? null : Number(days),
        Boolean(params["autoCompact"])
      );
      return {
        retentionDays: getRetentionDays2(),
        autoCompact: getAutoCompact2()
      };
    });
  }
  var ACCESS_MAX_BYTES = 8e3;
  var ACCESS_MAX_ENTRIES = 500;
  function validateAddresses(raw) {
    const list = parseAllowlist(Array.isArray(raw) ? raw.join("\n") : String(raw != null ? raw : ""));
    const bad = list.filter((e) => e.indexOf("@") < 0);
    if (bad.length) throw new Error(`Not an email address: ${bad.join(", ")}`);
    if (list.length > ACCESS_MAX_ENTRIES) {
      throw new Error(`Too many people (${list.length}); the limit is ${ACCESS_MAX_ENTRIES}.`);
    }
    const bytes = list.join(",").length;
    if (bytes > ACCESS_MAX_BYTES) {
      throw new Error(`That list is too long to store (${bytes} of ${ACCESS_MAX_BYTES} bytes).`);
    }
    return list;
  }
  function logAccessChange(what, actor, before, after) {
    const added = after.filter((e) => before.indexOf(e) < 0);
    const removed = before.filter((e) => after.indexOf(e) < 0);
    console.log(JSON.stringify({ access: "changed", what, actor, added, removed }));
  }
  function getAccess(_p) {
    return run(() => {
      const canUsers = canEditUsers();
      if (!canUsers) return { canEditUsers: false, canEditAdmins: false };
      return {
        canEditUsers: true,
        canEditAdmins: canEditAdmins(),
        owner: ownerEmail(),
        domain: ownerDomain(),
        users: currentUsers(),
        admins: currentAdmins()
      };
    }, "getAccess");
  }
  function saveAccess(p) {
    return run(() => {
      if (!canEditUsers()) throw new Error("Only the owner or an admin can change access.");
      const before = currentUsers();
      const list = validateAddresses(p == null ? void 0 : p["users"]);
      const owner = ownerEmail().trim().toLowerCase();
      const withOwner = owner && list.indexOf(owner) < 0 ? [owner].concat(list) : list;
      setProp(PROP_KEYS.allowedUsers, withOwner.join(", "));
      logAccessChange("users", check().email, before, withOwner);
      return { users: withOwner };
    }, "saveAccess");
  }
  function saveAdmins(p) {
    return run(() => {
      if (!canEditAdmins()) throw new Error("Only the owner can change admins.");
      const before = currentAdmins();
      const list = validateAddresses(p == null ? void 0 : p["admins"]);
      setProp(PROP_KEYS.allowedAdmins, list.join(", "));
      logAccessChange("admins", check().email, before, list);
      return { admins: list };
    }, "saveAdmins");
  }
  function getDomains3(_p) {
    return run(() => getDomains2());
  }
  function saveDomains(p) {
    var _a;
    const items = (_a = p == null ? void 0 : p["items"]) != null ? _a : [];
    return mutate(() => {
      const errors = validateDomains(items);
      if (errors.length) return { saved: false, errors };
      setDomains(items);
      invalidateFrameMemo();
      return { saved: true, errors: [], domains: getDomains2() };
    });
  }
  function previewDomains(p) {
    return run(() => {
      var _a, _b, _c, _d;
      const items = (_a = p == null ? void 0 : p["items"]) != null ? _a : [];
      const compiled = compileDomains(items);
      const scan = currentScan();
      const records = (_b = scan == null ? void 0 : scan.records) != null ? _b : [];
      const perDomain = {};
      for (const d of compiled) perDomain[d.name] = { count: 0, samples: [] };
      perDomain[UNASSIGNED] = { count: 0, samples: [] };
      for (const r of records) {
        const name = assignDomain(r, compiled);
        const bucket = (_c = perDomain[name]) != null ? _c : perDomain[name] = { count: 0, samples: [] };
        bucket.count += 1;
        if (bucket.samples.length < 5) {
          const asset = String((_d = r["vulnerableAsset.name"]) != null ? _d : "");
          if (asset && !bucket.samples.includes(asset)) bucket.samples.push(asset);
        }
      }
      return { total: records.length, perDomain };
    });
  }
  function refreshSupportGroups2(_p) {
    if (!hasWizCredentials()) {
      return { ok: false, error: "Live Wiz credentials are required to refresh support groups." };
    }
    return mutate(() => {
      const stats = refreshSupportGroups();
      invalidateFrameMemo();
      return stats;
    }, "supportGroupRefresh");
  }
  function backfillEpisodeTags2(_p) {
    return mutate(() => {
      const result = backfillEpisodeTags();
      invalidateFrameMemo();
      return result;
    }, "backfillEpisodeTags");
  }
  function getRecentErrors(_p) {
    return run(() => recentErrors());
  }
  function clearRecentErrors(_p) {
    return run(() => {
      clearErrors();
      return { cleared: true };
    });
  }
  var cachedStorageStatsData = () => (
    // "storageStats2" → "storageStats3": payload gained the per-tab capacity breakdown
    // (cellsByTab, ledgerRowCells); dataVersion persists across deploys, so bumping the
    // namespace prevents serving a stale old-shape entry (up to the TTL). The prior bump was
    // for the severity data-quality diagnostic (distinctSeverities, unknownSeverityCount).
    durablyCached("storageStats3", null, () => {
      var _a;
      const scans = loadScanRows();
      const scan = currentScan();
      const baseRows2 = loadBaseRows();
      const usage = cellUsage();
      return {
        cellCount: usage.total,
        cellLimit: 1e7,
        // What is consuming the ceiling, so "nearly full" comes with somewhere to look.
        cellsByTab: usage.tabs,
        // Cells one more tracked vulnerability costs, read off the live header list rather than
        // hardcoded, so the headroom estimate stays right as ledger columns are added.
        ledgerRowCells: ((_a = TAB_HEADERS[TABS.vulnLedger]) != null ? _a : []).length,
        scanCount: scans.length,
        sealedCount: scans.filter((s) => s.sealed).length,
        oldestScanTs: scans.length ? scans[0].ts : null,
        trackedVulns: baseRows2.length,
        distinctSeverities: scan ? distinct(scan.records, "severity") : [],
        unknownSeverityCount: baseRows2.filter(
          (r) => normalizeSeverity(r["severity"]) === "UNKNOWN"
        ).length
      };
    })
  );
  function getStorageStats(_p) {
    return run(() => cachedStorageStatsData());
  }
  function defaultGroupingKeys() {
    return domainNames(getDomains2().items).length > 1 ? ["domain"] : ["atype"];
  }
  var WARM_BUDGET_MS = 27e4;
  function warmReadModels(budgetMs = WARM_BUDGET_MS) {
    duringWarm(() => warmReadModelsInner(budgetMs));
  }
  function warmReadModelsInner(budgetMs) {
    const t0 = Date.now();
    let warmed = 0;
    let skipped = 0;
    const warm = (label, fn) => {
      if (Date.now() - t0 >= budgetMs) {
        skipped += 1;
        return;
      }
      try {
        fn();
        warmed += 1;
      } catch (e) {
        console.warn(`Cache warm (${label}) failed: ${e}`);
      }
    };
    warm("bootstrap", () => bootstrap());
    warm("scanHistory", () => cachedScanHistoryData());
    warm("storageStats", () => cachedStorageStatsData());
    const display = getDisplaySeverities2();
    const scopes = [null];
    if (Array.isArray(display) && display.length && display.length < SELECTABLE_SEVERITIES.length) {
      scopes.push([...display]);
    }
    const groupingKeys = defaultGroupingKeys();
    for (const severities of scopes) {
      const p = { domain: "", supportGroup: "", severities };
      warm("mttr", () => cachedMttrData(p));
      warm("mttrByDomain", () => cachedMttrByDomainData(p));
      warm("execWeekTrend", () => cachedExecutiveWeekTrend(p));
      warm("execSevCounts", () => cachedExecutiveSeverityCounts(p));
      warm("mttrTrend", () => cachedMttrTrendData(p));
      warm("insights", () => cachedInsightsData(p));
      warm("program", () => cachedProgramData(p));
      warm("programTrend", () => cachedProgramTrendData(p));
      warm("mttrBySupportGroup", () => cachedMttrBySupportGroupData(p));
      warm("grouping", () => cachedGroupingData({ ...p, keys: groupingKeys }));
      warm("attribution", () => cachedAttributionData({ severities }));
    }
    if (skipped) {
      console.warn(`Cache warm: ran out of budget after ${warmed} entries, ${skipped} left cold`);
    }
    if (!skipped) sweepReadModels();
  }
  function warmReadModelsScheduled() {
    const job = activeJob();
    if (job) {
      console.log(`Cache warm: skipped, ${job.kind} job ${job.job_id} is ${job.phase}`);
      return;
    }
    warmReadModels();
  }
  return __toCommonJS(index_exports);
})();
