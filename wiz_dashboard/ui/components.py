"""Reusable Streamlit UI components: KPI cards, severity badges, MTTR widget, headers.

Native-widget-first, with a few small custom-HTML pieces (KPI hero cards, severity
badges, SLA bullets) where ``st.metric`` can't express per-item color/accent. Those
use the ``.kpi-card`` / ``.sev-badge`` / ``.sla-bullet`` classes defined in
``assets/styles.css`` (token-driven and tuned for the light theme to stay
contrast-safe). All dynamic text is HTML-escaped before injection.
"""

import html as _html
import traceback

import pandas as pd
import streamlit as st

from wiz_dashboard.config import (
    RESOLVED_STATUSES,
    SEVERITY_COLORS,
    SEVERITY_GLYPHS,
    SEVERITY_ORDER,
    SLA_TARGETS,
)
from wiz_dashboard.domain.formatting import format_duration
from wiz_dashboard.domain.metrics import calculate_mttr
from wiz_dashboard.domain.severity import normalize_severity

_TOAST_ICONS = {"success": "✅", "info": "ℹ️", "warning": "⚠️", "error": "🚨"}

# Severity -> CSS modifier suffix (matches .sev-badge--* / --sev-* tokens in CSS).
_SEV_CLASS = {
    "CRITICAL": "critical",
    "HIGH": "high",
    "MEDIUM": "medium",
    "LOW": "low",
    "INFO": "info",
    "UNKNOWN": "unknown",
}


# --------------------------------------------------------------------------- #
#  Severity dot + badge. The dot is a CSS-drawn shape (token-coloured), replacing
#  the old emoji glyph in every HTML context; emoji survives only in dataframe
#  text cells (st.dataframe/st.data_editor can't render HTML).
# --------------------------------------------------------------------------- #
def sev_dot_html(sev) -> str:
    """A small CSS-drawn severity dot (aria-hidden; meaning carried by adjacent text).

    Public: pages pass it as a KPI card ``glyph_html`` so severity colour reads at a
    glance without the old emoji glyph."""
    cls = _SEV_CLASS.get(normalize_severity(sev), "unknown")
    return f'<span class="sev-dot sev-dot--{cls}" aria-hidden="true"></span>'


def severity_badge_html(sev) -> str:
    """Return the HTML for one severity pill. Meaning is carried by the text label
    and ``aria-label`` (not color alone); the dot adds a redundant shape signal."""
    norm = normalize_severity(sev)
    cls = _SEV_CLASS.get(norm, "unknown")
    label = _html.escape(str(sev).strip() if sev else norm.title())
    return (
        f'<span class="sev-badge sev-badge--{cls}" role="status" '
        f'aria-label="Severity: {_html.escape(norm.title())}">'
        f'{sev_dot_html(sev)}{label}</span>'
    )


def severity_badge(sev) -> None:
    """Render a severity pill inline."""
    st.markdown(severity_badge_html(sev), unsafe_allow_html=True)


# --------------------------------------------------------------------------- #
#  Finding-detail "Sheet" body (custom HTML for the right-anchored drill-down
#  drawer). Shape-aware: a flat per-finding record gets a risk strip + scoring /
#  exploitability / asset / lifecycle / remediation sections; a grouped-by-asset
#  node gets a per-severity findings breakdown + asset/context. Both end with
#  tags-as-chips and a collapsible "All other fields" catch-all. Every section,
#  row and chip is present-only (rendered only when its value resolves), and all
#  dynamic text is HTML-escaped. ``raw`` (the original nested node) is consulted
#  for nested structures (tags / analytics / cvss) that json_normalize flattens.
# --------------------------------------------------------------------------- #

# Catch-all skips keys whose nested parents are surfaced elsewhere (tags chips,
# findings breakdown, CVSS rows) so they aren't duplicated as raw rows.
_CATCHALL_SKIP_PREFIXES = ("vulnerableAsset.tags.", "analytics.", "cvssv2.", "cvssv3.")


def _dig(obj, dotted):
    """Walk a dotted path through nested dicts; None if any hop is missing."""
    cur = obj
    for part in dotted.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _resolve(record, raw, keys):
    """First non-empty value among candidate keys: flattened ``record`` first
    (the table row), then the nested ``raw`` node via dotted-path lookup."""
    for k in keys:
        v = record.get(k)
        if v not in (None, ""):
            return v
    if isinstance(raw, dict):
        for k in keys:
            v = _dig(raw, k)
            if v not in (None, ""):
                return v
    return None


def _truthy(v):
    """Loose truthiness for API booleans that may arrive as strings/ints."""
    return v not in (None, "", 0, "0", False, "false", "False", "No", "NO", "no")


def _fmt_date(value):
    """ISO timestamp -> ``YYYY-MM-DD`` (matches the table's DatetimeColumn); raw on failure."""
    try:
        return pd.to_datetime(str(value), errors="raise", utc=True).strftime("%Y-%m-%d")
    except Exception:
        return str(value)


def _fmt_cell(value, kind):
    """Format one value by kind and HTML-escape it. ``bool`` -> Yes/No; ``pct`` ->
    a percentage (0-1 probability or already-scaled); ``score`` -> a tidy number."""
    if kind == "date":
        return _html.escape(_fmt_date(value))
    if kind == "bool":
        return "Yes" if _truthy(value) else "No"
    if kind == "pct":
        try:
            f = float(value)
            return f"{f * 100:.1f}%" if f <= 1 else f"{f:.1f}%"
        except (TypeError, ValueError):
            return _html.escape(str(value))
    if kind == "score":
        try:
            return _html.escape(f"{float(value):g}")
        except (TypeError, ValueError):
            return _html.escape(str(value))
    return _html.escape(str(value))


