"""OS vulnerabilities page: severity breakdown, MTTR/SLA, findings table + export.

Handles BOTH Wiz response shapes:
* flat per-finding -> severity cards (with deltas) + MTTR/SLA + filter + table
* grouped-by-asset -> severity counts from analytics + asset table (MTTR N/A)
"""

from html import escape as html_escape

import pandas as pd
import streamlit as st

from wiz_dashboard.config import SEVERITY_COLORS, SEVERITY_ORDER
from wiz_dashboard.data.client import fetch_findings
from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe
from wiz_dashboard.domain.severity import count_by_severity, normalize_severity
from wiz_dashboard.models import schema
from wiz_dashboard.ui import charts
from wiz_dashboard.ui import components as ui

PREFERRED_COLS = [
    "severity",
    "name",
    "vulnerableAsset.name",
    "vulnerableAsset.type",
    "firstDetectedAt",
    "firstSeenAt",
    "resolvedAt",
    "status",
    "fixedVersion",
]


def page():
    render(st.session_state.get("has_creds", False))


def render(has_creds: bool) -> None:
    ui.render_page_header(
        "OS vulnerabilities",
        "CVEs discovered on host workloads via Wiz Security Graph",
    )

    c1, c2, _ = st.columns([1, 1, 6])
    run = c1.button("Run scan", type="primary", key="os_run", width="stretch")
    refresh = c2.button("Refresh", key="os_refresh", width="stretch")

    if run or refresh:
        _run_scan(force=refresh, has_creds=has_creds)

    nodes = st.session_state.get("os_nodes")
    df = st.session_state.get("os_df", pd.DataFrame())

    if not nodes:
        ui.empty_state(
            "No findings loaded",
            "Click <b>Run scan</b> to query Wiz. Without credentials a dry-run "
            "with sample data is used.",
        )
        ui.section_label("Severity breakdown")
        for col in st.columns(len(SEVERITY_ORDER)):
            with col:
                ui.metric_skeleton()
        return

    if schema.is_grouped_shape(nodes):
        _render_grouped(nodes)
    else:
        _render_flat(df)


def _run_scan(force: bool, has_creds: bool) -> None:
    if force:
        fetch_findings.clear()
    prev = st.session_state.get("os_counts", {})
    try:
        with st.spinner("Querying Wiz…"):
            results = fetch_findings(dry_run=not has_creds, use_config=has_creds)
    except Exception as exc:  # noqa: BLE001 -- surfaced to the user with a traceback
        ui.show_exception(exc, title="Run scan failed")
        return
    if results is None:
        st.error("Scan produced no output. Check credentials or os_vulns.py.")
        return
    nodes = extract_nodes(results)
    df = nodes_to_dataframe(nodes)
    st.session_state["os_nodes"] = nodes
    st.session_state["os_df"] = df
    st.session_state["os_raw"] = results
    st.session_state["os_prev_counts"] = prev
    st.session_state["os_counts"] = count_by_severity(df)
    ui.show_toast(f"Loaded {len(nodes):,} findings", "success")


def _severity_cards(counts, prev=None):
    cols = st.columns(len(SEVERITY_ORDER))
    for col, sev in zip(cols, SEVERITY_ORDER):
        with col:
            cur = counts.get(sev, 0)
            delta = None
            if prev is not None and prev.get(sev) is not None:
                delta = cur - prev.get(sev)
            ui.metric_card(
                sev.title(), f"{cur:,}", color=SEVERITY_COLORS[sev], delta=delta
            )


def _render_flat(df) -> None:
    counts = count_by_severity(df)
    ui.section_label("Severity breakdown")
    _severity_cards(counts, st.session_state.get("os_prev_counts", {}))
    charts.severity_bar(counts)

    ui.section_label("Remediation performance")
    ui.render_mttr_widget(df)

    _filter_and_table(df)


def _render_grouped(nodes) -> None:
    groups = [g for g in schema.parse_nodes(nodes) if isinstance(g, schema.AssetGroup)]
    counts = schema.severity_counts_from_groups(groups)
    ui.section_label("Severity breakdown (grouped by asset)")
    _severity_cards(counts)
    charts.severity_bar(counts)
    st.caption(
        f"{len(groups):,} assets · {sum(counts.values()):,} findings. "
        "MTTR/SLA need per-finding timestamps, which grouped responses omit."
    )
    ui.section_label("Assets")
    _show_table(nodes_to_dataframe(nodes), key="grouped_csv", nodes=nodes)


