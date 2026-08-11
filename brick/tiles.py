"""HTML fragments for ``displayHTML``: the surfaces where the *number* is the product.

Pure functions from a value to a string. No Spark, no Plotly, no I/O.

Three things about this layer are not obvious and are load-bearing:

**Every fragment carries its own ``<style>``.** Databricks renders each ``displayHTML`` output in
its own sandboxed iframe. There is no shared stylesheet to define tokens in, no way for one cell
to style another, and no external font or script to link -- so the CSS ships inline with every
fragment. That is the cost of the isolation, and it is worth paying: a KPI band is a handful of
numbers with a label, and no chart library draws one well.

**Register-derived strings are escaped.** A subscription or asset name comes from a cloud tenant
this pipeline does not control, and it lands inside markup. ``escape()`` on the way in is the
whole mitigation, and it is the one genuinely new attack surface this layer introduces.

**The two-token severity rule holds here.** ``config.SEVERITY_COLORS`` is for *marks* -- a dot, a
bar. Any coloured *text* uses the darkened ``figures.SEVERITY_TEXT`` sibling, because the fill
ramp fails 4.5:1 as text on its own pale tint.

Tokens, type scale and spacing come from DESIGN.md via ``gas/src/client/styles.css``, so the
notebooks and the GAS app read as one product.
"""

from __future__ import annotations

import math
from html import escape
from typing import Any, Iterable, Mapping, Optional, Sequence

from config import SEVERITY_ORDER
from figures import SEVERITY_TEXT, STATUS, fmt_duration

# See config.PIPELINE_VERSION: every module in a deployment must come from the same upload.
MODULE_VERSION = "2.1"

FONT = (
    '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, '
    '"Helvetica Neue", sans-serif'
)

DASH = "—"

_CSS = f"""
:root {{
  --ink: #171717; --graphite: #0a0a0a; --page: #ffffff; --surface: #f8f8fa;
  --hairline: #e6e6e9; --text-2: rgba(0,0,0,0.65); --text-3: rgba(0,0,0,0.6);
  --ok: {STATUS["ok"]}; --warn: {STATUS["warn"]}; --bad: {STATUS["bad"]};
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 10px; --radius-xl: 14px;
  --shadow-card: 0 1px 2px 0 rgba(0,0,0,0.05);
}}
.wiz {{
  font: 400 0.875rem/1.5 {FONT}; color: var(--ink); background: var(--page);
  font-feature-settings: "cv02","cv03","cv04","cv11"; padding: 4px 2px 8px;
}}
.wiz .num, .wiz .kpi-value, .wiz .hero-value, .wiz .mini-value, .wiz .cell-count {{
  font-variant-numeric: tabular-nums;
}}
.wiz .label {{
  font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em;
  text-transform: uppercase; color: var(--text-3);
}}
.wiz .hero-value {{ font-size: 2rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; }}
.wiz .hero-src {{ font-size: 12px; color: var(--text-3); margin-top: 2px; }}
.wiz .hero-minis {{
  display: flex; flex-wrap: wrap; gap: 28px; border-top: 1px solid var(--hairline);
  margin-top: 14px; padding-top: 12px;
}}
.wiz .mini-label {{ font-size: 12px; color: var(--text-3); }}
.wiz .mini-value {{ font-size: 18px; font-weight: 600; }}
.wiz .kpi-row {{
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px; margin: 0 0 4px;
}}
.wiz .kpi-card {{
  background: var(--surface); border: 1px solid var(--hairline);
  border-radius: var(--radius-xl); padding: 14px 16px; box-shadow: var(--shadow-card);
}}
.wiz .kpi-value {{ font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; margin-top: 2px; }}
.wiz .kpi-sub {{ font-size: 12px; color: var(--text-3); margin-top: 2px; }}
.wiz .card {{
  background: var(--surface); border: 1px solid var(--hairline);
  border-radius: var(--radius-xl); padding: 16px; box-shadow: var(--shadow-card);
}}
.wiz .chg {{
  font-size: 12px; font-weight: 600; border-radius: var(--radius-sm);
  padding: 1px 6px; margin-left: 6px;
}}
.wiz .chg.up {{ color: var(--bad); background: rgba(185,28,28,0.12); }}
.wiz .chg.down {{ color: var(--ok); background: rgba(21,128,61,0.12); }}
.wiz .chg.flat {{ color: var(--text-3); background: rgba(0,0,0,0.06); }}
.wiz .pill {{
  display: inline-flex; align-items: center; gap: 6px; border-radius: 999px;
  padding: 2px 9px; font-size: 12px; font-weight: 600;
}}
.wiz .pill::before {{
  content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor;
}}
.wiz .pill.ok {{ color: var(--ok); background: rgba(21,128,61,0.12); }}
.wiz .pill.warn {{ color: var(--warn); background: rgba(161,98,7,0.12); }}
.wiz .pill.bad {{ color: var(--bad); background: rgba(185,28,28,0.12); }}
.wiz .pill.neutral {{ color: var(--text-2); background: rgba(0,0,0,0.06); }}
.wiz .sev-dot {{
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  margin-right: 6px; vertical-align: 1px;
}}
.wiz .note {{ font-size: 12px; color: var(--text-3); margin-top: 8px; }}
.wiz table.matrix {{ border-collapse: collapse; font-size: 13px; }}
.wiz table.matrix th {{
  font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--text-3); text-align: left; padding: 8px 14px; border-bottom: 1px solid var(--hairline);
}}
.wiz table.matrix td {{ padding: 10px 14px; border-bottom: 1px solid var(--hairline); vertical-align: top; }}
.wiz table.matrix tr.unclassified td {{ border-top: 2px solid var(--hairline); }}
.wiz .cell-count {{ font-size: 1.25rem; font-weight: 600; }}
.wiz .cell-abbr {{ font-size: 11px; font-weight: 600; color: var(--text-3); margin-left: 6px; }}
.wiz .cell-word {{ font-size: 12px; color: var(--text-3); display: block; margin-top: 2px; }}
.wiz details {{ font-size: 13px; }}
.wiz summary {{ cursor: pointer; font-weight: 600; }}
.wiz dt {{ font-weight: 600; margin-top: 10px; }}
.wiz dd {{ margin: 2px 0 0; color: var(--text-2); }}
/* Nothing here animates. The block is kept so that if anything ever does, the alternative
   already exists rather than being remembered. */
@media (prefers-reduced-motion: reduce) {{
  .wiz *, .wiz *::before, .wiz *::after {{
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }}
}}
"""