def _kv(label, value_html):
    return (
        '<div class="vuln-kv__row">'
        f'<dt class="vuln-kv__key">{_html.escape(label)}</dt>'
        f'<dd class="vuln-kv__val">{value_html}</dd></div>'
    )


def _row(record, raw, consumed, label, keys, kind="text"):
    """Present-only KV row; marks its candidate keys consumed (for the catch-all)."""
    consumed.update(keys)
    v = _resolve(record, raw, keys)
    return _kv(label, _fmt_cell(v, kind)) if v is not None else ""


def _section(title, rows):
    rows = [r for r in rows if r]
    if not rows:
        return ""
    return (
        '<section class="vuln-sheet__section">'
        f'<h3 class="vuln-sheet__section-title">{_html.escape(title)}</h3>'
        f'<dl class="vuln-kv">{"".join(rows)}</dl></section>'
    )


def _cvss_row(record, raw, consumed, label, prefix):
    """A CVSS row combining score (bold) + vector string (monospace)."""
    consumed.update([f"{prefix}.score", f"{prefix}.vectorString"])
    score = _resolve(record, raw, [f"{prefix}.score"])
    vector = _resolve(record, raw, [f"{prefix}.vectorString"])
    if score is None and vector is None:
        return ""
    bits = []
    if score is not None:
        bits.append(f'<strong>{_fmt_cell(score, "score")}</strong>')
    if vector:
        bits.append(f'<code>{_html.escape(str(vector))}</code>')
    return _kv(label, " ".join(bits))


def _is_grouped(record, raw):
    """Grouped-by-asset node: no per-finding ``severity`` but carries ``analytics``."""
    if "severity" in record:
        return False
    if isinstance(raw, dict) and isinstance(raw.get("analytics"), dict):
        return True
    return any(str(k).startswith("analytics.") for k in record)


def _stat(label, value_html, sub=None):
    sub_html = f'<div class="vuln-stat__sub">{_html.escape(str(sub))}</div>' if sub else ""
    return (
        '<div class="vuln-stat">'
        f'<div class="vuln-stat__label">{_html.escape(label)}</div>'
        f'<div class="vuln-stat__value">{value_html}</div>{sub_html}</div>'
    )


def _header_html(record, raw, consumed):
    """Title + severity-coloured accent + subtitle (asset · cloud · type) + chips."""
    consumed.update(["name", "id", "severity", "status"])
    title = (
        record.get("name")
        or _resolve(record, raw, ["vulnerableAsset.name"])
        or record.get("id")
        or "Details"
    )
    sev = record.get("severity")
    norm = normalize_severity(sev) if sev else None
    accent = SEVERITY_COLORS.get(norm, "var(--accent)") if norm else "var(--accent)"

    subtitle_bits = [
        b for b in (
            _resolve(record, raw, ["vulnerableAsset.name"]),
            _resolve(record, raw, ["vulnerableAsset.cloudPlatform", "cloudPlatform"]),
            _resolve(record, raw, ["vulnerableAsset.type", "type"]),
        ) if b
    ]
    subtitle = (
        f'<div class="vuln-sheet__subtitle">'
        f'{_html.escape(" · ".join(str(b) for b in subtitle_bits))}</div>'
    ) if subtitle_bits else ""

    chips = []
    if sev:
        chips.append(severity_badge_html(sev))
    status = record.get("status")
    if status:
        resolved = str(status).upper() in RESOLVED_STATUSES
        cls = "status-ok" if resolved else "status-pill--neutral"
        chips.append(f'<span class="status-pill {cls}">{_html.escape(str(status))}</span>')
    chips_html = (
        f'<div class="vuln-sheet__chips">{"".join(chips)}</div>' if chips else ""
    )
    return (
        f'<header class="vuln-sheet__header" style="--sev:{accent}">'
        f'<h2 class="vuln-sheet__title">{_html.escape(str(title))}</h2>'
        f'{subtitle}{chips_html}</header>'
    )


def _risk_strip_html(record, raw, consumed):
    """At-a-glance band: CVSS/EPSS stat tiles + semantic risk chips (truthy-only)."""
    tiles = []
    consumed.update(["cvssv3.score", "cvssv2.score", "score", "epssProbability"])
    cvss = _resolve(record, raw, ["cvssv3.score", "cvssv2.score", "score"])
    if cvss is not None:
        tiles.append(_stat("CVSS", _fmt_cell(cvss, "score")))
    epss = _resolve(record, raw, ["epssProbability"])
    if epss is not None:
        tiles.append(_stat("EPSS", _fmt_cell(epss, "pct")))

    chips = []

    def chip(keys, label, kind):
        consumed.update(keys)
        if _truthy(_resolve(record, raw, keys)):
            chips.append(f'<span class="risk-chip risk-chip--{kind}">{_html.escape(label)}</span>')

    chip(["hasExploit"], "Exploit available", "danger")
    chip(["hasCisaKevExploit"], "CISA KEV", "danger")
    chip(["validatedInRuntime"], "Validated in runtime", "info")
    chip(["vulnerableAsset.hasWideInternetExposure"], "Internet-exposed", "warn")
    chip(["vulnerableAsset.hasLimitedInternetExposure"], "Limited exposure", "warn")
    chip(["usedInCodeResult"], "Used in code", "info")

    if not tiles and not chips:
        return ""
    inner = "".join(tiles)
    if chips:
        inner += f'<div class="risk-chips">{"".join(chips)}</div>'
    return f'<div class="vuln-risk">{inner}</div>'


