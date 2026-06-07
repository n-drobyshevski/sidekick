"""OS vulnerabilities page: severity breakdown, MTTR/SLA, findings table + export.

Handles BOTH Wiz response shapes:
* flat per-finding -> severity cards (with deltas) + MTTR/SLA + filter + table
* grouped-by-asset -> severity counts from analytics + asset table (MTTR N/A)
"""

import re

import pandas as pd
import streamlit as st

from wiz_dashboard.config import (
    SEVERITY_COLORS,
    SEVERITY_GLYPHS,
    SEVERITY_ORDER,
)
from wiz_dashboard.data.transform import df_signature, nodes_to_dataframe
from wiz_dashboard.domain.severity import (
    normalize_severity,
    normalize_severity_series,
)
from wiz_dashboard.models import schema
from wiz_dashboard.ui import charts
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui import scan
from wiz_dashboard.ui.pages import _derived


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

# "Group by" options: control label -> internal mode / query-param token. The atype and
# cloud tokens are shared with the matching filters so a grouped URL reads naturally
# (e.g. ?group=cloud), and "None" (no grouping) restores the single flat table.
GROUP_LABEL_TO_MODE = {"Severity": "severity", "Asset type": "atype", "Cloud": "cloud"}
_MODE_TO_LABEL = {v: k for k, v in GROUP_LABEL_TO_MODE.items()}


def page():
    render(st.session_state.get("has_creds", False))


def render(has_creds: bool) -> None:
    run, refresh = ui.page_scaffold(
        "OS vulnerabilities",
        "CVEs discovered on host workloads via Wiz Security Graph",
        run_key="os_run",
    )

    if run or refresh:
        scan.run_scan(force=refresh, has_creds=has_creds)

    nodes = st.session_state.get("os_nodes")
    df = st.session_state.get("os_df", pd.DataFrame())

    if not nodes:
        ui.empty_state(
            "No findings loaded",
            "Click **Run scan** to query Wiz. Without credentials a dry-run "
            "with sample data is used.",
        )
        ui.section_label("Severity breakdown")
        ui.severity_skeleton()
        return

    if schema.is_grouped_shape(nodes):
        _render_grouped(nodes, has_creds)
    else:
        _render_flat(df)

    # Open the detail panel here, at APP scope. The flat table renders inside an
    # @st.fragment, and a dialog opened during a fragment-scoped rerun does not render
    # at the app root — so ticking a row's Open box only stashes the pick + reruns,
    # and the actual open happens below (see _handle_open_tick).
    _maybe_render_drilldown()


def _severity_cards(counts, prev=None):
    ui.severity_cards(counts, prev)


def _severity_prev():
    """Baseline for the severity breakdown's scan-over-scan change badges.

    Prefer the in-session previous scan (``os_prev_counts``); when that's empty — a fresh
    session's first scan — fall back to the durable ledger's previous flat scan. That
    fallback is what makes the % badges appear across sessions, the same way the MTTR KPIs
    read their baseline from the durable trend (see ``mttr._prev_from_trend``)."""
    return st.session_state.get("os_prev_counts") or _derived.previous_severity_counts_cached()


def _change(cur, prev):
    """``{delta, pct}`` for a value vs its previous reading: the absolute change always, the
    ``· ±N%`` only on a non-zero base (a count rising from 0 shows the absolute alone) —
    matching the severity breakdown / MTTR chips. ``{}`` when there's no baseline."""
    if prev is None:
        return {}
    return {"delta": cur - prev, "pct": ((cur - prev) / prev * 100) if prev else None}