def _wrap(body: str) -> str:
    return f"<style>{_CSS}</style><div class=\"wiz\">{body}</div>"


def _num(value, digits: int = 0, suffix: str = "") -> str:
    """A number, thousands-separated and tabular -- or an em dash if there isn't one.

    NULL is ``—``, never ``0``. ``metrics.safe_pct`` goes to some trouble to return NULL for an
    empty denominator; rendering that as a zero throws the distinction away at the last step.
    """
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return DASH
    return f"{float(value):,.{digits}f}{suffix}"


def _esc(value) -> str:
    """Every register-derived string goes through here before it reaches markup."""
    return escape("" if value is None else str(value), quote=True)


# ------------------------------------------------------------------------------- pieces


def delta_badge(delta: Optional[float], *, since: str = "vs 7d ago", inverted: bool = True) -> str:
    """A change chip: ▲/▼ plus the magnitude plus what it is measured against.

    ``inverted`` is the default because the metric this most often decorates is MTTR, where
    **up is bad**. The glyph and the words carry that on their own -- the tint is redundant
    coding, which is the only way it is allowed to mean anything.
    """
    if delta is None or (isinstance(delta, float) and math.isnan(delta)):
        return f'<span class="chg flat">{DASH} {_esc(since)}</span>'
    if abs(delta) < 0.05:
        return f'<span class="chg flat">±0 {_esc(since)}</span>'
    rising = delta > 0
    bad = rising if inverted else not rising
    glyph = "▲" if rising else "▼"
    sign = "+" if rising else "−"
    # Counts are counts. "+2.0 findings" reads as a measurement error rather than two findings.
    magnitude = abs(delta)
    shown = f"{magnitude:,.0f}" if float(magnitude).is_integer() else f"{magnitude:,.1f}"
    return (
        f'<span class="chg {"up" if bad else "down"}">'
        f"{glyph} {sign}{shown} {_esc(since)}</span>"
    )