def _sla_status_row(record, raw, consumed):
    """SLA verdict: age (resolved-or-now minus first-detected) vs config target."""
    sev = normalize_severity(record.get("severity"))
    target = SLA_TARGETS.get(sev)
    first = _resolve(record, raw, ["firstDetectedAt", "firstSeenAt", "createdAt"])
    if target is None or not first:
        return ""
    end = _resolve(record, raw, ["resolvedAt", "remediatedAt", "fixedAt"])
    try:
        start = pd.to_datetime(str(first), utc=True, errors="raise")
        stop = (
            pd.to_datetime(str(end), utc=True, errors="raise")
            if end else pd.Timestamp.now(tz="UTC")
        )
    except Exception:
        return ""
    age = max((stop - start).days, 0)
    breached = age > target
    cls = "status-bad" if breached else "status-ok"
    verdict = "Breached" if breached else "Within SLA"
    suffix = "resolved" if end else "open"
    val = (
        f'<span class="status-pill {cls}">{verdict}</span> '
        f'{age}d / {target}d ({suffix})'
    )
    return _kv("SLA status", val)


def _tags_section(record, raw, consumed):
    """Render ``tags`` (from the raw node, or reconstructed from flattened columns)
    as chips. json_normalize explodes ``vulnerableAsset.tags`` into columns, so the
    raw node is preferred."""
    tags = None
    if isinstance(raw, dict):
        tags = _dig(raw, "vulnerableAsset.tags")
        if not isinstance(tags, dict):
            tags = raw.get("tags") if isinstance(raw.get("tags"), dict) else None
    if not isinstance(tags, dict):
        tags = {
            k.split("vulnerableAsset.tags.", 1)[1]: v
            for k, v in record.items()
            if k.startswith("vulnerableAsset.tags.") and v not in (None, "")
        }
    if not tags:
        return ""
    chips = "".join(
        '<span class="tag-chip">'
        f'<span class="tag-chip__k">{_html.escape(str(k))}</span>'
        f'<span class="tag-chip__v">{_html.escape(str(v))}</span></span>'
        for k, v in tags.items()
    )
    return (
        '<section class="vuln-sheet__section">'
        '<h3 class="vuln-sheet__section-title">Tags</h3>'
        f'<div class="vuln-tags">{chips}</div></section>'
    )


_BREAKDOWN_SEVS = [
    ("CRITICAL", "analytics.criticalSeverityFindingCount"),
    ("HIGH", "analytics.highSeverityFindingCount"),
    ("MEDIUM", "analytics.mediumSeverityFindingCount"),
    ("LOW", "analytics.lowSeverityFindingCount"),
    ("INFO", "analytics.informationalSeverityFindingCount"),
]


def _breakdown_section(record, raw, consumed):
    """Grouped findings breakdown: per-severity count bars from ``analytics``."""
    counts = {}
    for sev, key in _BREAKDOWN_SEVS:
        v = _resolve(record, raw, [key])
        try:
            counts[sev] = int(v) if v is not None else 0
        except (TypeError, ValueError):
            counts[sev] = 0
    total = sum(counts.values())
    if total == 0:
        return ""
    rows = []
    for sev, _key in _BREAKDOWN_SEVS:
        c = counts[sev]
        pct = (c / total * 100) if total else 0
        rows.append(
            f'<div class="vuln-breakdown__row" style="--sev:{SEVERITY_COLORS[sev]}">'
            f'<span class="vuln-breakdown__label">{sev_dot_html(sev)}{sev.title()}</span>'
            '<span class="vuln-breakdown__track">'
            f'<span class="vuln-breakdown__fill" style="width:{pct:.0f}%"></span></span>'
            f'<span class="vuln-breakdown__count">{c:,}</span></div>'
        )
    return (
        '<section class="vuln-sheet__section">'
        '<h3 class="vuln-sheet__section-title">Findings breakdown</h3>'
        f'<div class="vuln-breakdown">{"".join(rows)}</div></section>'
    )


def _catch_all_section(record, consumed):
    """Collapsible 'All other fields': every remaining scalar key not shown above."""
    rows = []
    for k in sorted(record.keys(), key=str):
        if k in consumed or str(k).startswith("_"):
            continue
        if any(str(k).startswith(p) for p in _CATCHALL_SKIP_PREFIXES):
            continue
        v = record.get(k)
        if v is None or v == "" or (isinstance(v, float) and pd.isna(v)):
            continue
        rows.append(_kv(str(k), _fmt_cell(v, "text")))
    if not rows:
        return ""
    return (
        '<details class="vuln-raw"><summary>All other fields</summary>'
        f'<dl class="vuln-kv">{"".join(rows)}</dl></details>'
    )


