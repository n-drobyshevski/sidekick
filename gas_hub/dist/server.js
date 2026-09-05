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
    doGet: () => doGet,
    include: () => include
  });

  // src/server/main.ts
  function doGet(_e) {
    const template = HtmlService.createTemplateFromFile("index");
    return template.evaluate().setTitle("Wiz Sidekick").addMetaTag("viewport", "width=device-width, initial-scale=1").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }
  function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }

  // src/server/access.ts
  var access_exports = {};
  __export(access_exports, {
    ACCESS_MAX_BYTES: () => ACCESS_MAX_BYTES,
    ACCESS_MAX_ENTRIES: () => ACCESS_MAX_ENTRIES,
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
    serviceUrl: () => serviceUrl,
    validateAddresses: () => validateAddresses
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
    // Who may open the web app, on top of the deployment's own "anyone within <domain>" fence.
    // Comma/semicolon/whitespace-separated addresses; see server/access.ts. Unset means nobody —
    // the guard fails closed, and the owner is allowed by identity rather than by this list.
    allowedUsers: "ALLOWED_USERS",
    // Who may EDIT that list. Owner-only to change; see the admin-tier note in access.ts.
    // Unset means owner-only, like its sibling. Admins are allowed into the app by being admins,
    // not by also appearing in ALLOWED_USERS.
    allowedAdmins: "ALLOWED_ADMINS",
    // The /exec URL of each sibling web app, pasted from its Deploy > Manage deployments.
    // Unset (or blank) renders that tile as "not configured" rather than as a broken link.
    urlOs: "URL_OS",
    urlAi: "URL_AI",
    urlDevsecops: "URL_DEVSECOPS"
  };
  function getProp(key) {
    return PropertiesService.getScriptProperties().getProperty(key);
  }
  function setProp(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, value);
  }

  // src/server/access.ts
  var PRODUCT = "Wiz Sidekick";
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

  // src/server/api.ts
  var api_exports = {};
  __export(api_exports, {
    bootstrap: () => bootstrap,
    getAccess: () => getAccess,
    getUrls: () => getUrls,
    saveAccess: () => saveAccess,
    saveAdmins: () => saveAdmins,
    saveUrls: () => saveUrls
  });

  // src/server/buildInfo.ts
  var BUILD_ID = true ? "a6f415dc9623" : "dev";

  // src/server/urls.ts
  var TILE_ORDER = ["os", "ai", "devsecops"];
  var URL_PROP = {
    os: PROP_KEYS.urlOs,
    ai: PROP_KEYS.urlAi,
    devsecops: PROP_KEYS.urlDevsecops
  };
  var REQUIRED_PREFIX = "https://script.google.com/";
  var URL_REJECTED = "A sidekick URL must start with https://script.google.com/ \u2014 paste the /exec URL from Deploy \u2192 Manage deployments.";
  function normalizeAppUrl(raw) {
    if (typeof raw !== "string") throw new Error(URL_REJECTED);
    const url = raw.trim();
    if (!url) return "";
    if (url.indexOf(REQUIRED_PREFIX) !== 0) throw new Error(URL_REJECTED);
    return url;
  }
  function readUrls() {
    const out = {};
    for (const key of TILE_ORDER) {
      let value = "";
      try {
        value = normalizeAppUrl(getProp(URL_PROP[key]) || "");
      } catch (_e) {
        value = "";
      }
      out[key] = value;
    }
    return out;
  }
  function writeUrls(next) {
    for (const key of TILE_ORDER) {
      if (!(key in next)) continue;
      setProp(URL_PROP[key], normalizeAppUrl(next[key]));
    }
    return readUrls();
  }

  // src/server/api.ts
  function run(fn) {
    try {
      return { ok: true, data: fn() };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: "error" };
    }
  }
  var TILE_COPY = [
    {
      key: "os",
      productName: "Wiz Sidekick OS",
      headline: "OS Patching",
      scope: "Host CVEs \xB7 MTTR \xB7 SLA"
    },
    {
      key: "ai",
      productName: "Wiz Sidekick AI",
      headline: "AI",
      scope: "Agents \xB7 models \xB7 posture"
    },
    {
      key: "devsecops",
      productName: "Wiz Sidekick DevSecOps",
      headline: "DevSecOps",
      scope: "SAST \xB7 SCA \xB7 Secrets"
    },
    {
      key: "soon",
      productName: "Wiz Sidekick",
      headline: "Coming soon",
      scope: "Not yet built"
    }
  ];
  function bootstrap(_p) {
    return run(() => {
      const urls = readUrls();
      const tiles = TILE_COPY.map((t) => ({
        key: t.key,
        productName: t.productName,
        headline: t.headline,
        scope: t.scope,
        url: urls[t.key] || null
      }));
      return {
        product: PRODUCT,
        buildId: BUILD_ID,
        tiles,
        canEditAccess: canEditUsers(),
        canEditUrls: canEditUsers()
      };
    });
  }
  function logAccessChange(what, actor, before, after) {
    const added = after.filter((e) => before.indexOf(e) < 0);
    const removed = before.filter((e) => after.indexOf(e) < 0);
    console.log(JSON.stringify({ access: "changed", what, actor, added, removed }));
  }
  function getAccess(_p) {
    return run(() => {
      if (!canEditUsers()) return { canEditUsers: false, canEditAdmins: false };
      return {
        canEditUsers: true,
        canEditAdmins: canEditAdmins(),
        owner: ownerEmail(),
        domain: ownerDomain(),
        users: currentUsers(),
        admins: currentAdmins()
      };
    });
  }
  function saveAccess(p) {
    return run(() => {
      if (!canEditUsers()) throw new Error("Only the owner or an admin can change access.");
      const before = currentUsers();
      const list = validateAddresses(p == null ? void 0 : p.users);
      const owner = ownerEmail().trim().toLowerCase();
      const withOwner = owner && list.indexOf(owner) < 0 ? [owner].concat(list) : list;
      setProp(PROP_KEYS.allowedUsers, withOwner.join(", "));
      logAccessChange("users", check().email, before, withOwner);
      return { users: withOwner };
    });
  }
  function saveAdmins(p) {
    return run(() => {
      if (!canEditAdmins()) throw new Error("Only the owner can change admins.");
      const before = currentAdmins();
      const list = validateAddresses(p == null ? void 0 : p.admins);
      setProp(PROP_KEYS.allowedAdmins, list.join(", "));
      logAccessChange("admins", check().email, before, list);
      return { admins: list };
    });
  }
  function getUrls(_p) {
    return run(() => {
      if (!canEditUsers()) return { canEditUrls: false };
      return { canEditUrls: true, urls: readUrls() };
    });
  }
  function saveUrls(p) {
    return run(() => {
      if (!canEditUsers()) throw new Error("Only the owner or an admin can change these.");
      const before = readUrls();
      const after = writeUrls((p == null ? void 0 : p.urls) || {});
      const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
      if (changed.length) {
        console.log(JSON.stringify({ urls: "changed", actor: check().email, changed }));
      }
      return after;
    });
  }
  return __toCommonJS(index_exports);
})();