def status_pill(kind: str, text: str) -> str:
    """OK / warn / bad / neutral, tinted, with a leading dot and the word spelled out."""
    kind = kind if kind in ("ok", "warn", "bad", "neutral") else "neutral"
    return f'<span class="pill {kind}">{_esc(text)}</span>'


def severity_badge(severity: str, text: Optional[str] = None) -> str:
    """A severity as a dot plus its name. Never the name alone in a colour."""
    from config import SEVERITY_COLORS

    fill = SEVERITY_COLORS.get(severity, SEVERITY_COLORS["UNKNOWN"])
    ink = SEVERITY_TEXT.get(severity, SEVERITY_TEXT["UNKNOWN"])
    label = text if text is not None else severity.title()
    return (
        f'<span style="color:{ink};font-weight:600">'
        f'<span class="sev-dot" style="background:{fill}"></span>{_esc(label)}</span>'
    )


# -------------------------------------------------------------------------------- heros


def hero(
    *,
    label: str,
    value: Optional[float],
    lower_bound: Optional[float] = None,
    unit: str = "days",
    secondary: Optional[Mapping[str, Any]] = None,
    badge: str = "",
    source: str = "",
    minis: Sequence[Mapping[str, Any]] = (),
    scale: str = "2rem",
) -> str:
    """The page hero: one number, at most, at the hero step.

    A NULL Kaplan-Meier median is not a missing value, it is a *finding*: survival never fell to
    50%, which means more than half the register is still open. It renders as ``> 90d`` against
    ``km_median_lower_bound`` with the reason spelled out, exactly as GAS's ``fmtKmMedian`` does.
    Blank would be a lie of omission and ``0`` would be a lie outright.
    """
    if value is None or (isinstance(value, float) and math.isnan(value)):
        if lower_bound is not None and not (
            isinstance(lower_bound, float) and math.isnan(lower_bound)
        ):
            shown = f"&gt; {fmt_duration(lower_bound)}"
            note = "over half still open, so the median is a floor"
        else:
            shown, note = DASH, "nothing resolved yet"
        source = f"{note}. {source}" if source else note
    else:
        shown = fmt_duration(value) if unit == "days" else _num(value, 1, unit)

    second = ""
    if secondary:
        second = (
            '<div style="margin-top:10px">'
            f'<div class="label">{_esc(secondary["label"])}</div>'
            f'<div class="kpi-value num">{secondary["value"]}</div></div>'
        )
    mini_html = ""
    if minis:
        cells = "".join(
            f'<div><div class="mini-label">{_esc(m["label"])}</div>'
            f'<div class="mini-value num">{m["value"]}</div></div>'
            for m in minis
        )
        mini_html = f'<div class="hero-minis">{cells}</div>'

    return _wrap(
        f'<div class="label">{_esc(label)}</div>'
        f'<div class="hero-value num" style="font-size:{scale}">{shown}{badge}</div>'
        f'<div class="hero-src">{_esc(source)}</div>'
        f"{second}{mini_html}"
    )


def kpi_row(cards: Sequence[Mapping[str, Any]]) -> str:
    """A band of KPI cards at the 1.5rem display step.

    Not the hero step: DESIGN.md allows one hero value per page, and three tiles at 2rem is
    three heroes competing with each other and with the actual headline.
    """
    html = "".join(
        f'<div class="kpi-card"><div class="label">{_esc(c["label"])}</div>'
        f'<div class="kpi-value num">{c["value"]}{c.get("chip", "")}</div>'
        f'<div class="kpi-sub">{_esc(c.get("sub", ""))}</div></div>'
        for c in cards
    )
    return _wrap(f'<div class="kpi-row">{html}</div>')


def severity_tiles(rows: Iterable[Mapping[str, Any]], *, sub: str = "") -> str:
    """One tile per severity: the count over a dot plus the Title-case name.

    A zero is shown, not hidden. "No criticals" is the single most reassuring thing this page
    can say and it only says it if the tile is there to say it.
    """
    from config import SEVERITY_COLORS

    order = {sev: i for i, sev in enumerate(SEVERITY_ORDER)}
    cards = []
    for row in sorted(rows, key=lambda r: order.get(r["severity"], 99)):
        sev = row["severity"]
        fill = SEVERITY_COLORS.get(sev, SEVERITY_COLORS["UNKNOWN"])
        cards.append(
            f'<div class="kpi-card"><div class="kpi-value num">{_num(row.get("open"))}</div>'
            f'<div class="kpi-sub"><span class="sev-dot" style="background:{fill}"></span>'
            f"{_esc(sev.title())}</div></div>"
        )
    note = f'<div class="note">{_esc(sub)}</div>' if sub else ""
    return _wrap(f'<div class="kpi-row">{"".join(cards)}</div>{note}')