def _flat_body(record, raw, consumed):
    """Curated, present-only sections for a flat per-finding record."""
    desc = _resolve(record, raw, ["description", "cveDescription"])
    consumed.update(["description", "cveDescription"])
    ident_rows = [
        _row(record, raw, consumed, "CVE", ["name"]),
        _row(record, raw, consumed, "Detailed name", ["detailedName", "detailedNameV2"]),
        _row(record, raw, consumed, "Finding ID", ["id"]),
        _row(record, raw, consumed, "Origin", ["origin"]),
        _row(record, raw, consumed, "Categories", ["categories"]),
    ]
    ident_rows = [r for r in ident_rows if r]
    ident = ""
    if ident_rows or desc:
        body = f'<dl class="vuln-kv">{"".join(ident_rows)}</dl>' if ident_rows else ""
        if desc:
            body += f'<p class="vuln-desc">{_html.escape(str(desc))}</p>'
        ident = (
            '<section class="vuln-sheet__section">'
            '<h3 class="vuln-sheet__section-title">Identification</h3>'
            f'{body}</section>'
        )

    scoring = _section("Severity & scoring", [
        _row(record, raw, consumed, "Risk score", ["score"], "score"),
        _cvss_row(record, raw, consumed, "CVSS v3", "cvssv3"),
        _cvss_row(record, raw, consumed, "CVSS v2", "cvssv2"),
        _row(record, raw, consumed, "Weighted severity", ["weightedSeverity"]),
        _row(record, raw, consumed, "Vendor severity", ["vendorSeverity"]),
        _row(record, raw, consumed, "NVD severity", ["nvdSeverity"]),
        _row(record, raw, consumed, "CNA score", ["cnaScore"], "score"),
        _row(record, raw, consumed, "Vendor score", ["vendorScore"], "score"),
    ])
    exploit = _section("Exploitability", [
        _row(record, raw, consumed, "Exploit available", ["hasExploit"], "bool"),
        _row(record, raw, consumed, "CISA KEV", ["hasCisaKevExploit"], "bool"),
        _row(record, raw, consumed, "KEV released", ["cisaKevReleaseDate"], "date"),
        _row(record, raw, consumed, "KEV due", ["cisaKevDueDate"], "date"),
        _row(record, raw, consumed, "EPSS severity", ["epssSeverity"]),
        _row(record, raw, consumed, "EPSS percentile", ["epssPercentile"], "pct"),
        _row(record, raw, consumed, "Validated in runtime", ["validatedInRuntime"], "bool"),
        _row(record, raw, consumed, "Runtime result", ["runtimeValidationResult"]),
        _row(record, raw, consumed, "Reachability", ["reachability"]),
        _row(record, raw, consumed, "Used in code", ["usedInCodeResult"]),
        _row(record, raw, consumed, "High-profile threat", ["isHighProfileThreat"], "bool"),
        _row(record, raw, consumed, "Client-side", ["isClientSide"], "bool"),
    ])
    asset = _section("Affected asset", [
        _row(record, raw, consumed, "Asset", ["vulnerableAsset.name"]),
        _row(record, raw, consumed, "Type", ["vulnerableAsset.type", "type"]),
        _row(record, raw, consumed, "Cloud", ["vulnerableAsset.cloudPlatform", "cloudPlatform"]),
        _row(record, raw, consumed, "Operating system",
             ["vulnerableAsset.operatingSystem", "operatingSystem"]),
        _row(record, raw, consumed, "Subscription", ["vulnerableAsset.subscriptionName"]),
        _row(record, raw, consumed, "Subscription ID",
             ["vulnerableAsset.subscriptionExternalId", "vulnerableAsset.subscriptionId"]),
        _row(record, raw, consumed, "Asset external ID", ["vulnerableAsset.externalId"]),
        _row(record, raw, consumed, "Wide internet exposure",
             ["vulnerableAsset.hasWideInternetExposure"], "bool"),
        _row(record, raw, consumed, "Limited internet exposure",
             ["vulnerableAsset.hasLimitedInternetExposure"], "bool"),
    ])
    lifecycle = _section("Lifecycle & SLA", [
        _row(record, raw, consumed, "First detected", ["firstDetectedAt", "firstSeenAt"], "date"),
        _row(record, raw, consumed, "Last detected", ["lastDetectedAt"], "date"),
        _row(record, raw, consumed, "Published", ["publishedDate"], "date"),
        _row(record, raw, consumed, "Resolved", ["resolvedAt"], "date"),
        _sla_status_row(record, raw, consumed),
    ])
    remediation = _section("Remediation", [
        _row(record, raw, consumed, "Fixed version", ["fixedVersion"]),
        _row(record, raw, consumed, "Recommended version", ["recommendedVersion"]),
        _row(record, raw, consumed, "Fix available", ["fixDate"], "date"),
        _row(record, raw, consumed, "Remediation PR", ["remediationPullRequestAvailable"], "bool"),
        _row(record, raw, consumed, "Auto-remediable", ["hasTriggerableRemediation"], "bool"),
        _row(record, raw, consumed, "Detection method", ["detectionMethod"]),
        _row(record, raw, consumed, "Location", ["locationPath"]),
    ])
    return ident + scoring + exploit + asset + lifecycle + remediation


def _group_stats_html(record, raw, consumed):
    """Headline analytics tiles for a grouped node: total findings + asset count.

    These two ``analytics`` fields are the summary numbers of a grouped-by-value
    node (the actual ``vulnerabilityFindingsGroupedByValues`` shape) and would
    otherwise be invisible — the per-severity breakdown ignores them and the
    catch-all skips the whole ``analytics.`` prefix."""
    consumed.update(["analytics.totalFindingCount", "analytics.vulnerableAssetCount"])
    tiles = []
    total = _resolve(record, raw, ["analytics.totalFindingCount"])
    if total is not None:
        tiles.append(_stat("Total findings", _fmt_cell(total, "score")))
    assets = _resolve(record, raw, ["analytics.vulnerableAssetCount"])
    if assets is not None:
        tiles.append(_stat("Vulnerable assets", _fmt_cell(assets, "score")))
    if not tiles:
        return ""
    return f'<div class="vuln-risk">{"".join(tiles)}</div>'


def _grouped_body(record, raw, consumed):
    """Summary stats + findings breakdown + asset/context for a grouped-by-asset node."""
    stats = _group_stats_html(record, raw, consumed)
    breakdown = _breakdown_section(record, raw, consumed)
    asset = _section("Affected asset", [
        _row(record, raw, consumed, "Asset", ["vulnerableAsset.name"]),
        _row(record, raw, consumed, "Type", ["vulnerableAsset.type"]),
        _row(record, raw, consumed, "Cloud", ["vulnerableAsset.cloudPlatform"]),
        _row(record, raw, consumed, "Subscription", ["vulnerableAsset.subscriptionName"]),
        _row(record, raw, consumed, "Subscription ID",
             ["vulnerableAsset.subscriptionExternalId", "vulnerableAsset.subscriptionId"]),
        _row(record, raw, consumed, "Asset external ID", ["vulnerableAsset.externalId"]),
        _row(record, raw, consumed, "Asset ID", ["vulnerableAsset.id"]),
    ])
    context = _section("Context", [
        _row(record, raw, consumed, "Environment", ["environment"]),
        _row(record, raw, consumed, "Kubernetes cluster", ["kubernetesCluster"]),
        _row(record, raw, consumed, "Namespace", ["kubernetesNamespace"]),
        _row(record, raw, consumed, "Project", ["project"]),
        _row(record, raw, consumed, "Detection method", ["detectionMethod"]),
    ])
    return stats + breakdown + asset + context


