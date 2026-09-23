/**
 * RUN ONE OF THESE FIVE. Everything else in this file is a helper, and the editor's Run
 * dropdown lists helpers too — picking one runs it with no arguments and fails somewhere
 * unhelpful, which is exactly what happened once already.
 *
 *   probeMttrEvidence   what "resolved" actually was: asset gone / mass fix / single fix
 *   probeIdentityChurn  did the same cve come back on the same asset under a new record id
 *   probeEstateShape    does this estate patch, or replace hosts
 *   probeTrueLifetime   is the one-day half-life real, or is it the churn
 *   probeStaleOpen      is the open backlog present, or residue nobody can see any more
 *
 * All five are read-only and write nothing. Delete the file once the answers are written down.
 */

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
 * PROBE 2 — is the ledger watching vulnerabilities, or watching Wiz's records of them?
 *
 * The first probe found a median resolved lifetime of ONE DAY against an open backlog whose
 * median age is six weeks, with 98.7% of resolutions arriving in same-instant batches on
 * still-live assets and `resolution_src: api` on 99.3% of them. That shape has an innocent
 * reading (fleet-wide patch runs) and a damning one: Wiz closes a finding record and issues a
 * NEW id for the same vulnerability on the same asset, and `vulnKey` — which is `id:<node.id>`
 * whenever an id exists, and one always does here — records that as a death and a birth.
 *
 * This tells the two apart. If the same (cve, asset) pair keeps reappearing within a day or
 * two of being "resolved" — or worse, is reborn BEFORE its predecessor's resolved_at — then
 * the half-life on the MTTR page is measuring record churn, not remediation, and it is
 * measuring it optimistically.
 *
 * Run `probeIdentityChurn`. Read-only, like its sibling.
 */