def stat_cards(rows: Iterable[Mapping[str, Any]]) -> str:
    """Severity breakdown with a movement chip -- GAS's ``.stat-card`` list.

    The chip is *not* inverted here: more open findings is worse, so a rise is red for the same
    reason a rising MTTR is, and it says so in words either way.
    """
    from config import SEVERITY_COLORS

    order = {sev: i for i, sev in enumerate(SEVERITY_ORDER)}
    lines = []
    for row in sorted(rows, key=lambda r: order.get(r["severity"], 99)):
        sev = row["severity"]
        fill = SEVERITY_COLORS.get(sev, SEVERITY_COLORS["UNKNOWN"])
        resolved, total = row.get("resolved"), row.get("total")
        lines.append(
            '<div style="display:flex;align-items:baseline;gap:12px;padding:8px 0;'
            'border-bottom:1px solid var(--hairline)">'
            f'<div style="flex:1"><span class="sev-dot" style="background:{fill}"></span>'
            f'{_esc(sev.title())}</div>'
            f'<div class="num" style="font-size:18px;font-weight:600">{_num(row.get("open"))}'
            f'{delta_badge(row.get("delta_open"), since="vs last scan", inverted=True)}</div>'
            f'<div class="kpi-sub" style="width:190px;text-align:right">'
            f"{_num(resolved)} resolved · {_num(total)} tracked</div></div>"
        )
    return _wrap(f'<div class="card">{"".join(lines)}</div>')


def scan_zone(
    *,
    scan_ts: Any,
    scan_id: str,
    scope: str,
    severities: str,
    total: Optional[int],
    age_days: Optional[float],
    stale_after_days: float = 2.0,
) -> str:
    """What was scanned, when, and whether that is recent enough to trust.

    PRODUCT.md's fifth principle in one strip. Every number on every page is as old as this
    line says it is, so it goes at the top of every notebook rather than in a footnote.
    """
    fresh = age_days is not None and age_days <= stale_after_days
    pill = (
        status_pill("ok", f"{fmt_duration(age_days)} old")
        if fresh
        else status_pill("warn", f"{fmt_duration(age_days)} old" if age_days is not None else "age unknown")
    )
    return _wrap(
        '<div class="card" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center">'
        f'<div><div class="label">Last scan</div>'
        f'<div class="num" style="font-weight:600">{_esc(scan_ts)}</div></div>'
        f'<div><div class="label">Scope</div><div>{_esc(scope)} · {_esc(severities)}</div></div>'
        f'<div><div class="label">Findings</div><div class="num">{_num(total)}</div></div>'
        f'<div><div class="label">Scan id</div><div class="num">{_esc(scan_id)}</div></div>'
        f"<div>{pill}</div></div>"
    )


#: What a page says when the register has never been scanned. Named so the wording is in one
#: place: every notebook opens with this strip, so seven of them would otherwise each invent a
#: sentence for the same state.
NO_SCAN_YET = (
    "No scan data yet. Run the pipeline (the launcher notebook, or run_pipeline.main) to "
    "populate the scans table."
)


def scan_zone_from(row) -> str:
    """``scan_zone`` for a row that might not exist -- the form every notebook should call.

    ``panels.last_scan(...).first()`` returns ``None`` against an empty scans table, and the
    obvious cell -- ``scan_zone(**last_scan(...).first().asDict())`` -- then dies on
    ``AttributeError: 'NoneType' object has no attribute 'asDict'`` in the *first* cell of the
    page. A reader who has just deployed the notebooks and not yet run a scan is exactly the
    person who cannot tell that apart from a broken install, so the empty register gets a
    sentence rather than a traceback.

    Every page's opening cell goes through here for that reason: the state is normal, it is
    reachable on any fresh deployment, and it is not the notebook's job to re-say so seven
    times.
    """
    data = _row(row)
    if not data:
        return note(NO_SCAN_YET, kind="warn")
    return scan_zone(**data)