def _hero_flat(df, counts, prev_counts) -> None:
    """At-a-glance KPI band above the severity breakdown (flat shape).

    Remediation/MTTR KPIs live on the dedicated MTTR & SLA page now, so this band is
    severity-focused: total plus the top three severities, each with a scan-over-scan
    change chip — absolute delta plus the muted ``· ±N%``, consistent with the severity
    breakdown list below. ``prev_counts`` is the same baseline that list uses (in-session
    or the durable fallback), so a count missing from it simply shows no chip.
    """
    total = int(len(df))
    prev_total = sum(prev_counts.values()) if prev_counts else None

    def _sev_change(sev):
        return _change(int(counts.get(sev, 0)), prev_counts[sev]) if (
            prev_counts and sev in prev_counts) else {}

    ui.kpi_row(
        [
            {"label": "Total findings", "value": f"{total:,}", "accent": "var(--accent)",
             **_change(total, prev_total)},
            {"label": "Critical", "value": f"{int(counts.get('CRITICAL', 0)):,}",
             "glyph_html": ui.sev_dot_html("CRITICAL"), "accent": SEVERITY_COLORS["CRITICAL"],
             **_sev_change("CRITICAL")},
            {"label": "High", "value": f"{int(counts.get('HIGH', 0)):,}",
             "glyph_html": ui.sev_dot_html("HIGH"), "accent": SEVERITY_COLORS["HIGH"],
             **_sev_change("HIGH")},
            {"label": "Medium", "value": f"{int(counts.get('MEDIUM', 0)):,}",
             "glyph_html": ui.sev_dot_html("MEDIUM"), "accent": SEVERITY_COLORS["MEDIUM"],
             **_sev_change("MEDIUM")},
        ]
    )


def _hero_grouped(counts, n_assets) -> None:
    """KPI band for the grouped-by-asset shape (counts only; no MTTR/SLA)."""
    ui.kpi_row(
        [
            {"label": "Assets", "value": f"{n_assets:,}", "accent": "var(--accent)"},
            {"label": "Total findings", "value": f"{sum(counts.values()):,}", "accent": "var(--accent)"},
            {"label": "Critical", "value": f"{counts.get('CRITICAL', 0):,}",
             "glyph_html": ui.sev_dot_html("CRITICAL"), "accent": SEVERITY_COLORS["CRITICAL"]},
            {"label": "High", "value": f"{counts.get('HIGH', 0):,}",
             "glyph_html": ui.sev_dot_html("HIGH"), "accent": SEVERITY_COLORS["HIGH"]},
        ]
    )


def _render_flat(df) -> None:
    sig = df_signature(df)
    counts = _derived.counts_cached(sig, df)
    prev = _severity_prev()  # same baseline as the breakdown card (durable fallback)

    _hero_flat(df, counts, prev)

    # The severity breakdown card + click-to-filter bar render as a 2-column row inside
    # the filter fragment, so a bar-click cross-filters the table on a cheap fragment
    # rerun (shared rerun scope with the pills).
    _filter_and_table(df, counts)


def _render_grouped(nodes, has_creds) -> None:
    groups = [g for g in schema.parse_nodes(nodes) if isinstance(g, schema.AssetGroup)]
    counts = schema.severity_counts_from_groups(groups)

    _hero_grouped(counts, len(groups))

    ui.section_label("Severity breakdown (grouped by asset)")
    bd_col, bar_col = st.columns(2, gap="large")
    with bd_col:
        _severity_cards(counts)
    with bar_col:
        charts.severity_bar(counts)
    st.info(
        f"**Grouped-by-asset response** — {len(groups):,} assets · "
        f"{sum(counts.values()):,} findings. MTTR and SLA need per-finding timestamps "
        "(first-detected / resolved), which grouped responses omit — so only severity "
        "counts and the assets table below are shown. Use **Show individual findings** "
        "to load the per-finding view (filters, Group by, drill-down and MTTR)."
    )
    # Degroup: the grouped response carries only counts, so we can't expand it in place —
    # instead re-fetch the flat per-finding shape and let render() route to _render_flat.
    if st.button(
        "Show individual findings",
        key="os_degroup",
        type="primary",
        icon=":material/table_rows:",
        help="Re-fetch the per-finding shape so filters, Group by, drill-down and MTTR "
        "work. In dry-run this loads the flat sample dataset (the grouped response "
        "carries only counts).",
    ):
        st.session_state["_pending_dry_run_shape"] = "flat"  # keep the sidebar toggle in sync
        scan.run_scan(force=True, has_creds=has_creds, sample_shape="flat")
        st.rerun()  # re-render via the flat branch now that os_nodes is flat
    ui.section_label("Assets")
    _show_table(nodes_to_dataframe(nodes), key="grouped_csv", nodes=nodes)


def _col(df, *cands):
    """First of ``cands`` that's a column in ``df`` (exact match), else None."""
    for c in cands:
        if c in df.columns:
            return c
    return None


