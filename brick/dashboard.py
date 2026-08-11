"""Generate a Databricks AI/BI dashboard (``.lvdash.json``) over the gold tables.

Overview first, then drill down: a page of counter tiles that answers "how are we doing", and
two detail pages for the parts worth opening up. Cross-filtering does the rest -- clicking a
severity in any chart re-filters every other widget on the same dataset.

WHY THIS IS GENERATED RATHER THAN CHECKED IN AS A STATIC FILE
-------------------------------------------------------------
Two reasons, and the second is the important one:

1. Dataset SQL has to name ``catalog.schema.prefix`` tables, which are run parameters. A static
   file would be correct for exactly one deployment.
2. The ``.lvdash.json`` serialization is **not publicly documented** -- Databricks' guidance is
   "export one of your own dashboards to learn the format". The schema below was reconstructed
   from two real exported dashboards, so it is evidence-based, but nothing here can be rendered
   or imported from a test suite. Generating the document means the parts that *can* be checked
   -- dataset references resolving, fields existing, widgets not overlapping, SQL actually
   running -- become ordinary unit tests instead of a surprise at import time. See
   ``tests/test_dashboard.py``.

THE SCHEMA, as verified from those exports::

    {"datasets": [...], "pages": [...]}
    dataset  {"name", "displayName", "query"}
    page     {"name", "displayName", "layout": [{"widget", "position"}]}
    position {"x", "y", "width", "height"}        -- the grid is 6 columns wide
    widget   {"name", "queries": [{"name", "query": {"datasetName", "fields", "disaggregated"}}],
              "spec": {...}}

Markdown/text widgets are deliberately absent: their spec is the one piece that could not be
verified, and a single wrong key rejects the whole document. Section context rides in
``frame.title`` / ``frame.description``, which is verified.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional

from config import (
    POPULATION_ALL,
    POPULATION_HIGH_RISK,
    SEVERITY_COLORS,
    SEVERITY_ORDER,
)

GRID_COLUMNS = 6
OVERALL = "OVERALL"

# The dimension the detail pages break severity down by. Subscriptions map to accounts and so to
# owning teams; asset_name is far too high-cardinality to chart. One constant to change.
BREAKDOWN_COLUMN = "subscription_name"
BREAKDOWN_LABEL = "Subscription"


def _id(label: str) -> str:
    """A stable id from a human label.

    Deterministic on purpose: regenerating an unchanged dashboard produces a byte-identical
    file, so a diff means a real change rather than a fresh batch of random ids.
    """
    return hashlib.sha1(label.encode("utf-8")).hexdigest()[:8]


# ------------------------------------------------------------------------------ datasets


def _dataset(label: str, query: str) -> Dict[str, Any]:
    return {"name": _id(label), "displayName": label, "query": query.strip()}


def _latest_scan(table: str) -> str:
    """Pin a dataset to the most recent run. The gold tables are appended, so without this
    every chart would blend every scan that has ever happened."""
    return f"scan_id = (SELECT max_by(scan_id, scan_ts) FROM {table})"


def datasets(tables) -> List[Dict[str, Any]]:
    mttr, program, capacity, sensitivity, silver = (
        tables.mttr,
        tables.program,
        tables.capacity,
        tables.sensitivity,
        tables.silver,
    )
    severity_order = ", ".join(f"'{s}'" for s in SEVERITY_ORDER)

    return [
        # One row. The overview tiles all read from here, so they cannot disagree with each other.
        _dataset(
            "overview",
            f"""
SELECT m.km_median,
       m.km_median_lower_bound,
       m.sla_pct,
       m.resolved,
       m.open,
       p.coverage_pct,
       p.efficiency_pct,
       p.prevalence_pct,
       p.signal_coverage_pct,
       c.overall_verdict,
       c.mmcr_mean,
       m.scan_ts
FROM (SELECT * FROM {mttr} WHERE {_latest_scan(mttr)} AND severity = '{OVERALL}') m
JOIN (SELECT * FROM {program} WHERE {_latest_scan(program)} AND severity = '{OVERALL}') p
  ON m.scan_id = p.scan_id
LEFT JOIN (SELECT DISTINCT scan_id, overall_verdict, mmcr_mean
           FROM {capacity}
           WHERE {_latest_scan(capacity)} AND population = '{POPULATION_ALL}') c
  ON m.scan_id = c.scan_id