# ---------------------------------------------------------------------- program surfaces


#: The confusion matrix in plain English. GAS's wording, kept verbatim: TP/FP/FN/TN are
#: precise and mean nothing to a reader who has not just read the methodology panel.
MATRIX_WORDS = {
    "tp": "Fixed, and it mattered",
    "fp": "Fixed, but low risk",
    "fn": "High risk, still open",
    "tn": "Correctly deprioritized",
    "unknown_remediated": "Unclassified, remediated",
    "unknown_open": "Unclassified, still open",
}


def matrix(row: Mapping[str, Any]) -> str:
    """What the remediation effort landed on.

    **Deliberately uncoloured.** A red-washed "high risk, still open" cell would be exactly the
    security-vendor theatre PRODUCT.md names as an anti-reference, and it would make the other
    three cells unreadable by comparison. The number and the sentence carry it.

    The unclassified row sits below a rule rather than inside the matrix, because a finding
    whose exploit signal was never captured is not a fifth quadrant -- it is a population that
    left both rates, and both of the published bounds are what it could do to them.
    """

    def cell(key: str) -> str:
        return (
            f'<span class="cell-count num">{_num(row.get(key))}</span>'
            f'<span class="cell-abbr">{key.upper() if len(key) == 2 else ""}</span>'
            f'<span class="cell-word">{MATRIX_WORDS[key]}</span>'
        )

    return _wrap(
        '<table class="matrix"><thead><tr><th></th><th>Remediated</th><th>Still open</th>'
        "<th>Total</th></tr></thead><tbody>"
        f"<tr><td><strong>High risk</strong></td><td>{cell('tp')}</td><td>{cell('fn')}</td>"
        f'<td class="num">{_num(row.get("high_risk"))}</td></tr>'
        f"<tr><td><strong>Not high risk</strong></td><td>{cell('fp')}</td><td>{cell('tn')}</td>"
        f'<td class="num">{_num(row.get("not_high_risk"))}</td></tr>'
        f'<tr class="unclassified"><td><strong>No captured signal</strong></td>'
        f"<td>{cell('unknown_remediated')}</td><td>{cell('unknown_open')}</td>"
        f'<td class="num">{_num(row.get("unknown"))}</td></tr>'
        "</tbody></table>"
        '<div class="note">Unclassified findings are excluded from coverage and efficiency and '
        "reported as the published range beside each rate. They are not counted as low risk: "
        "a signal nobody captured is not evidence of safety.</div>"
    )


VERDICTS = {
    "gaining": ("ok", "▲ Gaining ground"),
    "keeping-up": ("neutral", "= Keeping up"),
    "falling-behind": ("bad", "▼ Falling behind"),
}


def verdict_pill(verdict: Optional[str]) -> str:
    """Net capacity as a word and a glyph, tinted. Never the tint alone."""
    kind, text = VERDICTS.get(verdict or "", ("neutral", DASH))
    return status_pill(kind, text)


def rule_card(sentence: str, clauses: Sequence[Mapping[str, Any]], *, signal_coverage=None) -> str:
    """How "high risk" is decided, and how much of the register the rule could even see."""
    items = "".join(
        f'<li>{_esc(c["text"])} — <span class="num">{_num(c.get("fired"))}</span> fired, '
        f'<span class="num">{_num(c.get("missing"))}</span> never captured</li>'
        for c in clauses
    )
    warn = ""
    if signal_coverage is not None and not (
        isinstance(signal_coverage, float) and math.isnan(signal_coverage)
    ) and signal_coverage < 80:
        warn = (
            f'<div class="note">'
            f'{status_pill("warn", f"{100 - signal_coverage:.0f}% unclassified")} '
            "Both rates are computed over the classified population only.</div>"
        )
    return _wrap(
        f'<div class="card">A finding is high risk when <strong>{_esc(sentence)}</strong>.'
        f'<ul style="margin:10px 0 0;padding-left:18px">{items}</ul>'
        '<div class="note">The clauses overlap; they do not sum to the any-of total.</div>'
        f"{warn}</div>"
    )