def _present(df, col):
    """Sorted unique non-blank string values of ``col`` (for filter options)."""
    if not col or col not in df.columns:
        return []
    return sorted({str(v) for v in df[col].dropna().tolist() if str(v).strip()})


def _qp_list(param, present):
    """Query-param CSV -> the subset that's a valid option (empty = no filter)."""
    raw = st.query_params.get(param, "")
    if not raw:
        return []
    allowed = set(present)
    return [x for x in raw.split(",") if x in allowed]


@st.fragment
def _filter_and_table(df, counts) -> None:
    """Severity chart + filters + table, in a fragment so a filter change doesn't
    recompute MTTR for the whole page.

    The severity bar is click-to-select: a bar click writes the chosen severity into
    ``os_sev_filter`` (the pills' state), so the pills stay the single source of truth.
    Severity pills (default all present), plus optional status / asset-type / cloud
    multi-selects and a free-text search over CVE + asset name. Each control is mirrored
    to a query param so a filtered view is shareable via URL.
    """
    # Severity breakdown card + click-to-filter bar, side by side (2 columns). The bar
    # only *reports* clicks (no second source of truth beside the pills); the breakdown
    # card shows full per-severity counts with scan-over-scan deltas, unaffected by the
    # filter (so it re-renders identically on each cheap fragment rerun). The baseline
    # falls back to the durable ledger so the % badges show on a session's first scan.
    prev = _severity_prev()
    ui.section_label("Severity breakdown")
    bd_col, bar_col = st.columns(2, gap="large")
    with bd_col:
        _severity_cards(counts, prev)
    with bar_col:
        chart_rendered, chart_sel = charts.severity_bar_select(counts, key="os_sev_chart")
        if chart_rendered:
            st.caption("Click a severity bar to filter the findings below (double-click to clear).")

    ui.section_label("Filter")
    # Normalize severities once (vectorized) and reuse for both the option list
    # and the row filter, instead of running normalize_severity per-row twice.
    norm = normalize_severity_series(df["severity"]) if "severity" in df.columns else None
    present = [s for s in SEVERITY_ORDER if s in set(norm)] if norm is not None else list(SEVERITY_ORDER)

    # Reconcile a NEW chart click into the pills' state *before* the pills widget is
    # instantiated (a widget key can't be mutated once its widget has rendered this run).
    # Only a non-empty change applies, so clicking a bar narrows the filter while
    # clicking elsewhere leaves it alone; os_sev_chart_prev guards against re-applying
    # the same selection on every rerun.
    chart_sel = [s for s in chart_sel if s in present]
    if chart_sel and chart_sel != st.session_state.get("os_sev_chart_prev"):
        st.session_state["os_sev_filter"] = chart_sel
    st.session_state["os_sev_chart_prev"] = chart_sel

    sev_selected = st.pills(
        "Severity",
        options=present,
        default=_sev_from_query(present),
        selection_mode="multi",
        key="os_sev_filter",
        label_visibility="collapsed",
    )
    st.query_params["sev"] = ",".join(sev_selected)

    status_col = _col(df, "status")
    type_col = _col(df, "vulnerableAsset.type", "type")
    cloud_col = _col(df, "vulnerableAsset.cloudPlatform", "cloudPlatform")
    name_col = _col(df, "name")
    asset_col = _col(df, "vulnerableAsset.name")

    fc = st.columns([2, 2, 2, 3])
    status_sel = (
        fc[0].multiselect("Status", _present(df, status_col),
                          default=_qp_list("status", _present(df, status_col)),
                          key="os_status_filter", placeholder="All")
        if status_col else []
    )
    type_sel = (
        fc[1].multiselect("Asset type", _present(df, type_col),
                          default=_qp_list("atype", _present(df, type_col)),
                          key="os_type_filter", placeholder="All")
        if type_col else []
    )
    cloud_sel = (
        fc[2].multiselect("Cloud", _present(df, cloud_col),
                          default=_qp_list("cloud", _present(df, cloud_col)),
                          key="os_cloud_filter", placeholder="All")
        if cloud_col else []
    )
    query = fc[3].text_input("Search", value=st.query_params.get("q", ""),
                             placeholder="CVE or asset name…", key="os_search")

    if status_col:
        st.query_params["status"] = ",".join(status_sel)
    if type_col:
        st.query_params["atype"] = ",".join(type_sel)
    if cloud_col:
        st.query_params["cloud"] = ",".join(cloud_sel)
    st.query_params["q"] = query or ""

    view = df[norm.isin(sev_selected)] if norm is not None else df
    if status_sel and status_col:
        view = view[view[status_col].astype(str).isin(status_sel)]
    if type_sel and type_col:
        view = view[view[type_col].astype(str).isin(type_sel)]
    if cloud_sel and cloud_col:
        view = view[view[cloud_col].astype(str).isin(cloud_sel)]
    if query:
        mask = pd.Series(False, index=view.index)
        for c in (name_col, asset_col):
            if c:
                mask = mask | view[c].astype(str).str.contains(query, case=False, na=False, regex=False)
        view = view[mask]

    # Group by — a single-select view option (a "menu like filters"): its state is
    # mirrored to session_state + ?group= just like the filters, and it's applied AFTER
    # filtering so the groups reflect the current filtered view. Only offer fields that
    # exist in this response shape; "None" keeps today's flat table.
    group_opts = ["None"]
    if "severity" in df.columns:
        group_opts.append("Severity")
    if type_col:
        group_opts.append("Asset type")
    if cloud_col:
        group_opts.append("Cloud")
    ui.section_label("Group by")
    group_label = st.segmented_control(
        "Group by",
        options=group_opts,
        default=_group_from_query(group_opts),
        key="os_group_by",
        label_visibility="collapsed",
    )
    st.query_params["group"] = GROUP_LABEL_TO_MODE.get(group_label or "None", "")

    ui.section_label("Findings")
    mode = GROUP_LABEL_TO_MODE.get(group_label or "None")
    nodes = st.session_state.get("os_nodes")
    if not mode or view.empty:
        _show_table(view, full=df, key="flat_csv", nodes=nodes)
    else:
        _show_grouped(view, df, "flat_csv", nodes, mode, type_col, cloud_col)