def vuln_detail_html(record: dict, raw=None) -> str:
    """Build the shadcn "Sheet" body for a finding or grouped asset node.

    ``record`` is the (flattened) table row; ``raw`` is the original nested node,
    consulted for nested structures (tags / analytics / cvss). Shape-aware,
    present-only, fully HTML-escaped."""
    record = record or {}
    consumed = set()
    parts = [_header_html(record, raw, consumed)]
    if _is_grouped(record, raw):
        parts.append(_grouped_body(record, raw, consumed))
    else:
        parts.append(_risk_strip_html(record, raw, consumed))
        parts.append(_flat_body(record, raw, consumed))
    parts.append(_tags_section(record, raw, consumed))
    parts.append(_catch_all_section(record, consumed))
    return "".join(p for p in parts if p)


# --------------------------------------------------------------------------- #
#  KPI cards (custom HTML; accent border + tabular value + good/bad delta)
# --------------------------------------------------------------------------- #
def _fmt_delta_number(delta):
    if delta is None:
        return None
    try:
        d = float(delta)
    except (TypeError, ValueError):
        return None
    return int(d) if d.is_integer() else round(d, 1)


def _delta_html(delta, *, inverse=True, suffix="", pct=None, abs_text=None) -> str:
    """The change chip shared by KPI cards, the severity breakdown and the MTTR list.

    ``inverse=True`` means a *rising* value is bad (vuln counts / MTTR / open): the arrow
    shows the real direction, the colour shows good/bad. ``abs_text`` overrides the
    absolute-magnitude string (e.g. a formatted duration like ``"4.7d"``); ``pct`` appends
    a muted ``· ±N%`` change-vs-previous-scan. Returns ``""`` when there's no comparable
    delta, and a neutral ``±0`` chip when the value is unchanged."""
    d = _fmt_delta_number(delta)
    if d is None:
        return ""
    if d == 0:
        return '<div class="kpi-card__delta kpi-card__delta--flat">±0</div>'
    rising = d > 0
    bad = rising if inverse else (not rising)
    cls = "bad" if bad else "good"
    arrow = "▲" if rising else "▼"
    sign = "+" if rising else "−"
    mag = _html.escape(abs_text) if abs_text is not None else f"{abs(d)}{_html.escape(str(suffix))}"
    pct_html = (
        f' <span class="kpi-card__delta-pct">· {sign}{abs(pct):.0f}%</span>'
        if pct is not None else ""
    )
    return (
        f'<div class="kpi-card__delta kpi-card__delta--{cls}">'
        f'<span aria-hidden="true">{arrow}</span> {sign}{mag}{pct_html}</div>'
    )


def _kpi_card_html(label, value, *, delta=None, delta_suffix="", accent=None,
                   glyph=None, glyph_html=None, inverse=True, help=None, pct=None) -> str:
    """One KPI card. ``inverse=True`` means a *rising* value is bad (vuln counts):
    the arrow shows the real direction, the color shows good/bad. ``glyph_html`` is
    trusted raw HTML (e.g. a CSS severity dot) injected as-is; ``glyph`` is escaped text.
    ``pct`` appends the muted ``· ±N%`` change-vs-previous chip (same as the stat list)."""
    accent = accent or "var(--accent)"
    if glyph_html:
        glyph_lead = f"{glyph_html} "
    elif glyph:
        glyph_lead = f'<span aria-hidden="true">{_html.escape(str(glyph))}</span> '
    else:
        glyph_lead = ""
    title_attr = f' title="{_html.escape(str(help))}"' if help else ""
    delta_html = _delta_html(delta, inverse=inverse, suffix=delta_suffix, pct=pct)
    return (
        f'<div class="kpi-card" style="--kpi-accent:{_html.escape(str(accent))}">'
        f'<div class="kpi-card__label"{title_attr}>{glyph_lead}{_html.escape(str(label))}</div>'
        f'<div class="kpi-card__value">{_html.escape(str(value))}</div>'
        f'{delta_html}</div>'
    )


def kpi_row(items) -> None:
    """Render a horizontal band of headline KPI cards.

    ``items``: an iterable of dicts with keys ``label``, ``value`` and optional
    ``delta``, ``delta_suffix``, ``pct`` (appends the muted ``· ±N%`` chip), ``accent``
    (hex or CSS var), ``glyph`` (escaped text) or ``glyph_html`` (trusted raw HTML, e.g. a
    CSS dot), ``inverse`` (default True), ``help``.
    """
    cards = "".join(
        _kpi_card_html(
            it.get("label", ""),
            it.get("value", "—"),
            delta=it.get("delta"),
            delta_suffix=it.get("delta_suffix", ""),
            pct=it.get("pct"),
            accent=it.get("accent"),
            glyph=it.get("glyph"),
            glyph_html=it.get("glyph_html"),
            inverse=it.get("inverse", True),
            help=it.get("help"),
        )
        for it in items
    )
    st.markdown(f'<div class="kpi-row">{cards}</div>', unsafe_allow_html=True)


# The breakdown card shows only the four actionable severities (Info/Unknown omitted),
# ordered severest-first. Derived from SEVERITY_ORDER so the ordering stays in one place.
_BREAKDOWN_SEVERITIES = [s for s in SEVERITY_ORDER if s not in ("INFO", "UNKNOWN")]


