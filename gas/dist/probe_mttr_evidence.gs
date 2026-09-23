/**
 * ONE-OFF, READ-ONLY measurement of the OS ledger. Writes nothing, changes nothing.
 *
 * It answers the question the Wiz API cannot: of everything this register calls "resolved",
 * how much is a finding that was fixed, and how much is a whole asset that went away. On a
 * VM estate those are not the same event, and `resolution_src` only says api-vs-disappeared,
 * never patched-vs-decommissioned.
 *
 * Run `probeMttrEvidence` from the Apps Script editor and copy the execution log.
 *
 * Everything is streamed in chunks and reduced into histograms, so memory stays flat on a
 * ledger of any size. Medians are read off whole-day histograms — day resolution is all this
 * question needs, and it is what lets the script not hold 500k numbers in memory.
 */

var PROBE_CHUNK_ROWS = 5000;
var PROBE_TIME_BUDGET_MS = 5 * 60 * 1000; // Apps Script kills the run at 6 minutes.
var PROBE_DAY_CAP = 1000; // histogram tail bucket, in days

function probeMttrEvidence() {
  var started = Date.now();
  var out = [];
  var say = function (line) { out.push(line); };

  var id = PropertiesService.getScriptProperties().getProperty('LEDGER_SPREADSHEET_ID');
  if (!id) { Logger.log('LEDGER_SPREADSHEET_ID is not set on this project.'); return; }
  var ss = SpreadsheetApp.openById(id);

  say('LEDGER PROBE  ' + new Date().toISOString());
  say('spreadsheet: ' + ss.getName());
  say('');

  // ---------------------------------------------------------------- scans: the clock
  var scans = probeReadAll(ss, 'scans', ['scan_id', 'ts', 'mode', 'total', 'resolved_count', 'sealed']);
  var tsList = [];
  for (var i = 0; i < scans.length; i++) {
    var t = probeMs(scans[i].ts);
    if (t !== null) tsList.push(t);
  }
  tsList.sort(function (a, b) { return a - b; });
  var trackingStart = tsList.length ? tsList[0] : null;
  var newestScan = tsList.length ? tsList[tsList.length - 1] : null;
  var gaps = [];
  for (var g = 1; g < tsList.length; g++) gaps.push((tsList[g] - tsList[g - 1]) / 86400000);
  gaps.sort(function (a, b) { return a - b; });

  say('SCANS');
  say('  count            ' + scans.length);
  say('  tracking since   ' + (trackingStart === null ? '(none)' : new Date(trackingStart).toISOString()));
  say('  newest scan      ' + (newestScan === null ? '(none)' : new Date(newestScan).toISOString()));
  say('  watching for     ' + (trackingStart === null ? '—' : ((newestScan - trackingStart) / 86400000).toFixed(1) + ' days'));
  say('  gap between scans p50/p90/max  ' + probePick(gaps, 0.5) + ' / ' + probePick(gaps, 0.9) + ' / ' + probePick(gaps, 1) + ' days');
  say('  sealed scans     ' + probeCountWhere(scans, function (r) { return String(r.sealed) === '1' || r.sealed === true; }));
  say('');

  // ------------------------------------------------- pass 1: per-asset and per-group facts
  var sh = ss.getSheetByName('vuln_ledger');
  if (!sh) { Logger.log(out.join('\n') + '\nNo vuln_ledger tab.'); return; }
  var wanted = ['asset_id', 'asset_name', 'status', 'first_seen', 'last_seen', 'resolved_at', 'resolution_src', 'severity'];

  var assetOpen = {};      // asset_id -> open rows now
  var assetLastSeen = {};  // asset_id -> max last_seen (ms)
  var assetRows = {};      // asset_id -> rows total
  var groupSize = {};      // asset_id|resolved_at -> resolved rows sharing that instant
  var total = 0, open = 0, resolved = 0, srcMix = {}, noFirstSeen = 0;

  var partial = probeStream(sh, wanted, started, function (r) {
    total++;
    var asset = String(r.asset_id || '(none)');
    assetRows[asset] = (assetRows[asset] || 0) + 1;
    var ls = probeMs(r.last_seen);
    if (ls !== null && (!(asset in assetLastSeen) || ls > assetLastSeen[asset])) assetLastSeen[asset] = ls;
    if (probeMs(r.first_seen) === null) noFirstSeen++;

    var isResolved = String(r.status || '').toUpperCase() === 'RESOLVED';
    if (!isResolved) { open++; assetOpen[asset] = (assetOpen[asset] || 0) + 1; return; }
    resolved++;
    var src = String(r.resolution_src || '(blank)');
    srcMix[src] = (srcMix[src] || 0) + 1;
    var key = asset + '|' + String(r.resolved_at || '');
    groupSize[key] = (groupSize[key] || 0) + 1;
  });

  // ------------------------------------- pass 2: classify each resolution, collect lifetimes
  // THE CLASSIFICATION, and it is the whole point of this script:
  //   asset-gone  the asset has no open row left AND nothing of it was seen after that
  //               instant, and it lost 2+ findings at once -> the asset went away
  //   mass-fix    2+ findings of a STILL-LIVE asset resolved in the same instant
  //               -> an image rebuild or a patch run, a real fix
  //   single      one finding resolved on its own
  var life = { 'asset-gone': probeHist(), 'mass-fix': probeHist(), 'single': probeHist() };
  var counts = { 'asset-gone': 0, 'mass-fix': 0, 'single': 0 };
  var goneAssets = {};
  var lateEntrants = 0, entryAges = probeHist(), openAges = probeHist();

  var partial2 = probeStream(sh, wanted, started, function (r) {
    var asset = String(r.asset_id || '(none)');
    var first = probeMs(r.first_seen);
    var isResolved = String(r.status || '').toUpperCase() === 'RESOLVED';

    if (!isResolved) {
      if (first !== null && newestScan !== null) probeAdd(openAges, (newestScan - first) / 86400000);
      if (first !== null && trackingStart !== null && first < trackingStart) {
        lateEntrants++;
        probeAdd(entryAges, (trackingStart - first) / 86400000);
      }
      return;
    }
    var res = probeMs(r.resolved_at);
    var key = asset + '|' + String(r.resolved_at || '');
    var size = groupSize[key] || 1;
    var stillOpen = (assetOpen[asset] || 0) > 0;
    var seenAfter = res !== null && (assetLastSeen[asset] || 0) > res + 60000; // a minute of slack
    var cls = size >= 2 && !stillOpen && !seenAfter ? 'asset-gone' : (size >= 2 ? 'mass-fix' : 'single');
    counts[cls]++;
    if (cls === 'asset-gone') goneAssets[asset] = true;
    if (first !== null && res !== null) probeAdd(life[cls], (res - first) / 86400000);
  });

  say('LEDGER (live rows in vuln_ledger)');
  say('  rows             ' + total + (partial || partial2 ? '   *** PARTIAL: time budget hit, numbers below are incomplete ***' : ''));
  say('  open             ' + open);
  say('  resolved         ' + resolved);
  say('  no first_seen    ' + noFirstSeen);
  say('  resolution_src   ' + JSON.stringify(srcMix));
  say('  assets           ' + Object.keys(assetRows).length);
  say('');

  var classified = counts['asset-gone'] + counts['mass-fix'] + counts['single'];
  say('WHAT "RESOLVED" ACTUALLY WAS   (' + classified + ' resolutions classified)');
  say('  asset gone       ' + probeLine(counts['asset-gone'], classified) + '   median lifetime ' + probeMedian(life['asset-gone']) + ' d   assets: ' + Object.keys(goneAssets).length);
  say('  mass fix         ' + probeLine(counts['mass-fix'], classified) + '   median lifetime ' + probeMedian(life['mass-fix']) + ' d');
  say('  single fix       ' + probeLine(counts['single'], classified) + '   median lifetime ' + probeMedian(life['single']) + ' d');
  say('');
  say('  If "asset gone" dominates, this register\'s MTTR is measuring how long instances');
  say('  live, not how fast anything is patched.');
  say('');

  say('LEFT TRUNCATION EXPOSURE (open rows)');
  say('  open rows first seen BEFORE tracking started: ' + lateEntrants + probeShare(lateEntrants, open));
  say('  their median age at entry                   : ' + probeMedian(entryAges) + ' d');
  say('  open age p50/p90/max                        : ' + probeMedianQ(openAges, 0.5) + ' / ' + probeMedianQ(openAges, 0.9) + ' / ' + probeMedianQ(openAges, 1) + ' d');
  say('');

  // -------------------------------------------------- episodes: sealed history, asset unknown
  var epSh = ss.getSheetByName('resolved_episodes');
  if (epSh) {
    var epCount = 0, epSrc = {}, epLife = probeHist();
    probeStream(epSh, ['first_seen', 'resolved_at', 'resolution_src'], started, function (r) {
      epCount++;
      var s = String(r.resolution_src || '(blank)');
      epSrc[s] = (epSrc[s] || 0) + 1;
      var f = probeMs(r.first_seen), rs = probeMs(r.resolved_at);
      if (f !== null && rs !== null) probeAdd(epLife, (rs - f) / 86400000);
    });
    say('SEALED EPISODES (compacted history — carries no asset, so it cannot be classified)');
    say('  episodes         ' + epCount);
    say('  resolution_src   ' + JSON.stringify(epSrc));
    say('  median lifetime  ' + probeMedian(epLife) + ' d');
    say('');
  }

  say('elapsed ' + ((Date.now() - started) / 1000).toFixed(0) + ' s');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/* ------------------------------------------------------------------ small helpers */

function probeStream(sh, wanted, started, fn) {
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return false;
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {};
  for (var w = 0; w < wanted.length; w++) {
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]) === wanted[w]) { idx[wanted[w]] = h; break; }
    }
  }
  for (var start = 2; start <= lastRow; start += PROBE_CHUNK_ROWS) {
    if (Date.now() - started > PROBE_TIME_BUDGET_MS) return true; // partial
    var n = Math.min(PROBE_CHUNK_ROWS, lastRow - start + 1);
    var vals = sh.getRange(start, 1, n, lastCol).getValues();
    for (var i = 0; i < vals.length; i++) {
      var o = {};
      for (var k in idx) o[k] = vals[i][idx[k]];
      fn(o);
    }
  }
  return false;
}

