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

  // src/server/buildInfo.ts
  var BUILD_ID = true ? "248cee7e8fc2" : "dev";

  // src/server/serverCache.ts
  var VERSION_PROP = "DATA_VERSION";
  var KEY_PREFIX = `wsk.${BUILD_ID}`;
  var dataVersionMemo;
  var wizDataVersionMemo;
  var configStampMemo;
  function __resetMemosForTest2() {
    dataVersionMemo = void 0;
    wizDataVersionMemo = void 0;
    configStampMemo = void 0;
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
  function nowIso(now) {
    return toIso(now != null ? now : Date.now());
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
      "secret_kind",
      "rotated_at",
      "removed_at",
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
  var DEFAULT_FETCH_SEVERITIES = ["CRITICAL", "HIGH"];

  // src/domain/settingsLogic.ts
  var DEFAULT_SETTINGS = {
    scopes: [...SCOPES],
    fetchSeverities: [...DEFAULT_FETCH_SEVERITIES],
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
  function cleanSettings(raw) {
    var _a;
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
      fetchSeverities: (_a = asList(r.fetchSeverities, SEVERITY_ORDER)) != null ? _a : [...DEFAULT_SETTINGS.fetchSeverities],
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
    ok("Severities requested", s.fetchSeverities.join(", ") || "(all)");
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
    getSettings: () => getSettings,
    putSettings: () => putSettings
  });

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
  return __toCommonJS(index_exports);
})();
