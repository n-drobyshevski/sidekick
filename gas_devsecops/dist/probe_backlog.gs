/**
 * RUN `dsProbeBacklog`. Everything else here is a helper, and the editor's Run dropdown lists
 * helpers too — picking one runs it with no arguments and fails somewhere unhelpful.
 *
 * ONE-OFF, READ-ONLY. Writes nothing, changes nothing, and comes out once the answer is
 * written down.
 *
 * THE QUESTION. In the OS register the same probe found that half the open backlog — 2,630
 * rows on 113 repositories — had not been in a scan for 42 days, all of them stale by exactly
 * the same amount, which is one event rather than wear. Every age and SLA figure was counting
 * them as live exposure. This asks whether this register has the same blind spot, and how big.
 *
 * WHY IT IS NOT JUST "last_seen IS OLD". Two traps, both of which this register already knows
 * about and this probe has to respect or it will lie:
 *
 *   1. SCANS ARE PER SCOPE. An sca-only sweep says nothing about whether a sast finding is
 *      still there. Each scope is judged against its OWN newest scan.
 *   2. SCANS RECORD WHICH SEVERITIES THEY COVERED. A scan that only asked for CRITICAL cannot
 *      be evidence that a MEDIUM finding has gone away — `sheetsDb.ts` says the severities
 *      column exists for exactly this reason, and resolve-by-disappearance is gated on it. So
 *      a row is judged against the newest scan OF ITS SCOPE THAT COVERED ITS SEVERITY, and a
 *      (scope, severity) pair with no such scan is undecidable and counts as present — never
 *      accuse a repository of vanishing on the strength of a scan that never looked.
 *
 * The three shapes it separates, and they call for three different answers:
 *
 *   present      the row reached its newest covering scan. Real backlog.
 *   repo dark    nothing of that repository has been seen since either. The cold zone already
 *                owns this case and calls it unobserved rather than resolved.
 *   row stale    the REPOSITORY is still being scanned and this ROW is not. Nothing legitimate
 *                looks like this; in the OS register it was 0.2%, and the first place to look
 *                is a severity re-score out of the fetched set.
 */

var DS_PROBE_CHUNK = 5000;
var DS_PROBE_BUDGET_MS = 5 * 60 * 1000; // Apps Script kills the run at 6 minutes.
var DS_PROBE_DAY_CAP = 1000;