function probeReadAll(ss, tab, wanted) {
  var sh = ss.getSheetByName(tab);
  if (!sh) return [];
  var rows = [];
  probeStream(sh, wanted, Date.now(), function (r) { rows.push(r); });
  return rows;
}

function probeMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getTime();
  var t = Date.parse(String(v));
  return isNaN(t) ? null : t;
}

function probeHist() { return { n: 0, bins: {} }; }

function probeAdd(hist, days) {
  if (days === null || isNaN(days)) return;
  var d = Math.floor(days);
  if (d < 0) d = 0;
  if (d > PROBE_DAY_CAP) d = PROBE_DAY_CAP;
  hist.bins[d] = (hist.bins[d] || 0) + 1;
  hist.n++;
}

function probeMedian(hist) { return probeMedianQ(hist, 0.5); }

function probeMedianQ(hist, q) {
  if (!hist.n) return '—';
  var target = Math.ceil(hist.n * q), seen = 0;
  var keys = Object.keys(hist.bins).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < keys.length; i++) {
    seen += hist.bins[keys[i]];
    if (seen >= target) return String(keys[i]) + (keys[i] === PROBE_DAY_CAP ? '+' : '');
  }
  return String(keys[keys.length - 1]);
}

function probePick(sorted, q) {
  if (!sorted.length) return '—';
  return sorted[Math.floor(q * (sorted.length - 1))].toFixed(2);
}