_CVE_RE = r"CVE-\d{4}-\d+"
_DATE_COLS = ("firstDetectedAt", "firstSeenAt", "lastDetectedAt", "resolvedAt", "createdAt")


def _table_display(ordered):
    """Build a display copy + column_config: dates -> DatetimeColumn, CVE names ->
    NVD links, severity -> glyph. The raw ``ordered`` frame is left untouched so the
    CSV export and the drill-down record keep their original values.
    """
    df = ordered.copy()
    cfg = {}
    for col in df.columns:
        if any(col == d or col.endswith("." + d) for d in _DATE_COLS):
            df[col] = pd.to_datetime(df[col], errors="coerce", utc=True)
            cfg[col] = st.column_config.DatetimeColumn(col, format="YYYY-MM-DD")
    if "name" in df.columns:
        names = df["name"].dropna().astype(str)
        if len(names) and names.str.fullmatch(_CVE_RE, case=False).all():
            df["name"] = "https://nvd.nist.gov/vuln/detail/" + df["name"].astype(str)
            cfg["name"] = st.column_config.LinkColumn(
                "CVE", help="Open on the NVD", display_text=f"({_CVE_RE})"
            )
    if "severity" in df.columns:
        df["severity"] = df["severity"].map(_sev_with_glyph)
        cfg["severity"] = st.column_config.TextColumn("Severity")
    return df, cfg


def _sev_with_glyph(value):
    if not isinstance(value, str) or not value:
        return value
    return f"{SEVERITY_GLYPHS.get(normalize_severity(value), '')} {value}".strip()


def _column_choice(view, key):
    """Render the column-visibility multiselect and return the chosen columns (ordered).

    Hoisted out of the renderer so the grouped view shows ONE picker shared by every
    per-group table (not one per group). Default is the preferred set; persisted via key.
    """
    preferred = [c for c in PREFERRED_COLS if c in view.columns]
    rest = [c for c in view.columns if c not in preferred and not c.startswith("_")]
    all_cols = preferred + rest
    chosen = st.multiselect(
        "Columns",
        options=all_cols,
        default=preferred or all_cols[:8],
        key=f"{key}_cols",
        label_visibility="collapsed",
        placeholder="Choose columns to display",
    )
    return [c for c in all_cols if c in chosen] or preferred or all_cols