function probeIdentityChurn() {
  var started = Date.now();
  var out = [];
  var say = function (l) { out.push(l); };

  var id = PropertiesService.getScriptProperties().getProperty('LEDGER_SPREADSHEET_ID');
  if (!id) { Logger.log('LEDGER_SPREADSHEET_ID is not set on this project.'); return; }
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName('vuln_ledger');
  if (!sh) { Logger.log('No vuln_ledger tab.'); return; }

  say('IDENTITY CHURN PROBE  ' + new Date().toISOString());
  say('');
  say('project scope in use: WIZ_PROJECT_ID_V2 = ' +
    (PropertiesService.getScriptProperties().getProperty('WIZ_PROJECT_ID_V2') || '(unset)'));
  say('');

  // (cve|asset) -> episodes of that ONE vulnerability on that ONE asset, however many
  // finding ids Wiz spent on it.
  var pairs = {};
  var rows = 0, keyed = 0, reopenedRows = 0, reopenTotal = 0;
  var partial = probeStream(sh, ['vuln_key', 'cve', 'asset_id', 'first_seen', 'resolved_at', 'status', 'reopened_count'], started, function (r) {
    rows++;
    var cve = String(r.cve || '');
    var asset = String(r.asset_id || '');
    if (!cve || !asset) return;
    keyed++;
    var rc = Number(r.reopened_count || 0);
    if (rc > 0) { reopenedRows++; reopenTotal += rc; }
    var k = cve + '|' + asset;
    var list = pairs[k] || (pairs[k] = []);
    list.push({
      f: probeMs(r.first_seen),
      r: probeMs(r.resolved_at),
      open: String(r.status || '').toUpperCase() !== 'RESOLVED',
    });
  });

  // Walk each pair in birth order and look at what happened after every resolution.
  var perPair = probeHist(), gapHist = probeHist();
  var pairCount = 0, multi = 0, resolutions = 0;
  var rebornSameDay = 0, reborn2d = 0, reborn7d = 0, rebornEver = 0, overlapped = 0;
  var pairsOpenAndClosed = 0;

  for (var k in pairs) {
    var list = pairs[k];
    pairCount++;
    probeAdd(perPair, list.length);
    if (list.length > 1) multi++;
    var anyOpen = false, anyClosed = false;
    for (var i = 0; i < list.length; i++) { if (list[i].open) anyOpen = true; else anyClosed = true; }
    if (anyOpen && anyClosed) pairsOpenAndClosed++;

    list.sort(function (a, b) { return (a.f || 0) - (b.f || 0); });
    for (var j = 0; j < list.length; j++) {
      if (list[j].r === null) continue;
      resolutions++;
      // The next record of the SAME vulnerability on the SAME asset, if any.
      var next = j + 1 < list.length ? list[j + 1] : null;
      if (next === null || next.f === null) continue;
      rebornEver++;
      var gapDays = (next.f - list[j].r) / 86400000;
      if (gapDays < 0) overlapped++;      // born before its predecessor was closed
      probeAdd(gapHist, Math.abs(gapDays));
      if (gapDays <= 1) rebornSameDay++;
      if (gapDays <= 2) reborn2d++;
      if (gapDays <= 7) reborn7d++;
    }
  }

  say('LEDGER');
  say('  rows                       ' + rows + (partial ? '   *** PARTIAL: time budget hit ***' : ''));
  say('  rows with cve AND asset    ' + keyed);
  say('  distinct (cve, asset)      ' + pairCount);
  say('  finding records per pair   p50 ' + probeMedianQ(perPair, 0.5) + '  p90 ' + probeMedianQ(perPair, 0.9) + '  max ' + probeMedianQ(perPair, 1));
  say('  pairs with >1 record       ' + probeLine(multi, pairCount));
  say('  pairs both open AND closed ' + probeLine(pairsOpenAndClosed, pairCount));
  say('  rows carrying reopened>0   ' + reopenedRows + '   (total reopens counted: ' + reopenTotal + ')');
  say('');
  say('AFTER A RESOLUTION, DID THE SAME CVE COME BACK ON THE SAME ASSET?   (' + resolutions + ' resolutions)');
  say('  came back at all           ' + probeLine(rebornEver, resolutions));
  say('  came back within 1 day     ' + probeLine(rebornSameDay, resolutions));
  say('  came back within 2 days    ' + probeLine(reborn2d, resolutions));
  say('  came back within 7 days    ' + probeLine(reborn7d, resolutions));
  say('  born BEFORE the old record closed ' + probeLine(overlapped, resolutions));
  say('  median gap                 ' + probeMedian(gapHist) + ' d');
  say('');
  say('  A high "within 1 day" share, and any sizeable overlap, mean Wiz re-issued the');
  say('  finding rather than anybody fixing it: the ledger keys on node.id, so a new id');
  say('  reads as a new vulnerability. The half-life would then be record churn.');
  say('  A low share means the batches are real fleet-wide fixes and the figure stands.');
  say('');
  say('elapsed ' + ((Date.now() - started) / 1000).toFixed(0) + ' s');
  Logger.log(out.join('\n'));
  return out.join('\n');
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

/**
 * PROBE 4 — the last one. Is the one-day half-life real, or is it the churn?
 *
 * Three hypotheses died against the data. Whole assets going away: 0.6%. A fleet rebuilt from
 * fresh images: 0.2% — 99.8% of asset-days lose findings and gain nothing, which is what
 * patching looks like. Left truncation: 1.3% of open rows. What survived is record churn,
 * proven by 5,208 resolutions (10.3%) whose successor was born BEFORE they closed.
 *
 * So the estate really does patch, and it patches in batches of about fifteen findings per
 * asset per instant. The question left is whether the ONE DAY median lifetime belongs to that
 * patching or to the churn — and the ledger can answer it without being re-keyed, by splitting
 * the population the churn cannot touch from the population it defines:
 *
 *   solo      a (cve, asset) pair Wiz only ever issued ONE record for. No re-issue is possible
 *             here, so its lifetime is the estate's real patch latency.
 *   churned   a pair carrying several records. Each record's own lifetime is what the MTTR
 *             page currently measures; the SPAN from the first record's first_seen to the last
 *             record's resolved_at is what it would measure if a re-issue continued the row
 *             instead of starting a new one.
 *
 * If solo lifetimes are ~1 day too, the half-life is real and this register is simply fast. If
 * solo is much longer, the headline is the churn, and the fix is the ledger key: `vulnKey`
 * returns `id:<node.id>` whenever an id exists (lifecycle.ts:34-36), and for OS findings one
 * always does — the hash of (cve|asset|type|cloud|component) it falls back to is exactly the
 * identity a re-issue preserves.
 *
 * Run `probeTrueLifetime`. Read-only, like its siblings, and the last of them.
 */
function probeTrueLifetime() {
  var started = Date.now();
  var out = [];
  var say = function (l) { out.push(l); };

  var id = PropertiesService.getScriptProperties().getProperty('LEDGER_SPREADSHEET_ID');
  if (!id) { Logger.log('LEDGER_SPREADSHEET_ID is not set on this project.'); return; }
  var sh = SpreadsheetApp.openById(id).getSheetByName('vuln_ledger');
  if (!sh) { Logger.log('No vuln_ledger tab.'); return; }

  say('TRUE LIFETIME PROBE  ' + new Date().toISOString());
  say('');

  var pairs = {};
  var partial = probeStream(sh, ['cve', 'asset_id', 'first_seen', 'resolved_at', 'status'], started, function (r) {
    var cve = String(r.cve || ''), aid = String(r.asset_id || '');
    if (!cve || !aid) return;
    var k = cve + '|' + aid;
    (pairs[k] || (pairs[k] = [])).push({
      f: probeMs(r.first_seen),
      r: probeMs(r.resolved_at),
      open: String(r.status || '').toUpperCase() !== 'RESOLVED',
    });
  });

  var solo = probeHist();        // lifetime of a pair Wiz issued exactly one record for
  var perRecord = probeHist();   // lifetime of each record inside a multi-record pair
  var span = probeHist();        // first birth -> last death of a multi-record pair
  var soloPairs = 0, churnedPairs = 0, openPairs = 0, spanPairs = 0;

  for (var k2 in pairs) {
    var list = pairs[k2];
    list.sort(function (a, b) { return (a.f || 0) - (b.f || 0); });
    var anyOpen = false;
    for (var i = 0; i < list.length; i++) if (list[i].open) anyOpen = true;

    if (list.length === 1) {
      soloPairs++;
      if (anyOpen) { openPairs++; continue; }
      if (list[0].f !== null && list[0].r !== null) probeAdd(solo, (list[0].r - list[0].f) / 86400000);
      continue;
    }
    churnedPairs++;
    for (var j = 0; j < list.length; j++) {
      if (list[j].f !== null && list[j].r !== null) probeAdd(perRecord, (list[j].r - list[j].f) / 86400000);
    }
    // The span only means anything once the whole pair has stopped: an open last record is a
    // vulnerability still present, and censoring it as if it had closed is the bias this
    // whole wave exists to refuse.
    if (!anyOpen) {
      var first = list[0].f, last = list[list.length - 1].r;
      if (first !== null && last !== null) { probeAdd(span, (last - first) / 86400000); spanPairs++; }
    }
  }

  say('POPULATIONS');
  say('  pairs with ONE record      ' + soloPairs + '   (of which still open: ' + openPairs + ')');
  say('  pairs with SEVERAL records ' + churnedPairs);
  say('');
  say('LIFETIMES  (p25 / median / p75, days)');
  say('  solo — no re-issue possible      ' + probeMedianQ(solo, 0.25) + ' / ' + probeMedianQ(solo, 0.5) + ' / ' + probeMedianQ(solo, 0.75) + '   n=' + solo.n);
  say('  each record of a churned pair    ' + probeMedianQ(perRecord, 0.25) + ' / ' + probeMedianQ(perRecord, 0.5) + ' / ' + probeMedianQ(perRecord, 0.75) + '   n=' + perRecord.n);
  say('  churned pair, first birth->last death  ' + probeMedianQ(span, 0.25) + ' / ' + probeMedianQ(span, 0.5) + ' / ' + probeMedianQ(span, 0.75) + '   n=' + spanPairs);
  say('');
  say('  Row 1 is what the estate really does. Row 2 is what the MTTR page counts today.');
  say('  Row 3 is what it would count if a re-issued finding continued its row instead of');
  say('  starting a new one. If row 1 is close to row 2, the half-life is honest and this');
  say('  estate is simply fast. If row 1 sits far above it, the headline is the churn.');
  say('');
  say((partial ? '*** PARTIAL: time budget hit ***\n' : '') + 'elapsed ' + ((Date.now() - started) / 1000).toFixed(0) + ' s');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/**
 * PROBE 5 — is the open backlog present, or is it residue?
 *
 * The register fetches CRITICAL only, by choice, and the API holds 2,466 open CRITICAL OS
 * findings. This ledger holds 5,174 open rows. Deduplication does not create rows and churn
 * explains only part of it, so roughly half the backlog may be rows Wiz stopped returning and
 * this ledger never closed.
 *
 * That matters more than it sounds. Probe 4 showed the estate patches in a day, so the only
 * thing on the MTTR page worth leading with is what ISN'T closing — and the open rows sit at a
 * median age of 42 days in a narrow band. If those are rows nobody can see any more, that band
 * is bookkeeping residue, and leading a page with it would be worse than leading with a
 * one-day half-life.
 *
 * Three shapes, and they call for three different answers:
 *
 *   present    last_seen is the newest scan. The finding is really there. Real backlog.
 *   asset dark nothing of that asset has been seen since either. The cold zone already owns
 *              this case and names it "unobserved" rather than resolved.
 *   row stale  the ASSET is still being scanned and this ROW is not. Nothing legitimate looks
 *              like this: the finding is gone from the scanner's answer and the ledger kept it
 *              open. The likely mechanism is a severity re-score out of the fetched set —
 *              resolution-by-disappearance is gated per severity, so a finding that leaves
 *              CRITICAL leaves the register's sight without ever being closed.
 *
 *   churn leftover  a later record of the same (cve, asset) has already been resolved, so this
 *                   open row is a superseded record still counted as live exposure.
 *
 * Run `probeStaleOpen`. Read-only.
 */
function probeStaleOpen() {
  var started = Date.now();
  var out = [];
  var say = function (l) { out.push(l); };

  var id = PropertiesService.getScriptProperties().getProperty('LEDGER_SPREADSHEET_ID');
  if (!id) { Logger.log('LEDGER_SPREADSHEET_ID is not set on this project.'); return; }
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName('vuln_ledger');
  if (!sh) { Logger.log('No vuln_ledger tab.'); return; }

  // The newest scan IS "now" here — never the wall clock. A figure dated by the clock on the
  // wall stops being a function of the ledger, which is the rule the rest of this app keeps.
  var newest = null;
  var scanRows = probeReadAll(ss, 'scans', ['ts']);
  for (var i = 0; i < scanRows.length; i++) {
    var t = probeMs(scanRows[i].ts);
    if (t !== null && (newest === null || t > newest)) newest = t;
  }
  if (newest === null) { Logger.log('No scans on record.'); return; }

  say('STALE OPEN PROBE  ' + new Date().toISOString());
  say('newest scan: ' + new Date(newest).toISOString());
  say('');

  // Pass 1 — per asset: when was ANYTHING of it last seen. Per (cve, asset): the latest
  // resolution, which is what makes an older open row a leftover.
  var assetLastSeen = {}, pairResolved = {};
  var partial1 = probeStream(sh, ['cve', 'asset_id', 'last_seen', 'resolved_at', 'status'], started, function (r) {
    var aid = String(r.asset_id || '');
    var ls = probeMs(r.last_seen);
    if (aid && ls !== null && (!(aid in assetLastSeen) || ls > assetLastSeen[aid])) assetLastSeen[aid] = ls;
    if (String(r.status || '').toUpperCase() === 'RESOLVED') {
      var rs = probeMs(r.resolved_at);
      var k = String(r.cve || '') + '|' + aid;
      if (rs !== null && (!(k in pairResolved) || rs > pairResolved[k])) pairResolved[k] = rs;
    }
  });

  var DAY = 86400000;
  var present = 0, assetDark = 0, rowStale = 0, leftovers = 0, undated = 0, openRows = 0;
  var staleness = probeHist();
  var buckets = { 'same scan': 0, '1-3 d': 0, '3-7 d': 0, '7-30 d': 0, '30+ d': 0 };
  var darkAssets = {}, staleAssets = {};

  var partial2 = probeStream(sh, ['cve', 'asset_id', 'last_seen', 'status', 'severity'], started, function (r) {
    if (String(r.status || '').toUpperCase() === 'RESOLVED') return;
    openRows++;
    var aid = String(r.asset_id || '');
    var ls = probeMs(r.last_seen);
    if (ls === null) { undated++; return; }

    var ageDays = (newest - ls) / DAY;
    probeAdd(staleness, ageDays);
    if (ageDays <= 1) buckets['same scan']++;
    else if (ageDays <= 3) buckets['1-3 d']++;
    else if (ageDays <= 7) buckets['3-7 d']++;
    else if (ageDays <= 30) buckets['7-30 d']++;
    else buckets['30+ d']++;

    var k = String(r.cve || '') + '|' + aid;
    if (pairResolved[k] !== undefined && pairResolved[k] > ls + 60000) leftovers++;

    if (ageDays <= 1) { present++; return; }
    // Stale. Is the asset still being scanned, or did the whole asset go quiet?
    var assetSeen = assetLastSeen[aid];
    if (assetSeen !== undefined && (newest - assetSeen) / DAY <= 1) { rowStale++; staleAssets[aid] = true; }
    else { assetDark++; darkAssets[aid] = true; }
  });

  say('OPEN ROWS  (' + openRows + ' total' + (partial1 || partial2 ? ', *** PARTIAL ***' : '') + ')');
  say('  present at the newest scan ' + probeLine(present, openRows));
  say('  stale, asset dark too      ' + probeLine(assetDark, openRows) + '   assets: ' + Object.keys(darkAssets).length);
  say('  stale, ASSET STILL SCANNED ' + probeLine(rowStale, openRows) + '   assets: ' + Object.keys(staleAssets).length);
  say('  no last_seen at all        ' + undated);
  say('');
  say('  superseded (a later record of the same cve+asset is already resolved)  ' + probeLine(leftovers, openRows));
  say('');
  say('HOW STALE  (newest scan minus last_seen)');
  for (var b in buckets) say('  ' + b + probeGap(b) + probeLine(buckets[b], openRows));
  say('  p50 / p90 / max            ' + probeMedianQ(staleness, 0.5) + ' / ' + probeMedianQ(staleness, 0.9) + ' / ' + probeMedianQ(staleness, 1) + ' d');
  say('');
  say('  "ASSET STILL SCANNED" is the line that matters. Nothing legitimate produces it: the');
  say('  scanner answered about that asset and did not mention this finding, and the ledger');
  say('  kept it open anyway. If it is large, the open backlog is residue, the register has a');
  say('  reconciliation gap to fix before any metric is worth arguing about, and a severity');
  say('  re-score out of the fetched set is the first place to look.');
  say('');
  say('elapsed ' + ((Date.now() - started) / 1000).toFixed(0) + ' s');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** Pads a bucket label so the counts line up under each other. */
function probeGap(label) {
  // `String(label == null ? '' : label)` rather than `label.length`: this is a helper, the Run
  // dropdown offers it like any entry point, and a helper that throws on a hand-run is a
  // helper that sends its reader hunting for a bug in the measurement instead.
  var text = String(label == null ? '' : label);
  var s = '';
  while (text.length + s.length < 27) s += ' ';
  return s;
}