function probeCountWhere(rows, pred) {
  var n = 0;
  for (var i = 0; i < rows.length; i++) if (pred(rows[i])) n++;
  return n;
}

function probeShare(part, whole) { return whole ? '  (' + (part / whole * 100).toFixed(1) + '%)' : ''; }

function probeLine(part, whole) {
  var s = String(part);
  while (s.length < 8) s = ' ' + s;
  return s + probeShare(part, whole);
}

/**
 * PROBE 3 — is this an estate that patches, or one that replaces?
 *
 * Probe 2 proved record churn is real but not dominant: 10.3% of resolutions were followed by
 * a record born BEFORE its predecessor closed (which no fix-then-regress can produce), ~20%
 * came back within a day, and returns arrive overwhelmingly under a NEW id rather than as
 * reopens of the same key — 12,149 returns against 1,996 counted reopens. That contaminates
 * the half-life. It does not explain it: 85.9% of (cve, asset) pairs appear exactly once, and
 * they still die in about a day, while the open backlog sits at 42 days.
 *
 * The remaining explanation is that the estate replaces hosts rather than patching them. If a
 * VM is rebuilt from a fresh image, its findings genuinely vanish — but what the ledger then
 * measures is how long a host generation lives, not how fast anything was fixed, and the honest
 * unit for an MTTR would be (cve, image) or (cve, fleet), never (cve, instance).
 *
 * Two signatures separate replacement from patching:
 *   1. An asset NAME carried by several asset IDs over time — the host came back as a new
 *      resource. (Names are reused by rebuild pipelines; ids are not.)
 *   2. An asset that loses a batch of findings and gains a comparable batch of DIFFERENT ones
 *      within a day — a new image with a new package set, rather than a patch that removes.
 *
 * Run `probeEstateShape`. Read-only, like its siblings.
 */