""",
        ),
        _dataset(
            "mttr_by_severity",
            f"""
SELECT severity,
       km_median,
       km_median_lower_bound,
       km_rmst,
       mttr_median,
       snap_km_median,
       sla_target,
       sla_pct,
       resolved,
       resolved_api,
       resolved_disappeared,
       open,
       open_age_p50,
       open_age_p90,
       array_position(array({severity_order}), severity) AS severity_rank
FROM {mttr}
WHERE {_latest_scan(mttr)} AND severity <> '{OVERALL}'
""",
        ),
        _dataset(
            "program_by_severity",
            f"""
SELECT severity,
       coverage_pct,
       coverage_lo,
       coverage_hi,
       efficiency_pct,
       efficiency_lo,
       efficiency_hi,
       prevalence_pct,
       signal_coverage_pct,
       high_risk,
       remediated,
       open,
       unknown,
       array_position(array({severity_order}), severity) AS severity_rank
FROM {program}
WHERE {_latest_scan(program)} AND severity <> '{OVERALL}'
""",
        ),
        # Every capacity dataset filters on `population`. The table carries both the
        # all-findings backlog and the high-risk net flow P2P v3 defines, stacked -- an
        # unfiltered read returns each month twice and silently doubles every count.
        _dataset(
            "capacity_months",
            f"""
SELECT month, opened, closed, closed_observed, open_at_start, mmcr, net, net_pct, verdict,
       partial, reconstructed
FROM {capacity}
WHERE {_latest_scan(capacity)} AND population = '{POPULATION_ALL}'
ORDER BY month
""",
        ),
        # The same months, minus the ones that predate the first scan. Those are reconstructed
        # from the API's own dates rather than watched by us, and a bar chart cannot say so --
        # every bar looks equally measured. Plotting them would show a confident history of
        # throughput nobody observed, which is the same failure as drawing a NULL as a zero.
        # The table above keeps every month and flags them instead.
        _dataset(
            "capacity_observed_months",
            f"""
SELECT month, opened, closed, closed_observed, open_at_start, mmcr, net, net_pct, verdict,
       partial
FROM {capacity}
WHERE {_latest_scan(capacity)} AND NOT reconstructed
  AND population = '{POPULATION_ALL}'
ORDER BY month
""",
        ),
        # The same months over the high-risk population only -- the one P2P v3 defines net
        # remediation capacity over, and the one that answers "are we closing high risk faster
        # than it arrives" rather than "how much of the backlog moves". Kept as its own dataset
        # rather than a series on the chart above, because the two populations have their own
        # backlogs and their own month grids: they are not two measurements of one thing.
        _dataset(
            "capacity_high_risk_months",
            f"""
SELECT month, opened, closed, open_at_start, mmcr, net, net_pct, verdict, partial
FROM {capacity}
WHERE {_latest_scan(capacity)} AND NOT reconstructed
  AND population = '{POPULATION_HIGH_RISK}'
ORDER BY month
""",
        ),
        # How much of the headline is the rule rather than the register. Not a strategy
        # comparison -- every subset is scored against itself, so none of them can be "wrong".
        _dataset(
            "rule_sensitivity",
            f"""
SELECT rule_label,
       rule_sentence,
       active,
       coverage_pct,
       efficiency_pct,
       prevalence_pct,
       signal_coverage_pct,
       high_risk,
       unknown
FROM {sensitivity}
WHERE {_latest_scan(sensitivity)}
ORDER BY active DESC, rule_label
""",
        ),
        # The second dimension. Kept to counts and rates that survive aggregation -- a mean of
        # per-severity medians would be meaningless, so it is deliberately not here.
        _dataset(
            "by_subscription",
            f"""
SELECT coalesce({BREAKDOWN_COLUMN}, '(none)') AS {BREAKDOWN_COLUMN},
       severity,
       count(*)                                             AS findings,
       sum(CASE WHEN is_open THEN 1 ELSE 0 END)             AS open_findings,
       sum(CASE WHEN risk_class = 'high' THEN 1 ELSE 0 END) AS high_risk,
       sum(CASE WHEN risk_class = 'unknown' THEN 1 ELSE 0 END) AS unclassified,
       max(age_days)                                        AS oldest_open_days,
       array_position(array({severity_order}), severity)    AS severity_rank
FROM {silver}
WHERE {_latest_scan(silver)}
GROUP BY 1, 2
""",
        ),
        # Every scan, not just the latest -- this one is the trend.
        _dataset(
            "mttr_trend",
            f"""