def methodology(entries: Sequence[Mapping[str, str]], *, summary: str) -> str:
    """A collapsed ``<details>`` restating each formula in the register's own terms.

    Collapsed rather than absent, and prose rather than a link: a figure someone might put in
    front of an auditor has to be reproducible from the page it appears on.
    """
    body = "".join(
        f'<dt>{_esc(e["term"])}</dt><dd>{_esc(e["definition"])}</dd>' for e in entries
    )
    return _wrap(
        f'<div class="card"><details><summary>{_esc(summary)}</summary>'
        f"<dl>{body}</dl></details></div>"
    )


def note(text: str, *, kind: str = "") -> str:
    """A framing or honest-state line. The place where the page says what it cannot do."""
    pill = f"{status_pill(kind, kind)} " if kind else ""
    return _wrap(f'<div class="card"><div style="font-size:13px">{pill}{_esc(text)}</div></div>')


# ------------------------------------------------------------------- page-shaped composites
#
# One call per notebook cell is the rule, and these are what make it true: a cell hands over
# the row (or rows) a panel returned and gets the finished fragment back. The arithmetic and
# the wording live here, where a test can reach them, rather than in a notebook where nothing
# can.


def _row(row) -> Mapping[str, Any]:
    """A Spark ``Row``, a mapping, or ``None`` -- as a plain dict."""
    if row is None:
        return {}
    return row.asDict() if hasattr(row, "asDict") else dict(row)


def posture_hero(posture, delta=None) -> str:
    """Security posture: the KM median, and whether it moved the wrong way this week."""
    p, d = _row(posture), _row(delta)
    tracked, resolved, open_ = p.get("tracked"), p.get("resolved"), p.get("open")
    return hero(
        label="Median MTTR (Kaplan–Meier)",
        value=p.get("km_median"),
        lower_bound=p.get("km_median_lower_bound"),
        # The one deliberate exception to the 2rem hero step, and it has a precedent:
        # `.exec-hero-value` in gas/src/client/styles.css uses exactly this clamp for exactly
        # this page. It is still one hero value.
        scale="clamp(2.5rem, 6vw, 4rem)",
        badge=delta_badge(d.get("delta")) if d else "",
        source=(
            f"{_num(tracked)} tracked lifecycle(s) · {_num(resolved)} resolved · "
            f"{_num(open_)} open"
        ),
    )


def mttr_hero(headline, extras=None) -> str:
    """MTTR & SLA: both clocks, then the four figures that qualify them.

    ``MTTR p90`` is the naive percentile over closed lifecycles and says so. A Kaplan-Meier p90
    would be more correct and almost always NULL -- survival rarely falls to 10% -- and a tile
    that is usually an em dash teaches people to stop reading the row.
    """
    h, e = _row(headline), _row(extras)
    return hero(
        label="Median MTTR (Kaplan–Meier)",
        value=h.get("km_median"),
        lower_bound=h.get("km_median_lower_bound"),
        secondary={
            "label": "Median (naive, closed)",
            "value": fmt_duration(h.get("mttr_median")),
        },
        source=(
            f"{_num(h.get('tracked'))} tracked lifecycle(s) · {_num(h.get('resolved'))} "
            f"resolved ({_num(h.get('resolved_api'))} by the API, "
            f"{_num(h.get('resolved_disappeared'))} inferred from disappearance) · "
            f"{_num(h.get('open'))} open"
        ),
        minis=[
            {"label": "In SLA (of resolved)", "value": _num(h.get("sla_pct"), 1, "%")},
            {"label": "Open past SLA", "value": _num(e.get("open_past_sla"))},
            {"label": "MTTR p90 (closed only)", "value": fmt_duration(e.get("mttr_p90"))},
            {"label": "Open age p90", "value": fmt_duration(h.get("open_age_p90"))},
        ],
    )