@st.fragment
def _filter_and_table(df) -> None:
    """Filter + table in a fragment so changing the filter doesn't recompute MTTR."""
    ui.section_label("Filter")
    if "severity" in df.columns:
        normalized = df["severity"].apply(normalize_severity)
        present = [s for s in SEVERITY_ORDER if s in set(normalized)]
    else:
        present = list(SEVERITY_ORDER)

    selected = st.pills(
        "Severity",
        options=present,
        default=_sev_from_query(present),
        selection_mode="multi",
        key="os_sev_filter",
        label_visibility="collapsed",
    )
    st.query_params["sev"] = ",".join(selected)

    ui.section_label("Findings")
    if "severity" in df.columns:
        view = df[df["severity"].apply(normalize_severity).isin(selected)]
    else:
        view = df
    _show_table(view, full=df, key="flat_csv", nodes=st.session_state.get("os_nodes"))


def _show_table(view, full=None, key="csv", nodes=None) -> None:
    full = view if full is None else full
    if view.empty:
        st.caption("No findings match the current filter.")
        return
    preferred = [c for c in PREFERRED_COLS if c in view.columns]
    rest = [c for c in view.columns if c not in preferred and not c.startswith("_")]
    ordered = view[preferred + rest]
    event = st.dataframe(
        ordered,
        width="stretch",
        hide_index=True,
        height=520,
        on_select="rerun",
        selection_mode="single-row",
        key=f"{key}_table",
    )
    st.caption(f"{len(view):,} of {len(full):,} rows shown · select a row to drill in.")
    st.download_button(
        "Download CSV",
        data=ordered.to_csv(index=False).encode("utf-8"),
        file_name="os_findings.csv",
        mime="text/csv",
        key=key,
    )
    _maybe_open_drilldown(ordered, event, nodes, key)


def _sev_from_query(present):
    raw = st.query_params.get("sev", "")
    if not raw:
        return list(present)
    chosen = [s for s in raw.upper().split(",") if s in present]
    return chosen or list(present)


# --------------------------------------------------------------------------- #
#  Drill-down dialog (single-row selection on the findings/assets table)
# --------------------------------------------------------------------------- #
_SUMMARY_FIELDS = [
    ("Severity", ("severity",)),
    ("Status", ("status",)),
    ("Asset", ("vulnerableAsset.name",)),
    ("Asset type", ("vulnerableAsset.type",)),
    ("Cloud", ("vulnerableAsset.cloudPlatform", "cloudPlatform")),
    ("First detected", ("firstDetectedAt", "firstSeenAt")),
    ("Resolved", ("resolvedAt",)),
    ("Fixed version", ("fixedVersion",)),
    ("Total findings", ("analytics.totalFindingCount",)),
    ("Critical", ("analytics.criticalSeverityFindingCount",)),
]


def _record_to_dict(series) -> dict:
    """A table row (pandas Series) -> clean, JSON-able dict (drop NaN and _private)."""
    out = {}
    for k, v in series.items():
        if str(k).startswith("_"):
            continue
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        if hasattr(v, "item"):
            try:
                v = v.item()
            except Exception:
                v = str(v)
        out[str(k)] = v
    return out


def _summary_fields(record: dict):
    """Pick the key display fields that are present, in a stable order."""
    fields = []
    for label, candidates in _SUMMARY_FIELDS:
        for k in candidates:
            v = record.get(k)
            if v not in (None, ""):
                fields.append((label, str(v)))
                break
    return fields


def _raw_node(ordered, pos, nodes):
    """Map a displayed-row position back to its original raw node, when available."""
    if not nodes:
        return None
    try:
        idx = int(ordered.index[pos])
    except Exception:
        return None
    return nodes[idx] if 0 <= idx < len(nodes) else None


def _maybe_open_drilldown(ordered, event, nodes, key) -> None:
    rows = getattr(getattr(event, "selection", None), "rows", None) or []
    shown_key = f"{key}_shown"
    if not rows:
        st.session_state.pop(shown_key, None)
        return
    pos = rows[0]
    # Guard against reopening the dialog on the rerun that follows dismissing it.
    if st.session_state.get(shown_key) == pos:
        return
    st.session_state[shown_key] = pos
    _finding_dialog(_record_to_dict(ordered.iloc[pos]), _raw_node(ordered, pos, nodes))


@st.dialog("Finding details", width="large")
def _finding_dialog(record: dict, raw=None) -> None:
    title = (
        record.get("name")
        or record.get("vulnerableAsset.name")
        or record.get("id")
        or "Details"
    )
    st.markdown(f"#### {html_escape(str(title))}")

    sev = record.get("severity")
    if sev:
        color = SEVERITY_COLORS.get(normalize_severity(sev), "#6b7280")
        st.markdown(
            f'<span class="status-pill" style="background:{color}22; color:{color};">'
            f"{html_escape(str(sev))}</span>",
            unsafe_allow_html=True,
        )

    fields = _summary_fields(record)
    if fields:
        cols = st.columns(2)
        for i, (label, value) in enumerate(fields):
            with cols[i % 2]:
                st.caption(label)
                st.markdown(f"**{html_escape(value)}**")

    with st.expander("Raw JSON", expanded=False):
        st.json(raw if raw is not None else record)