def stat_list_card(items) -> None:
    """A single shadcn Card stacking one labelled row per metric — the vertical
    counterpart to ``kpi_row`` (same item dicts). Used for the severity breakdown and the
    MTTR KPIs so both read as one compact stat list instead of a band of separate cards.

    Each item: ``label`` + ``value`` (required); optional ``glyph_html`` (trusted raw HTML
    lead, e.g. a severity dot), ``delta`` (+ ``delta_suffix`` / ``inverse`` / ``pct`` /
    ``abs_text``) for a change chip, and ``help`` (hover title on the label). ``accent`` is
    accepted but ignored — rows carry meaning by label + optional glyph/delta, not a
    per-row colour."""
    rows = []
    for it in items:
        title = f' title="{_html.escape(str(it["help"]))}"' if it.get("help") else ""
        if it.get("sub_value"):
            value_html = (
                f'<span class="stat-card__value-group">'
                f'<span class="stat-card__value">{_html.escape(str(it.get("value", "—")))}</span>'
                f'<span class="stat-card__sub-value">{_html.escape(str(it["sub_value"]))}</span>'
                f'</span>'
            )
        else:
            value_html = f'<span class="stat-card__value">{_html.escape(str(it.get("value", "—")))}</span>'
        rows.append(
            '<div class="stat-card__row">'
            f'<span class="stat-card__name"{title}>'
            f'{it.get("glyph_html") or ""}{_html.escape(str(it.get("label", "")))}</span>'
            f'{value_html}'
            f'{_delta_html(it.get("delta"), inverse=it.get("inverse", True), suffix=it.get("delta_suffix", ""), pct=it.get("pct"), abs_text=it.get("abs_text"))}'
            "</div>"
        )
    st.markdown(f'<div class="stat-card">{"".join(rows)}</div>', unsafe_allow_html=True)


def severity_skeleton():
    """Placeholder severity breakdown (em-dash rows) shown before a scan has loaded.

    Mirrors ``severity_cards`` (same single card + rows) so the empty and loaded states
    share one layout instead of swapping shapes when data arrives."""
    stat_list_card(
        [{"label": sev.title(), "glyph_html": sev_dot_html(sev), "value": "—"}
         for sev in _BREAKDOWN_SEVERITIES]
    )


def severity_cards(counts, prev=None, per_sev=None, scope=None):
    """The severity breakdown as ONE card with a row per level (Critical→Low).

    A single shadcn Card (see ``stat_list_card``) stacks four rows, each pairing a colour
    dot + text label with the count (tabular figures) and an optional scan-over-scan change
    chip — absolute count plus % vs the previous scan (rising = worse). Shared by every
    findings page (OS / Cloud / Identity); Info/Unknown are omitted by design (see
    ``_BREAKDOWN_SEVERITIES``). ``prev`` is a previous ``{severity: count}`` mapping.
    ``per_sev`` is the MTTR per-severity dict (``{sev: {"open": N, "resolved": N, …}}``)
    used to render an "N open · N resolved" sub-line under each count.

    ``scope`` (optional severity iterable — the display filter) omits out-of-scope rows
    entirely rather than rendering a misleading ``0`` ("0 medium" would read as
    scanned-and-clean when the severity is merely hidden). Callers surface the scope in
    a caption; the card itself stays quiet."""
    rows = (
        [s for s in _BREAKDOWN_SEVERITIES if s in set(scope)]
        if scope else _BREAKDOWN_SEVERITIES
    )
    items = []
    for sev in rows:
        cur = counts.get(sev, 0)
        p = prev.get(sev) if prev else None
        item = {
            "label": sev.title(),
            "glyph_html": sev_dot_html(sev),
            "value": f"{cur:,}",
            "delta": (cur - p) if p is not None else None,
            # % needs a non-zero base; a count rising from 0 shows the absolute only.
            "pct": ((cur - p) / p * 100) if p not in (None, 0) else None,
        }
        if per_sev and sev in per_sev:
            sev_data = per_sev[sev]
            open_ = sev_data.get("open", 0)
            resolved = sev_data.get("resolved", 0)
            item["sub_value"] = f"{open_:,} open · {resolved:,} resolved"
        items.append(item)
    stat_list_card(items)


# --------------------------------------------------------------------------- #
#  SLA attainment: one policy, one verdict everywhere
# --------------------------------------------------------------------------- #
# The single source of truth for the "In SLA?" verdict. ``sla_pct`` (share of resolved
# findings remediated within target) drives the colour at >=90 / >=70 across the SLA
# posture bars, the breakdown-table status glyph, and the bullet — so a severity can never
# read compliant in one place and breached in another. This deliberately keys on attainment
# (% within target), NOT on median-vs-target: those are different questions, and mixing them
# is what let a lane show "over target" and "compliant" at the same time.
SLA_OK_PCT = 90
SLA_WARN_PCT = 70
_SLA_GLYPH = {"ok": "✅", "warn": "⚠️", "bad": "🚨"}


def sla_state(pct) -> str:
    """Map an In-SLA percentage to the shared ``ok`` / ``warn`` / ``bad`` policy state."""
    return "ok" if pct >= SLA_OK_PCT else "warn" if pct >= SLA_WARN_PCT else "bad"


def sla_bullet_html(pct) -> str:
    """A thin progress bar coloured by the shared 90/70 SLA-attainment policy."""
    try:
        p = max(0.0, min(100.0, float(pct)))
    except (TypeError, ValueError):
        p = 0.0
    state = sla_state(p)
    return (
        f'<div class="sla-bullet" role="progressbar" aria-valuenow="{p:.0f}" '
        f'aria-valuemin="0" aria-valuemax="100" aria-label="In SLA {p:.0f} percent">'
        f'<div class="sla-bullet__fill sla-bullet__fill--{state}" '
        f'style="width:{p:.0f}%"></div></div>'
    )


def sla_bullet(pct) -> None:
    st.markdown(sla_bullet_html(pct), unsafe_allow_html=True)