def program_hero(headline) -> str:
    """Program performance: coverage and efficiency, each with the width of its own doubt."""
    h = _row(headline)
    ranges = (
        f"{_num(h.get('coverage_lo'), 1)}–{_num(h.get('coverage_hi'), 1)}%"
    )
    return hero(
        label="Remediation coverage",
        value=h.get("coverage_pct"),
        unit="%",
        secondary={
            "label": "Efficiency",
            "value": (
                f"{_num(h.get('efficiency_pct'), 1, '%')}"
                f'<span class="kpi-sub">{_num(h.get("efficiency_lo"), 1)}–'
                f'{_num(h.get("efficiency_hi"), 1)}%</span>'
            ),
        },
        source=(
            f"{ranges} · {_num(h.get('total'))} tracked · {_num(h.get('classified'))} "
            f"classified · {_num(h.get('unknown'))} with no captured signal"
        ),
        minis=[
            {"label": "High risk, still open", "value": _num(h.get("fn"))},
            {"label": "High risk, remediated", "value": _num(h.get("tp"))},
            {
                "label": "Monthly close rate",
                "value": (
                    f"{_num(h.get('mmcr_mean'), 1, '%')}"
                    f'<span class="kpi-sub">1 in {_num(h.get("one_in_n"), 1)}</span>'
                ),
            },
            {"label": "Net capacity", "value": verdict_pill(h.get("overall_verdict"))},
        ],
    )


def program_hero_value(headline) -> str:
    """``program_hero``'s coverage figure is a percentage, not a duration."""
    return _num(_row(headline).get("coverage_pct"), 1, "%")


def register_kpis(totals) -> str:
    """Tracked / open / resolved, at the 1.5rem display step -- not three heroes."""
    t = _row(totals)
    return kpi_row(
        [
            {
                "label": "Tracked lifecycles",
                "value": _num(t.get("tracked")),
                "sub": "one row per vulnerability, across every scan",
            },
            {"label": "Open", "value": _num(t.get("open")), "sub": "awaiting remediation"},
            {"label": "Resolved", "value": _num(t.get("resolved")), "sub": "closed to date"},
        ]
    )


def history_kpis(all_time) -> str:
    """The register as a whole. All four figures come off the ledger, so they share a
    population -- the published OVERALL row could not, because a read-time severity filter
    cannot re-derive an aggregate the pipeline computed once."""
    a = _row(all_time)
    return kpi_row(
        [
            {"label": "Tracked (all-time)", "value": _num(a.get("tracked"))},
            {"label": "Currently open", "value": _num(a.get("open"))},
            {"label": "Resolved all-time", "value": _num(a.get("resolved"))},
            {
                "label": "Saved scans",
                "value": _num(a.get("scans")),
                "sub": f"first {_esc(a.get('first_scan_ts'))}",
            },
        ]
    )


def exploit_kpis(signals) -> str:
    """Exploitability over open lifecycles, each tile carrying what was never captured.

    The fourth tile is GAS's Internet-exposed tile, rendered the way GAS renders it when its own
    exposure flag is unknown. brick does not ingest exposure at all, so "not captured" is the
    true answer and shipping three tiles instead would quietly change the question.
    """
    s = _row(signals)
    return kpi_row(
        [
            {
                "label": "CISA KEV",
                "value": _num(s.get("kev")),
                "sub": f"known exploited · {_num(s.get('kev_missing'))} never captured",
            },
            {
                "label": "Exploit available",
                "value": _num(s.get("exploit")),
                "sub": f"public exploit exists · {_num(s.get('exploit_missing'))} never captured",
            },
            {
                "label": "EPSS ≥ 10%",
                "value": _num(s.get("high_epss")),
                "sub": f"predicted exploitation · {_num(s.get('epss_missing'))} never captured",
            },
            {
                "label": "Internet-exposed",
                "value": DASH,
                "sub": "not captured — brick does not ingest exposure",
            },
        ]
    )


def movement_minis(movement) -> str:
    """What moved since the previous scan. Before there is a previous scan, it says so."""
    m = _row(movement)
    if not m.get("has_previous"):
        return note("Movement appears once there is a previous scan to compare against.")
    return kpi_row(
        [
            {"label": "New", "value": _num(m.get("new_count")), "sub": "first seen in this scan"},
            {
                "label": "Newly resolved",
                "value": _num(m.get("resolved_count")),
                "sub": "closed since the previous scan",
            },
            {
                "label": "Reopened",
                "value": _num(m.get("reopened_count")),
                "sub": "back after being resolved",
            },
            {
                "label": "Persisting",
                "value": _num(m.get("persisting")),
                "sub": "open since an earlier scan",
            },
        ]
    )