function dsProbeBacklog() {
  var started = Date.now();
  var out = [];
  var say = function (l) { out.push(l); };

  var id = PropertiesService.getScriptProperties().getProperty('LEDGER_SPREADSHEET_ID');
  if (!id) { Logger.log('LEDGER_SPREADSHEET_ID is not set on this project.'); return; }
  var ss = SpreadsheetApp.openById(id);
  var led = ss.getSheetByName('finding_ledger');
  if (!led) { Logger.log('No finding_ledger tab.'); return; }

  say('DEVSECOPS BACKLOG PROBE  ' + new Date().toISOString());
  say('spreadsheet: ' + ss.getName());
  say('');

  // ---------------------------------------------------------------- scans, per scope
  // `newest[scope]` is the newest scan of that scope whatever it covered — what "the repository
  // is still being scanned" is judged against. `covering[scope|severity]` is the newest scan of
  // that scope that actually asked for that severity — what an individual ROW is judged against.
  var scans = dsProbeRead(ss, 'scans', ['scan_id', 'ts', 'scope', 'severities', 'sealed']);
  var newest = {}, covering = {}, firstTs = {}, tsByScope = {};
  for (var i = 0; i < scans.length; i++) {
    var s = scans[i];
    var ms = dsProbeMs(s.ts);
    if (ms === null) continue;
    var scope = String(s.scope || '?');
    (tsByScope[scope] || (tsByScope[scope] = [])).push(ms);
    if (firstTs[scope] === undefined || ms < firstTs[scope]) firstTs[scope] = ms;
    if (newest[scope] === undefined || ms > newest[scope].ms) {
      newest[scope] = { ms: ms, scan_id: String(s.scan_id || ''), ts: s.ts };
    }
    // An empty severities cell means the scan asked for everything — the same reading
    // `settingsImpact.ts` gives it ("[] MEANS EVERY SEVERITY").
    var sevs = dsProbeSeverities(s.severities);
    for (var j = 0; j < sevs.length; j++) {
      var ck = scope + '|' + sevs[j];
      if (covering[ck] === undefined || ms > covering[ck].ms) {
        covering[ck] = { ms: ms, scan_id: String(s.scan_id || ''), ts: s.ts };
      }
    }
  }

  say('SCANS');
  for (var sc in newest) {
    var gaps = tsByScope[sc].slice().sort(function (a, b) { return a - b; });
    var deltas = [];
    for (var g = 1; g < gaps.length; g++) deltas.push((gaps[g] - gaps[g - 1]) / 86400000);
    deltas.sort(function (a, b) { return a - b; });
    say('  ' + dsProbePad(sc, 9) + ' scans ' + dsProbePad(String(tsByScope[sc].length), 5) +
      ' watching since ' + new Date(firstTs[sc]).toISOString().slice(0, 10) +
      '  newest ' + new Date(newest[sc].ms).toISOString().slice(0, 10) +
      '  gap p50/max ' + dsProbePick(deltas, 0.5) + '/' + dsProbePick(deltas, 1) + ' d');
  }
  say('');

  // ------------------------------------------------- pass 1: per repo, and the latest closure
  var repoLastSeen = {}, pairResolved = {};
  var partial1 = dsProbeStream(led, ['scope', 'identifier', 'component', 'repo_id', 'last_seen', 'resolved_at', 'status'], started, function (r) {
    var rk = String(r.scope || '') + '|' + String(r.repo_id || '');
    var ls = dsProbeMs(r.last_seen);
    if (ls !== null && (repoLastSeen[rk] === undefined || ls > repoLastSeen[rk])) repoLastSeen[rk] = ls;
    if (String(r.status || '').toUpperCase() === 'RESOLVED') {
      var rs = dsProbeMs(r.resolved_at);
      var pk = rk + '|' + String(r.identifier || '') + '|' + String(r.component || '');
      if (rs !== null && (pairResolved[pk] === undefined || rs > pairResolved[pk])) pairResolved[pk] = rs;
    }
  });

  // ---------------------------------------------------- pass 2: classify every open row
  var DAY = 86400000;
  var tot = {}, undecidable = 0, undated = 0;
  var staleness = {}, darkRepos = {}, staleRepos = {};
  var partial2 = dsProbeStream(led, ['scope', 'severity', 'identifier', 'component', 'repo_id', 'last_seen', 'last_scan_id', 'status'], started, function (r) {
    if (String(r.status || '').toUpperCase() === 'RESOLVED') return;
    var scope = String(r.scope || '?');
    var t = tot[scope] || (tot[scope] = { open: 0, present: 0, dark: 0, stale: 0, superseded: 0 });
    t.open += 1;

    var sev = String(r.severity || '').toUpperCase();
    var cov = covering[scope + '|' + sev];
    if (!cov) {
      // No scan of this scope ever asked for this severity: undecidable, and undecidable
      // counts as present. The alternative is calling a finding gone on the strength of a
      // scan that never looked for it.
      t.present += 1; undecidable += 1; return;
    }
    var ls = dsProbeMs(r.last_seen);
    if (ls === null) { t.present += 1; undated += 1; return; }

    var reaches = String(r.last_scan_id || '')
      ? String(r.last_scan_id) === cov.scan_id
      : ls >= cov.ms;
    if (reaches) { t.present += 1; return; }

    var ageDays = (cov.ms - ls) / DAY;
    dsProbeAdd(staleness[scope] || (staleness[scope] = dsProbeHist()), ageDays);

    var rk = scope + '|' + String(r.repo_id || '');
    var repoSeen = repoLastSeen[rk];
    var repoFresh = repoSeen !== undefined && (newest[scope] !== undefined) && (newest[scope].ms - repoSeen) / DAY <= 1;
    if (repoFresh) { t.stale += 1; staleRepos[rk] = true; } else { t.dark += 1; darkRepos[rk] = true; }

    var pk = rk + '|' + String(r.identifier || '') + '|' + String(r.component || '');
    if (pairResolved[pk] !== undefined && pairResolved[pk] > ls + 60000) t.superseded += 1;
  });

  say('OPEN ROWS BY SCOPE' + (partial1 || partial2 ? '   *** PARTIAL: time budget hit ***' : ''));
  for (var sc2 in tot) {
    var x = tot[sc2];
    say('  ' + dsProbePad(sc2, 9) + ' open ' + dsProbePad(String(x.open), 7) +
      ' present ' + dsProbeShare(x.present, x.open) +
      '  repo dark ' + dsProbeShare(x.dark, x.open) +
      '  row stale ' + dsProbeShare(x.stale, x.open) +
      '  superseded ' + dsProbeShare(x.superseded, x.open));
  }
  say('');
  say('  undecidable (no scan of that scope ever covered that severity): ' + undecidable);
  say('  open rows with no last_seen: ' + undated);
  say('  repositories gone quiet: ' + Object.keys(darkRepos).length +
    '   repositories still scanned but carrying a stale row: ' + Object.keys(staleRepos).length);
  say('');
  say('HOW STALE  (newest covering scan minus last_seen, days)');
  for (var sc3 in staleness) {
    say('  ' + dsProbePad(sc3, 9) + ' p50 ' + dsProbeQ(staleness[sc3], 0.5) +
      '  p90 ' + dsProbeQ(staleness[sc3], 0.9) + '  max ' + dsProbeQ(staleness[sc3], 1) +
      '   n=' + staleness[sc3].n);
  }
  say('');
  say('  One number with no spread — p50 == p90 == max — is one event, not wear. That is what');
  say('  the OS register turned out to have: 113 repositories that all left on the same day.');
  say('');
  say('elapsed ' + ((Date.now() - started) / 1000).toFixed(0) + ' s');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/* ------------------------------------------------------------------ helpers */

function dsProbeStream(sh, wanted, started, fn) {
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return false;
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {};
  for (var w = 0; w < wanted.length; w++) {
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]) === wanted[w]) { idx[wanted[w]] = h; break; }
    }
  }
  for (var start = 2; start <= lastRow; start += DS_PROBE_CHUNK) {
    if (Date.now() - started > DS_PROBE_BUDGET_MS) return true;
    var n = Math.min(DS_PROBE_CHUNK, lastRow - start + 1);
    var vals = sh.getRange(start, 1, n, lastCol).getValues();
    for (var i = 0; i < vals.length; i++) {
      var o = {};
      for (var k in idx) o[k] = vals[i][idx[k]];
      fn(o);
    }
  }
  return false;
}