SELECT scan_ts, km_median, sla_pct, resolved, open
FROM {mttr}
WHERE severity = '{OVERALL}'
ORDER BY scan_ts
""",
        ),
    ]


# ------------------------------------------------------------------------------- widgets


def _query(dataset_label: str, fields: Dict[str, str], *, disaggregated: bool = False,
           name: str = "main_query") -> Dict[str, Any]:
    """``fields`` maps the field name the encodings refer to -> its SQL expression."""
    return {
        "name": name,
        "query": {
            "datasetName": _id(dataset_label),
            "fields": [{"name": n, "expression": e} for n, e in fields.items()],
            "disaggregated": disaggregated,
        },
    }


def _frame(title: str, description: str = "") -> Dict[str, Any]:
    frame: Dict[str, Any] = {"title": title, "showTitle": True}
    if description:
        # The only place methodology can live: text widgets are unverified schema.
        frame["showDescription"] = True
        frame["description"] = description
    return frame


def _severity_scale() -> Dict[str, Any]:
    """Severity colours shared with the matplotlib charts and the Streamlit app.

    The ramp fails a categorical colourblind check (measured; see config.SEVERITY_COLORS), so a
    widget using it must also carry `severity` as an axis or column. `_bar` enforces that by
    construction -- colour is never the only signal.
    """
    return {
        "type": "categorical",
        "mappings": [
            {"value": sev, "color": SEVERITY_COLORS[sev]}
            for sev in SEVERITY_ORDER
            if sev in SEVERITY_COLORS
        ],
    }


def _counter(label: str, dataset_label: str, field: str, expression: str, title: str,
             description: str = "") -> Dict[str, Any]:
    return {
        "name": _id(label),
        "queries": [_query(dataset_label, {field: expression})],
        "spec": {
            "version": 2,
            "widgetType": "counter",
            "encodings": {"value": {"fieldName": field, "displayName": title}},
            "frame": _frame(title, description),
        },
    }


def _bar(label: str, dataset_label: str, *, x: str, x_expr: str, y: str, y_expr: str,
         title: str, description: str = "", color_by_severity: bool = False,
         x_scale: str = "categorical", extra_fields: Optional[Dict[str, str]] = None,
         horizontal: bool = False) -> Dict[str, Any]:
    fields = {x: x_expr, y: y_expr}
    fields.update(extra_fields or {})
    encodings: Dict[str, Any] = {
        "x": {"fieldName": x, "scale": {"type": x_scale}, "displayName": x},
        "y": {"fieldName": y, "scale": {"type": "quantitative"}, "displayName": y},
    }
    if color_by_severity:
        # Only legitimate when severity is already on an axis -- otherwise colour would be
        # carrying identity on its own, which this palette cannot do.
        assert "severity" in fields, "severity must be a field before it can be a colour"
        encodings["color"] = {
            "fieldName": "severity",
            "scale": _severity_scale(),
            "displayName": "severity",
        }
    return {
        "name": _id(label),
        "queries": [_query(dataset_label, fields)],
        "spec": {
            "version": 3,
            "widgetType": "bar" if not horizontal else "bar",
            "encodings": encodings,
            "frame": _frame(title, description),
        },
    }


def _line(label: str, dataset_label: str, *, x: str, x_expr: str, y: str, y_expr: str,
          title: str, description: str = "") -> Dict[str, Any]:
    return {
        "name": _id(label),
        "queries": [_query(dataset_label, {x: x_expr, y: y_expr})],
        "spec": {
            "version": 3,
            "widgetType": "line",
            "encodings": {
                "x": {"fieldName": x, "scale": {"type": "temporal"}, "displayName": x},
                "y": {"fieldName": y, "scale": {"type": "quantitative"}, "displayName": y},
            },
            "frame": _frame(title, description),
        },
    }


def _table(label: str, dataset_label: str, columns: List[str], title: str,
           description: str = "") -> Dict[str, Any]:
    fields = {c: f"`{c}`" for c in columns}
    return {
        "name": _id(label),
        "queries": [_query(dataset_label, fields, disaggregated=True)],
        "spec": {
            "version": 1,
            "widgetType": "table",
            "encodings": {
                "columns": [
                    {"fieldName": c, "displayName": c, "booleanValues": ["false", "true"]}
                    for c in columns
                ]
            },
            "frame": _frame(title, description),
        },
    }


def _severity_filter(label: str, dataset_label: str, title: str = "Severity") -> Dict[str, Any]:
    query_name = "filter_query"
    return {
        "name": _id(label),
        "queries": [_query(dataset_label, {"severity": "`severity`"}, name=query_name)],
        "spec": {
            "version": 2,
            "widgetType": "filter-single-select",
            "encodings": {
                "fields": [{"fieldName": "severity", "displayName": title,
                            "queryName": query_name}]
            },
            "frame": _frame(title),
        },
    }


def _place(widget: Dict[str, Any], x: int, y: int, width: int, height: int) -> Dict[str, Any]:
    return {"widget": widget, "position": {"x": x, "y": y, "width": width, "height": height}}


# --------------------------------------------------------------------------------- pages


def _overview_page() -> Dict[str, Any]:
    """Answers "how are we doing" and deliberately nothing else.

    Six tiles and two orienting bars. Anything that needs a second look belongs on a detail
    page -- the whole complaint that prompted this was everything arriving at once.
    """
    tiles = [
        _counter("kpi-km-median", "overview", "km_median", "`km_median`",
                 "MTTR — KM median (days)",
                 "Kaplan–Meier: still-open findings count as censored, not excluded. Blank "
                 "means over half are still open — see the lower bound on the detail page."),
        _counter("kpi-sla", "overview", "sla_pct", "`sla_pct`", "In SLA %",
                 "Share of resolved findings closed within their severity's target."),
        _counter("kpi-coverage", "overview", "coverage_pct", "`coverage_pct`", "Coverage %",
                 "Of high-risk findings, the share remediated. Read with efficiency."),
        _counter("kpi-efficiency", "overview", "efficiency_pct", "`efficiency_pct`",
                 "Efficiency %",
                 "Of remediations, the share that were high-risk. At or below prevalence means "
                 "prioritisation is not beating random selection."),
        _counter("kpi-prevalence", "overview", "prevalence_pct", "`prevalence_pct`",
                 "Prevalence % (random baseline)",
                 "What efficiency a programme picking findings at random would score."),
        _counter("kpi-signal", "overview", "signal_coverage_pct", "`signal_coverage_pct`",
                 "Signal coverage %",
                 "Share of findings with exploit intelligence. Every rate above is conditional "
                 "on this."),
    ]
    layout = [_place(t, x=(i % 3) * 2, y=(i // 3) * 3, width=2, height=3)
              for i, t in enumerate(tiles)]

    layout.append(_place(
        _bar("ov-mttr", "mttr_by_severity",
             x="severity", x_expr="`severity`",
             y="km_median", y_expr="`km_median`",
             title="MTTR by severity (KM median, days)",
             description="Bars are the censoring-aware median. A severity with more than half "
                         "still open has no median and shows nothing — that is the honest state.",
             color_by_severity=True),
        x=0, y=6, width=3, height=7))
    layout.append(_place(
        _bar("ov-coverage", "program_by_severity",
             x="severity", x_expr="`severity`",
             y="coverage_pct", y_expr="`coverage_pct`",
             title="Coverage by severity (%)",
             description="Of high-risk findings in each severity, the share remediated.",
             color_by_severity=True),
        x=3, y=6, width=3, height=7))
    layout.append(_place(
        _line("ov-trend", "mttr_trend", x="scan_ts", x_expr="`scan_ts`",
              y="km_median", y_expr="`km_median`",
              title="MTTR trend across scans (KM median, days)",
              description="Every saved scan. Flat until the register has a few runs behind it."),
        x=0, y=13, width=6, height=6))

    return {"name": _id("page-overview"), "displayName": "Overview", "layout": layout}


def _remediation_page() -> Dict[str, Any]:
    """How fast, and where it is slow."""
    layout = [
        _place(_severity_filter("rem-filter", "mttr_by_severity"), x=0, y=0, width=2, height=2),
        _place(
            _bar("rem-km-vs-target", "mttr_by_severity",
                 x="severity", x_expr="`severity`",
                 y="km_median", y_expr="`km_median`",
                 title="KM median vs SLA target (days)",
                 description="Compare each bar against sla_target in the table below. The "
                             "closed-only median (mttr_median) is there too — the gap between "
                             "them is survivorship bias.",
                 color_by_severity=True,
                 extra_fields={"sla_target": "`sla_target`"}),
            x=0, y=2, width=3, height=7),
        _place(
            _bar("rem-open-age", "mttr_by_severity",
                 x="severity", x_expr="`severity`",
                 y="open_age_p90", y_expr="`open_age_p90`",
                 title="p90 age of still-open findings (days)",
                 description="How stale the backlog is, which MTTR cannot tell you. p50 is in "
                             "the table.",
                 color_by_severity=True,
                 extra_fields={"open_age_p50": "`open_age_p50`"}),
            x=3, y=2, width=3, height=7),
        _place(
            _table("rem-table", "mttr_by_severity",
                   ["severity", "resolved", "resolved_api", "resolved_disappeared", "open",
                    "km_median", "km_median_lower_bound", "km_rmst", "mttr_median",
                    "snap_km_median", "sla_target", "sla_pct", "open_age_p50", "open_age_p90"],
                   "MTTR detail by severity",
                   "km_median_lower_bound is populated only when the median was never reached — "
                   "read it as '> N days'. resolved_disappeared counts findings Wiz stopped "
                   "returning without ever setting resolvedAt: real remediation, but inferred "
                   "by us rather than stated. snap_km_median is the same estimator over a "
                   "single snapshot — what this number was before cross-scan tracking."),
            x=0, y=9, width=6, height=7),
        _place(
            _bar("rem-resolution-source", "mttr_by_severity",
                 x="severity", x_expr="`severity`",
                 y="resolved_disappeared", y_expr="`resolved_disappeared`",
                 title="Resolutions inferred from disappearance",
                 description="Against resolved_api in the table above. These closures were "
                             "never stated by Wiz — the finding simply stopped coming back. "
                             "A register where this dominates is telling you about the data "
                             "source as much as about the remediation programme.",
                 color_by_severity=True,
                 extra_fields={"resolved_api": "`resolved_api`"}),
            x=0, y=16, width=3, height=7),
        _place(
            _bar("rem-by-sub", "by_subscription",
                 x=BREAKDOWN_COLUMN, x_expr=f"`{BREAKDOWN_COLUMN}`",
                 y="open_findings", y_expr="SUM(`open_findings`)",
                 title=f"Open findings by {BREAKDOWN_LABEL.lower()} and severity",
                 description="Which part of the estate carries the backlog. Click a bar to "
                             "cross-filter the table beside it.",
                 color_by_severity=True,
                 extra_fields={"severity": "`severity`"}),
            x=3, y=16, width=3, height=7),
        _place(
            _table("rem-sub-table", "by_subscription",
                   [BREAKDOWN_COLUMN, "severity", "findings", "open_findings",
                    "oldest_open_days"],
                   f"{BREAKDOWN_LABEL} detail"),
            x=0, y=23, width=6, height=7),
    ]
    return {"name": _id("page-remediation"), "displayName": "Remediation speed",
            "layout": layout}


def _programme_page() -> Dict[str, Any]:
    """Are we fixing the right things, and can we keep up."""
    layout = [
        _place(_severity_filter("prog-filter", "program_by_severity"), x=0, y=0, width=2,
               height=2),
        _place(
            _bar("prog-coverage", "program_by_severity",
                 x="severity", x_expr="`severity`",
                 y="coverage_pct", y_expr="`coverage_pct`",
                 title="Coverage by severity (%)",
                 description="TP / (TP + FN). Bounds coverage_lo/hi in the table show what the "
                             "unclassified findings could do to it.",
                 color_by_severity=True,
                 extra_fields={"coverage_lo": "`coverage_lo`", "coverage_hi": "`coverage_hi`"}),
            x=0, y=2, width=3, height=7),
        _place(
            _bar("prog-efficiency", "program_by_severity",
                 x="severity", x_expr="`severity`",
                 y="efficiency_pct", y_expr="`efficiency_pct`",
                 title="Efficiency by severity (%)",
                 description="TP / (TP + FP). Compare against prevalence_pct: at or below it, "
                             "prioritisation is not beating picking at random.",
                 color_by_severity=True,
                 extra_fields={"prevalence_pct": "`prevalence_pct`"}),
            x=3, y=2, width=3, height=7),
        _place(
            _table("prog-table", "program_by_severity",
                   ["severity", "coverage_pct", "coverage_lo", "coverage_hi", "efficiency_pct",
                    "efficiency_lo", "efficiency_hi", "prevalence_pct", "signal_coverage_pct",
                    "high_risk", "unknown"],
                   "Coverage and efficiency detail",
                   "The lo/hi pairs are the extreme re-labellings of the unclassified findings. "
                   "Their width is the size of the doubt."),
            x=0, y=9, width=6, height=7),
        # The rule IS the label these two rates are computed against, so how much of them is the
        # rule belongs on the same page as the rates -- not in an appendix nobody opens.
        _place(
            _table("prog-sensitivity", "rule_sensitivity",
                   ["rule_label", "active", "coverage_pct", "efficiency_pct", "prevalence_pct",
                    "signal_coverage_pct", "high_risk", "unknown"],
                   "How much of that is the rule",
                   "The same two rates under each signal subset, with the configured rule marked "
                   "active. This is rule sensitivity, not a strategy comparison — every subset "
                   "is scored against itself, so none of them can be 'wrong'. Read high_risk and "
                   "unknown alongside: a subset that buys efficiency by shrinking the high-risk "
                   "population, or by pushing findings into unknown, shows it in those columns."),
            x=0, y=16, width=6, height=7),
        _place(
            _bar("prog-capacity", "capacity_observed_months",
                 x="month", x_expr="`month`",
                 y="closed", y_expr="`closed`",
                 title="Findings closed per month — all findings (observed months only)",
                 description="Against opened in the table below. Net negative for several "
                             "months running means the backlog is growing. Months before the "
                             "first scan are excluded — their activity is reconstructed from "
                             "the API's dates, not measured; the table lists them.",
                 x_scale="temporal",
                 extra_fields={"opened": "`opened`"}),
            x=0, y=23, width=3, height=7),
        # Its own chart rather than a second series on the one beside it: the two populations
        # have separate backlogs and separate month grids, so a shared axis would imply a
        # comparability that is not there.
        _place(
            _bar("prog-capacity-high-risk", "capacity_high_risk_months",
                 x="month", x_expr="`month`",
                 y="closed", y_expr="`closed`",
                 title="Closed per month — high risk only (observed months)",
                 description="The P2P v3 net-capacity population: are we closing high risk "
                             "faster than it arrives? This routinely disagrees with the chart "
                             "beside it, and when it does, this is the one that matters. "
                             "closed_observed is absent here on purpose — reconciliation's "
                             "count carries no risk label, so it would cross-check a different "
                             "population.",
                 x_scale="temporal",
                 extra_fields={"opened": "`opened`", "net_pct": "`net_pct`"}),
            x=3, y=23, width=3, height=7),
        _place(
            _table("prog-capacity-table", "capacity_months",
                   ["month", "open_at_start", "opened", "closed", "closed_observed", "mmcr",
                    "net_pct", "verdict", "partial", "reconstructed"],
                   "Capacity by month — all findings",
                   "mmcr is the share of the open backlog closed that month. partial is the "
                   "current month, still running. reconstructed means the month predates the "
                   "first scan, so its counts come from the API's dates rather than from "
                   "anything we watched — they are not evidence of capacity. closed_observed "
                   "is reconciliation's own count for cross-checking closed."),
            x=0, y=30, width=6, height=7),
        _place(
            _bar("prog-risk-mix", "by_subscription",
                 x=BREAKDOWN_COLUMN, x_expr=f"`{BREAKDOWN_COLUMN}`",
                 y="high_risk", y_expr="SUM(`high_risk`)",
                 title=f"High-risk findings by {BREAKDOWN_LABEL.lower()}",
                 description="Where the exploitable findings actually live. `unclassified` in "
                             "the remediation page's table is the caveat on this.",
                 color_by_severity=True,
                 extra_fields={"severity": "`severity`", "unclassified": "`unclassified`"}),
            x=0, y=37, width=6, height=7),
    ]
    return {"name": _id("page-programme"), "displayName": "Programme", "layout": layout}


# ----------------------------------------------------------------------------- assembly


def build(tables, scope: str = "os") -> Dict[str, Any]:
    """The whole dashboard document for one set of tables."""
    return {
        "datasets": datasets(tables),
        "pages": [_overview_page(), _remediation_page(), _programme_page()],
    }


def to_json(tables, scope: str = "os") -> str:
    """Serialised, with ``allow_nan=False``: NaN and Infinity are not valid JSON and Databricks
    rejects the document without saying why."""
    return json.dumps(build(tables, scope), indent=2, allow_nan=False, sort_keys=False)