def sla_posture_html(per_sev) -> str:
    """Build the per-severity SLA-attainment posture: one labelled progress bar per severity
    showing the share of resolved findings that met their SLA target, coloured on the shared
    90/70 policy (the SAME metric as the 'In SLA' KPI and the breakdown table's status glyph).

    The median time-to-remediate rides along as muted context, never as the verdict, so the
    posture, the KPI and the table always agree. Present-only: a severity shows a lane only when
    it has an attainment figure (i.e. something resolved) AND an SLA target; INFO is excluded to
    match the severity breakdown's four levels. Returns ``""`` when no severity qualifies, so the
    renderer can fall back to a caption."""
    rows = []
    for sev in SEVERITY_ORDER:
        if sev == "INFO":
            continue
        d = per_sev.get(sev)
        if not d:
            continue
        pct = d.get("sla_pct")
        target = d.get("sla_target")
        if pct is None or not target:
            continue
        state = sla_state(pct)
        resolved = int(d.get("resolved", 0))
        open_ = int(d.get("open", 0))
        sub = f"median {format_duration(d.get('mttr_median'))} · {resolved:,} resolved"
        if open_:
            sub += f" · {open_:,} open"
        rows.append(
            '<div class="sla-posture__row">'
            '<div class="sla-posture__head">'
            f'<span class="sla-posture__lane">{sev_dot_html(sev)}'
            f'{_html.escape(sev.title())} · ≤{int(target)}d</span>'
            f'<span class="sla-posture__pct sla-posture__pct--{state}">'
            f'{pct:.0f}% in SLA</span></div>'
            f'{sla_bullet_html(pct)}'
            f'<div class="sla-posture__sub">{_html.escape(sub)}</div>'
            '</div>'
        )
    return f'<div class="sla-posture">{"".join(rows)}</div>' if rows else ""


def sla_posture(
    per_sev,
    *,
    empty="No remediation data yet. SLA posture builds up as findings are resolved.",
) -> None:
    """Render the per-severity SLA-attainment posture, or a caption when nothing is resolved."""
    html = sla_posture_html(per_sev)
    if not html:
        st.caption(empty)
        return
    st.markdown(html, unsafe_allow_html=True)


def section_label(text):
    """A compact section heading above a group of widgets.

    Emits an ``h2`` (page title is ``h1``) so the heading order is sequential for
    screen readers; styled compact in CSS rather than relying on a level skip.
    """
    st.markdown(f"## {text}")


def empty_state(title, body):
    """Shared empty/placeholder panel (native). `body` is Markdown."""
    with st.container(border=True):
        st.markdown(f"**{title}**")
        st.markdown(body)


def show_toast(message, kind="success"):
    """Native toast with a kind-appropriate icon."""
    st.toast(str(message), icon=_TOAST_ICONS.get(kind))


def show_exception(exc: Exception, title: str = "Something went wrong", hint: str = None) -> None:
    """Plain-language error + a collapsed technical-details panel.

    ``title`` is the human headline and ``hint`` an actionable next step; both read for a
    non-engineer. The raw exception message and traceback are tucked into a collapsed
    "Technical details" expander (with a download), so a failure stays calm and useful
    instead of dumping a Python stack as the headline.
    """
    try:
        tb = traceback.format_exc()
    except Exception:
        tb = str(exc)

    st.error(f"**{title}**" + (f"  \n{hint}" if hint else ""))

    with st.expander("Technical details", expanded=False):
        st.caption("Share this with an engineer if the problem keeps happening.")
        try:
            st.code(tb, language="text")
        except Exception:
            st.text(tb)
        try:
            st.download_button(
                "Download error details",
                data=tb,
                file_name="error.txt",
                mime="text/plain",
            )
        except Exception:
            pass


def render_mttr_widget(df, mttr=None, *, show_overall=True):
    """MTTR per-severity table with SLA bars and compliance.

    ``mttr`` may be a precomputed ``(per_sev, overall)`` tuple (the page passes a
    cached one); when omitted it is computed from ``df``.

    ``show_overall`` renders the "Overall median MTTR" headline metric + resolved/open
    caption above the table. The MTTR page passes ``False`` because its Key metrics card
    already shows median / resolved / open, so repeating them here is redundant; standalone
    callers (and the OS-page legacy use) keep the headline by default.
    """
    per_sev, overall = mttr if mttr is not None else calculate_mttr(df)
    if not per_sev:
        empty_state(
            "No remediation timestamps",
            "MTTR needs `firstSeenAt` + `resolvedAt` "
            "(or a `status` field) on findings.",
        )
        return

    if show_overall:
        st.metric(
            "Overall median MTTR",
            format_duration(overall.get("mttr_median")),
            help="Median days from first detection to remediation, across all severities.",
        )
        st.caption(
            f"{overall.get('resolved', 0):,} resolved · {overall.get('open', 0):,} open"
        )

    rows = []
    for sev in SEVERITY_ORDER:
        d = per_sev.get(sev)
        if not d:
            continue
        pct = d.get("sla_pct")
        # Same 90/70 policy as the SLA posture bars (sla_state), so the table's glyph and the
        # posture's colour never disagree for a severity.
        badge = "—" if pct is None else _SLA_GLYPH[sla_state(pct)]
        sla = d.get("sla_target")
        rows.append(
            {
                "Severity": f"{SEVERITY_GLYPHS[sev]} {sev.title()}",
                "Median": format_duration(d.get("mttr_median")),
                "SLA target": f"{sla}d" if sla else "—",
                "In SLA": float(pct) if pct is not None else 0.0,
                "Status": badge,
                "Resolved": int(d.get("resolved", 0)),
                "Open": int(d.get("open", 0)),
            }
        )

    # Native dataframe: the "In SLA" compliance % renders as a progress bar (replaces
    # the old hand-drawn bars). The SLA target *marker* the HTML widget drew has no
    # ProgressColumn equivalent; "In SLA %" is the more direct signal, with a ✅/⚠️/🚨
    # status glyph carrying the 90%/70% policy without relying on color alone.
    st.dataframe(
        pd.DataFrame(
            rows,
            columns=[
                "Severity", "Median", "SLA target", "In SLA", "Status", "Resolved", "Open",
            ],
        ),
        hide_index=True,
        width="stretch",
        column_config={
            "In SLA": st.column_config.ProgressColumn(
                "In SLA",
                help="Share of resolved findings remediated within the SLA target.",
                format="%.0f%%",
                min_value=0,
                max_value=100,
                # auto = green when high / red when low (high compliance is good).
                color="auto",
            ),
            "Status": st.column_config.TextColumn(
                "SLA status",
                help="✅ ≥90% in SLA · ⚠️ ≥70% · 🚨 below 70%",
            ),
        },
    )