def _editor(subview, cols, editor_key, nodes, height=520) -> None:
    """Render one read-only findings table for ``subview`` and wire its Open-tick to the
    drill-down. The grouped path calls this once per group with that group's subframe;
    because pandas slicing preserves the index, _handle_open_tick maps a ticked row back
    to its raw node correctly.

    A single pinned (frozen) "Open" checkbox is each row's one-click trigger: tick it to
    open the finding's details. It auto-resets (the editor gets a fresh key on each open,
    see _handle_open_tick) so it behaves like a button; all other columns are read-only.
    st.data_editor is used (not st.dataframe) because its checkbox edit round-trips
    reliably on a single click — unlike row-selection, which needs the native selection
    checkbox and ignores clicks on the data cells.
    """
    display_df, col_cfg = _table_display(subview[cols])
    display_df.insert(0, "Open", False)
    col_cfg["Open"] = st.column_config.CheckboxColumn(
        "Open", help="Open this finding's details", width="small", pinned=True, default=False
    )
    edited = st.data_editor(
        display_df,
        width="stretch",
        hide_index=True,
        height=height,
        key=editor_key,
        column_config=col_cfg,
        disabled=[c for c in display_df.columns if c != "Open"],
    )
    # Pass the full-column ``subview`` (not the column-limited display frame) so the
    # detail panel stays complete regardless of which columns are visible.
    _handle_open_tick(edited, subview, nodes)


def _export_button(view, key) -> None:
    """One CSV download of the full filtered rows (all public columns), not just the
    visible ones — and, when grouped, the whole filtered set rather than per group."""
    export_df = view[[c for c in view.columns if not str(c).startswith("_")]]
    st.download_button(
        "Download CSV",
        data=export_df.to_csv(index=False).encode("utf-8"),
        file_name="os_findings.csv",
        mime="text/csv",
        key=key,
    )


def _show_table(view, full=None, key="csv", nodes=None) -> None:
    full = view if full is None else full
    if view.empty:
        st.info("No findings match the current filters — clear them to see all.")
        return
    cols = _column_choice(view, key)
    nonce = st.session_state.get("os_editor_nonce", 0)
    _editor(view, cols, f"{key}_editor_{nonce}", nodes)
    shown = f"{len(view):,} of {len(full):,}"
    suffix = " (filtered)" if len(view) != len(full) else ""
    st.caption(f"{shown} rows shown{suffix} · tick a row's Open box to view details.")
    _export_button(view, key)


def _grouped_frames(view, mode, type_col, cloud_col):
    """Split ``view`` into ordered ``[(label, subframe), ...]`` for the group mode.

    severity -> SEVERITY_ORDER (present values only, severest first); atype/cloud -> the
    raw column values, busiest group first. Pure (no Streamlit) so ordering/splitting is
    unit-testable; each subframe keeps ``view``'s index so the drill-down still resolves.
    """
    if mode == "severity":
        keys = normalize_severity_series(view["severity"])
        order = [s for s in SEVERITY_ORDER if s in set(keys)]
    else:
        col = type_col if mode == "atype" else cloud_col
        keys = view[col].astype(str)
        order = list(keys.value_counts().index)  # busiest group first
    return [(g, view[keys == g]) for g in order]


def _show_grouped(view, full, key, nodes, mode, type_col, cloud_col) -> None:
    """Findings split into collapsible per-group sections — one count-labelled expander
    per group value, each holding that group's own findings table. The column picker
    renders once above all groups; one CSV export covers the whole filtered set."""
    cols = _column_choice(view, key)
    nonce = st.session_state.get("os_editor_nonce", 0)
    groups = _grouped_frames(view, mode, type_col, cloud_col)
    for i, (label, sub) in enumerate(groups):
        # Severity headers carry the glyph (a non-color signal, matching the table's
        # severity column); others show value + count. The busiest/severest group is
        # open by default, the rest start collapsed (progressive disclosure).
        if mode == "severity":
            header = f"{SEVERITY_GLYPHS.get(label, '')} {label} · {len(sub):,}".strip()
        else:
            header = f"{label} · {len(sub):,}"
        height = min(38 * (len(sub) + 1) + 3, 420)  # compact for small groups
        with st.expander(header, expanded=(i == 0)):
            _editor(sub, cols, f"{key}_g{i}_editor_{nonce}", nodes, height=height)
    st.caption(
        f"{len(view):,} findings across {len(groups)} group(s) · "
        "tick a row's Open box to view details."
    )
    _export_button(view, key)