function probeEstateShape() {
  var started = Date.now();
  var out = [];
  var say = function (l) { out.push(l); };

  var id = PropertiesService.getScriptProperties().getProperty('LEDGER_SPREADSHEET_ID');
  if (!id) { Logger.log('LEDGER_SPREADSHEET_ID is not set on this project.'); return; }
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName('vuln_ledger');
  if (!sh) { Logger.log('No vuln_ledger tab.'); return; }

  say('ESTATE SHAPE PROBE  ' + new Date().toISOString());
  say('');

  var idsByName = {};      // asset_name -> { asset_id: true }
  var batch = {};          // asset_id|resolved_at(day) -> resolutions that instant
  var deathsByAssetDay = {}; // asset_id|resolved_at(day) -> deaths that day
  var cveBornAfter = {};   // asset_id|day -> { cve: true } for births
  var cveDiedOn = {};      // asset_id|day -> { cve: true } for deaths
  // BY NAME AS WELL AS BY ID, and this is the case the probe exists for: a rebuilt host comes
  // back as a NEW resource, so its replacement findings are born under an asset_id the dead
  // one never had. Keyed by id alone, that reads as a patch — the asset lost everything and
  // gained nothing — which is exactly backwards.
  var cveBornOnName = {};
  var nameOfAsset = {};
  var rows = 0;

  var day = function (v) { var s = String(v || ''); return s ? s.slice(0, 10) : ''; };

  var partial = probeStream(sh, ['cve', 'asset_id', 'asset_name', 'status', 'first_seen', 'resolved_at'], started, function (r) {
    rows++;
    var aid = String(r.asset_id || '');
    var an = String(r.asset_name || '');
    if (an) { (idsByName[an] || (idsByName[an] = {}))[aid] = true; }
    var cve = String(r.cve || '');

    if (aid && an) nameOfAsset[aid] = an;

    var bd = day(r.first_seen);
    if (aid && bd) {
      var bk = aid + '|' + bd;
      (cveBornAfter[bk] || (cveBornAfter[bk] = {}))[cve] = true;
    }
    if (an && bd) {
      var nk = an + '|' + bd;
      (cveBornOnName[nk] || (cveBornOnName[nk] = {}))[cve] = true;
    }
    if (String(r.status || '').toUpperCase() === 'RESOLVED') {
      var dd = day(r.resolved_at);
      if (aid && dd) {
        var dk = aid + '|' + dd;
        deathsByAssetDay[dk] = (deathsByAssetDay[dk] || 0) + 1;
        (cveDiedOn[dk] || (cveDiedOn[dk] = {}))[cve] = true;
        var ik = aid + '|' + String(r.resolved_at || '');
        batch[ik] = (batch[ik] || 0) + 1;
      }
    }
  });

  // ---- 1. asset identity stability
  var names = 0, namesMultiId = 0, extraIds = 0, maxIds = 0;
  for (var n in idsByName) {
    names++;
    var c = 0;
    for (var k in idsByName[n]) c++;
    if (c > 1) { namesMultiId++; extraIds += c - 1; }
    if (c > maxIds) maxIds = c;
  }

  // ---- 2. replacement signature: a day where an asset loses findings and gains others
  var replaceDays = 0, replaceDeaths = 0, patchDays = 0, patchDeaths = 0, sizes = probeHist();
  for (var dk2 in deathsByAssetDay) {
    var deaths = deathsByAssetDay[dk2];
    probeAdd(sizes, deaths);
    // Same HOST, same day: did it take on a comparable set of DIFFERENT cves — whether they
    // landed on this asset_id or on the new one the rebuild gave it?
    var aid2 = dk2.substring(0, dk2.lastIndexOf('|'));
    var d2 = dk2.substring(dk2.lastIndexOf('|') + 1);
    var nm = nameOfAsset[aid2];
    var diedSet = cveDiedOn[dk2] || {};
    var bornSet = cveBornAfter[dk2] || {};
    var bornOnName = nm ? (cveBornOnName[nm + '|' + d2] || {}) : {};
    var fresh = 0, seen = {};
    for (var c2 in bornSet) if (!diedSet[c2] && !seen[c2]) { seen[c2] = true; fresh++; }
    for (var c3 in bornOnName) if (!diedSet[c3] && !seen[c3]) { seen[c3] = true; fresh++; }
    if (deaths >= 5 && fresh >= deaths * 0.5) { replaceDays++; replaceDeaths += deaths; }
    else { patchDays++; patchDeaths += deaths; }
    if (Date.now() - started > PROBE_TIME_BUDGET_MS) break;
  }

  var batches = 0, big = 0, bigDeaths = 0, allDeaths = 0, bsz = probeHist();
  for (var bk2 in batch) {
    batches++;
    var s2 = batch[bk2];
    allDeaths += s2;
    probeAdd(bsz, s2);
    if (s2 >= 50) { big++; bigDeaths += s2; }
  }

  say('ASSET IDENTITY  (does a host come back as a NEW resource?)');
  say('  rows                       ' + rows + (partial ? '   *** PARTIAL ***' : ''));
  say('  distinct asset names       ' + names);
  say('  names carrying >1 asset_id ' + probeLine(namesMultiId, names));
  say('  extra ids beyond the first ' + extraIds + '   (max ids on one name: ' + maxIds + ')');
  say('');
  say('RESOLUTION BATCHES  (asset + exact instant)');
  say('  batches                    ' + batches);
  say('  size p50/p90/max           ' + probeMedianQ(bsz, 0.5) + ' / ' + probeMedianQ(bsz, 0.9) + ' / ' + probeMedianQ(bsz, 1));
  say('  batches of 50+             ' + probeLine(big, batches) + '   carrying ' + bigDeaths + ' of ' + allDeaths + ' resolutions');
  say('');
  say('REPLACE OR PATCH  (asset-days that lost findings)');
  say('  asset-days, replace-shaped ' + probeLine(replaceDays, replaceDays + patchDays) + '   resolutions: ' + replaceDeaths);
  say('  asset-days, patch-shaped   ' + probeLine(patchDays, replaceDays + patchDays) + '   resolutions: ' + patchDeaths);
  say('  deaths per asset-day p50/p90/max  ' + probeMedianQ(sizes, 0.5) + ' / ' + probeMedianQ(sizes, 0.9) + ' / ' + probeMedianQ(sizes, 1));
  say('');
  say('  "Replace-shaped" = the asset lost 5+ findings that day and gained at least half as');
  say('  many DIFFERENT cves the same day: a new image, not a patch. If that dominates, the');
  say('  half-life is the lifetime of a host generation and the honest unit for an MTTR is');
  say('  (cve, image) or (cve, fleet) — never (cve, instance).');
  say('');
  say('elapsed ' + ((Date.now() - started) / 1000).toFixed(0) + ' s');
  Logger.log(out.join('\n'));
  return out.join('\n');
}