def render_page_header(title, subtitle):
    """Compact page header: title + subtitle, followed by a divider."""
    st.title(title)
    st.caption(subtitle)
    st.divider()


def _page_bounds(n, size, page):
    """Clamp ``page`` for ``n`` rows at ``size`` rows/page -> ``(page, start, end, n_pages)``.

    Pure math (no Streamlit) so the pager's slicing is unit-testable."""
    size = max(1, int(size))
    n_pages = max(1, -(-int(n) // size))
    page = max(0, min(int(page), n_pages - 1))
    start = page * size
    return page, start, min(start + size, int(n)), n_pages


def paginate(view, key, *, sizes=(100, 250, 500), default=250, reset_token=""):
    """Server-side pager: render compact page controls and return the current page's slice.

    Streamlit's grid virtualizes rendering but not transport — every rerun Arrow-serializes
    the whole frame it's handed over the websocket, which is what makes a 100k-row table
    feel broken. Slicing server-side keeps each render to one page. ``.iloc`` slicing
    preserves the frame's index, so drill-down/selection handlers keep resolving rows.

    Small frames (``len(view) <= min(sizes)``) render as before — no controls, no slice.
    The page position lives in ``st.session_state[f"{key}_pnum"]`` and snaps back to the
    first page whenever ``reset_token`` changes (new data or changed filters make the old
    offset meaningless). Native widgets only, so focus rings and keyboard use come free.
    """
    n = len(view)
    if n <= min(sizes):
        return view
    size_key, page_key, token_key = f"{key}_psize", f"{key}_pnum", f"{key}_ptok"
    if st.session_state.get(token_key) != reset_token:
        st.session_state[token_key] = reset_token
        st.session_state[page_key] = 0

    row = st.columns([2, 4, 1.2, 1.2], gap="small", vertical_alignment="bottom")
    size = row[0].selectbox(
        "Rows per page",
        options=list(sizes),
        index=list(sizes).index(default) if default in sizes else 0,
        key=size_key,
    )
    current = st.session_state.get(page_key, 0)
    _, _, _, n_pages = _page_bounds(n, size, current)
    if row[2].button("Previous", key=f"{key}_pprev", disabled=current <= 0, width="stretch"):
        current -= 1
    if row[3].button("Next", key=f"{key}_pnext", disabled=current >= n_pages - 1, width="stretch"):
        current += 1
    page, start, end, n_pages = _page_bounds(n, size, current)
    st.session_state[page_key] = page
    row[1].caption(f"Page {page + 1} of {n_pages:,} · rows {start + 1:,}–{end:,} of {n:,}")
    return view.iloc[start:end]


# Above this many rows a download's payload is built on demand (two-step Prepare ->
# Download) instead of on every rerun. Small/sample data keeps the one-click button.
DEFERRED_DOWNLOAD_THRESHOLD = 2000


def deferred_download(label, build, *, file_name, mime, key, row_count, sig,
                      threshold=DEFERRED_DOWNLOAD_THRESHOLD, disabled=False, **button_kwargs):
    """Download button whose payload is built lazily once the data is large.

    ``st.download_button`` needs its payload up front, so a full-frame ``to_csv()`` /
    ``json.dumps()`` otherwise runs on EVERY rerun of the page — seconds of work per
    interaction at 100k+ rows, thrown away unless the user actually downloads.

    * ``row_count <= threshold``: build eagerly and render a plain download button —
      identical one-click UX to before.
    * larger: render a "Prepare …" button. Clicking it calls ``build()`` once, stashes
      ``(sig, payload)`` in session state, and reruns (fragment-scoped when inside a
      fragment) so the real download button takes its place. A changed ``sig`` (new scan,
      different filters) invalidates the stashed payload and shows Prepare again — one
      payload per ``key`` is kept, so memory stays bounded.

    ``build`` is a zero-arg callable returning bytes.
    """
    if disabled or row_count <= threshold:
        st.download_button(
            label, data=b"" if disabled else build(), file_name=file_name, mime=mime,
            key=key, disabled=disabled, **button_kwargs,
        )
        return
    payload_key = f"{key}_payload"
    stashed = st.session_state.get(payload_key)
    if stashed and stashed[0] == sig:
        st.download_button(
            label, data=stashed[1], file_name=file_name, mime=mime, key=key, **button_kwargs,
        )
        return
    st.session_state.pop(payload_key, None)
    prepare_label = (
        label.replace("Download", "Prepare", 1) if "Download" in label else f"Prepare {label}"
    )
    if st.button(
        prepare_label,
        key=f"{key}_prepare",
        help=f"Builds the export ({row_count:,} rows) on demand, then offers the download.",
        icon=":material/build:",
        **{k: v for k, v in button_kwargs.items() if k in ("width", "use_container_width")},
    ):
        st.session_state[payload_key] = (sig, build())
        try:
            st.rerun(scope="fragment")
        except Exception:  # not inside a fragment -- plain app rerun
            st.rerun()