def _sev_from_query(present):
    raw = st.query_params.get("sev", "")
    if not raw:
        return list(present)
    chosen = [s for s in raw.upper().split(",") if s in present]
    return chosen or list(present)


def _group_from_query(opts):
    """``?group=`` token -> the matching control label, or 'None' if it's absent or not
    an available option for this response shape."""
    label = _MODE_TO_LABEL.get(st.query_params.get("group", ""))
    return label if label in opts else "None"


# --------------------------------------------------------------------------- #
#  Drill-down (single-row selection on the findings/assets table). The side sheet
#  renders the shape-aware body from ui.vuln_detail_html — the single source of
#  truth (see wiz_dashboard/ui/components.py).
# --------------------------------------------------------------------------- #
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


def _raw_node(frame, pos, nodes):
    """Map a displayed-row position back to its original raw node, when available."""
    if not nodes:
        return None
    try:
        idx = int(frame.index[pos])
    except Exception:
        return None
    return nodes[idx] if 0 <= idx < len(nodes) else None


def _handle_open_tick(edited, frame, nodes) -> None:
    """st.data_editor handler (runs inside the table's fragment on the flat path).

    When a row's "Open" box is ticked, STASH that finding and trigger a full app rerun.
    A dialog opened during a fragment-scoped rerun won't render at the app root, so the
    open happens at app scope in _maybe_render_drilldown(). Bumping os_editor_nonce
    gives the editor a fresh key, which clears the box (button-like) and lets the same
    row be reopened.
    """
    if "Open" not in getattr(edited, "columns", []):
        return
    ticked = next((i for i, v in enumerate(edited["Open"].tolist()) if bool(v)), None)
    if ticked is None:
        return
    st.session_state["os_drill_record"] = _record_to_dict(frame.iloc[ticked])
    st.session_state["os_drill_raw"] = _raw_node(frame, ticked, nodes)
    st.session_state["os_drill_pending"] = True
    st.session_state["os_editor_nonce"] = st.session_state.get("os_editor_nonce", 0) + 1
    st.rerun()  # app-scope rerun so the dialog can render outside the fragment


def _maybe_render_drilldown() -> None:
    """Open the stashed finding at APP scope (called from render(), not the table's
    fragment, where a dialog won't render). The pending flag is consumed exactly once
    per tick, so the panel opens once and reopening the same row works."""
    if not st.session_state.pop("os_drill_pending", False):
        return
    record = st.session_state.get("os_drill_record")
    if record is None:
        return
    raw = st.session_state.get("os_drill_raw")
    _finding_sheet(record, raw)


def _finding_footer(record: dict) -> None:
    """Footer links: an NVD deep-link for CVE names, plus a vendor advisory link if present."""
    name = record.get("name")
    if name and re.fullmatch(_CVE_RE, str(name), flags=re.IGNORECASE):
        st.link_button(
            "Open on NVD",
            f"https://nvd.nist.gov/vuln/detail/{name}",
            help="Open this CVE on the National Vulnerability Database",
        )
    link = record.get("link") or record.get("url")
    if isinstance(link, str) and link.startswith("http"):
        st.link_button("Vendor advisory", link, help="Open the vendor advisory")


@st.dialog("Finding details", width="large")
def _finding_sheet(record: dict, raw=None) -> None:
    """Drill-down rendered as a right-anchored shadcn "Sheet". This is a native
    ``st.dialog`` (so it keeps the scrim, ESC-to-close, focus trap and close "X");
    the leading ``.vuln-sheet-marker`` sentinel scopes the sheet CSS in styles.css
    to *only* this dialog, so a selector miss degrades to a centered dialog."""
    st.markdown('<span class="vuln-sheet-marker" hidden></span>', unsafe_allow_html=True)
    st.markdown(ui.vuln_detail_html(record, raw), unsafe_allow_html=True)
    with st.expander("Raw JSON", expanded=False):
        st.json(raw if raw is not None else record)
    _finding_footer(record)