function dsProbeRead(ss, tab, wanted) {
  var sh = ss.getSheetByName(tab);
  if (!sh) return [];
  var rows = [];
  dsProbeStream(sh, wanted, Date.now(), function (r) { rows.push(r); });
  return rows;
}

/** The severities a scan covered. Blank means every severity — settingsImpact.ts's own rule. */
function dsProbeSeverities(cell) {
  var raw = cell === null || cell === undefined ? '' : String(cell).trim();
  var all = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL', 'UNKNOWN', ''];
  if (!raw || raw === '[]') return all;
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
  var list = parsed && parsed.length !== undefined ? parsed : raw.split(/[,;|]/);
  var outSev = [];
  for (var i = 0; i < list.length; i++) {
    var s = String(list[i]).replace(/["'\[\]\s]/g, '').toUpperCase();
    if (s) outSev.push(s);
  }
  return outSev.length ? outSev : all;
}

function dsProbeMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getTime();
  var t = Date.parse(String(v));
  return isNaN(t) ? null : t;
}

function dsProbeHist() { return { n: 0, bins: {} }; }

function dsProbeAdd(hist, days) {
  if (days === null || isNaN(days)) return;
  var d = Math.floor(days);
  if (d < 0) d = 0;
  if (d > DS_PROBE_DAY_CAP) d = DS_PROBE_DAY_CAP;
  hist.bins[d] = (hist.bins[d] || 0) + 1;
  hist.n++;
}

function dsProbeQ(hist, q) {
  if (!hist || !hist.n) return '—';
  var target = Math.ceil(hist.n * q), seen = 0;
  var keys = Object.keys(hist.bins).map(Number).sort(function (a, b) { return a - b; });
  for (var i = 0; i < keys.length; i++) {
    seen += hist.bins[keys[i]];
    if (seen >= target) return String(keys[i]) + (keys[i] === DS_PROBE_DAY_CAP ? '+' : '');
  }
  return String(keys[keys.length - 1]);
}

function dsProbePick(sorted, q) {
  if (!sorted || !sorted.length) return '—';
  return sorted[Math.floor(q * (sorted.length - 1))].toFixed(1);
}

function dsProbePad(text, width) {
  var s = String(text === null || text === undefined ? '' : text);
  while (s.length < width) s += ' ';
  return s;
}

function dsProbeShare(part, whole) {
  var s = String(part);
  while (s.length < 6) s = ' ' + s;
  return s + (whole ? ' (' + (part / whole * 100).toFixed(1) + '%)' : '');
}
