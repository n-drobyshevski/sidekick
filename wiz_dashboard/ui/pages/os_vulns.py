"""OS vulnerabilities page: scan-summary band, severity breakdown, findings table.

Handles BOTH Wiz response shapes:
* flat per-finding -> summary band + severity breakdown (with deltas) + filter/group + table
* grouped-by-asset -> summary band + severity counts from analytics + asset table

The scan-summary band (Total / Open / Resolved for flat; Assets / Total for grouped) describes
THIS scan only, so it agrees with the findings table. The cross-scan remediation analytics —
Median MTTR, In-SLA %, the trend — live on the MTTR & SLA page, reached via the band's link, so
no two surfaces show different remediation numbers. Severity counts appear once (breakdown card
+ bar), never echoed in the band.
"""

import re

import pandas as pd
import streamlit as st

from wiz_dashboard.config import (
    RESOLVED_STATUSES,
    SEVERITY_COLORS,
    SEVERITY_GLYPHS,
    SEVERITY_ORDER,
)
from wiz_dashboard.data.transform import nodes_to_dataframe
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

# "Group by" options: control label -> (query-param token, candidate columns). The first
# candidate column present in the response shape wins, so an option is only offered when its
# field exists. Tokens are shared with the matching filters where they overlap (atype, cloud)
# so a grouped URL reads naturally (e.g. ?group=cloud); "None" (no grouping) restores the
# single flat table. Severity is special-cased downstream (normalized + severest-first);
# every other option splits on the raw column value, busiest group first.
GROUP_OPTIONS = {
    "Severity": ("severity", ["severity"]),
    "Status": ("status", ["status"]),
    "Asset type": ("atype", ["vulnerableAsset.type", "type"]),
    "Cloud": ("cloud", ["vulnerableAsset.cloudPlatform", "cloudPlatform"]),
    "Asset": ("asset", ["vulnerableAsset.name"]),
    "Subscription": ("subscription", ["vulnerableAsset.subscriptionName"]),
}
GROUP_LABEL_TO_MODE = {label: token for label, (token, _) in GROUP_OPTIONS.items()}
_MODE_TO_LABEL = {v: k for k, v in GROUP_LABEL_TO_MODE.items()}


def page():
    render(st.session_state.get("has_creds", False))


def render(has_creds: bool) -> None:
    # Scanning is owned by the global sidebar trigger (app.py), which runs before this page
    # and writes the os_* session state — so the page only renders the result. This avoids a
    # second, identical "Run scan" CTA on the landing page (one primary action per context).
    ui.render_page_header(
        "OS vulnerabilities",
        "CVEs discovered on host workloads via Wiz Security Graph",
    )

    nodes = st.session_state.get("os_nodes")
    df = st.session_state.get("os_df")
    df = df if df is not None else pd.DataFrame()

    # On the start-up fast path os_nodes is deliberately None (lazy — see scan.ensure_nodes)
    # while os_df is populated, so "nothing loaded" must consider both.
    if df.empty and not nodes:
        ui.empty_state(
            "No findings loaded",
            "Run a scan from the **sidebar** to query Wiz. Without credentials a "
            "dry-run with sample data is used.",
        )
        ui.section_label("Severity breakdown")
        ui.severity_skeleton()
        return

    if scan.loaded_shape(nodes) == "grouped":
        _render_grouped(nodes or scan.ensure_nodes(), has_creds)
    else:
        _render_flat(df)

    # Open the detail panel here, at APP scope. The flat table renders inside an
    # @st.fragment, and a dialog opened during a fragment-scoped rerun does not render
    # at the app root — so ticking a row's Open box only stashes the pick + reruns,
    # and the actual open happens below (see _handle_open_tick).
    _maybe_render_drilldown()


def _severity_cards(counts, prev=None, per_sev=None):
    ui.severity_cards(counts, prev, per_sev=per_sev)


def _severity_prev():
    """Baseline for the severity breakdown's scan-over-scan change badges.

    Prefer the in-session previous scan (``os_prev_counts``); when that's empty — a fresh
    session's first scan — fall back to the durable ledger's previous flat scan. That
    fallback is what makes the % badges appear across sessions, the same way the MTTR KPIs
    read their baseline from the durable trend (see ``mttr._prev_from_trend``)."""
    return st.session_state.get("os_prev_counts") or _derived.previous_severity_counts_cached()


def _mttr_link() -> None:
    """Page-link from the posture band to the MTTR & SLA detail (the trend + per-severity
    posture live there). Uses the Page objects ``app.py`` shares; silently absent when the
    registry isn't populated (e.g. a unit test rendering this view in isolation)."""
    mttr_page = st.session_state.get("_pages", {}).get("MTTR & SLA")
    if mttr_page is not None:
        st.page_link(mttr_page, label="View MTTR & SLA", icon=":material/trending_up:")


def _scan_summary_band(*, total, df=None, n_assets=None) -> None:
    """Scan-summary band — counts for THIS scan + a pointer to the remediation analytics.

    Every figure here describes the current response, so it agrees with the findings table
    below (no scope mismatch). The cross-scan remediation analytics — Median MTTR, In-SLA %,
    the trend — live solely on the MTTR & SLA page, reached via the link, so two surfaces can
    never show different remediation numbers ("one verdict, one place"). Severity counts stay
    out of the band too; they appear once in the breakdown card + bar below.

    ``Assets`` (grouped shape) replaces Open/Resolved, since a grouped-by-asset response
    carries no per-finding open/resolved state.
    """
    cards = []
    if n_assets is not None:
        cards.append({"label": "Assets", "value": f"{n_assets:,}", "accent": "var(--accent)"})
    cards.append({"label": "Total findings", "value": f"{total:,}", "accent": "var(--accent)"})
    if df is not None and not df.empty:
        _per_sev, overall = _derived.mttr_cached(_derived.df_token(df), df)
        if overall:
            cards.append({
                "label": "Open", "value": f"{int(overall.get('open', 0)):,}",
                "accent": SEVERITY_COLORS["HIGH"],
                "help": "Findings in this scan still awaiting remediation.",
            })
            cards.append({
                "label": "Resolved", "value": f"{int(overall.get('resolved', 0)):,}",
                "accent": "#16a34a", "inverse": False,
                "help": "Findings in this scan with a recorded remediation.",
            })
    ui.kpi_row(cards)
    _mttr_link()


def _render_flat(df) -> None:
    sig = _derived.df_token(df)
    counts = _derived.counts_cached(sig, df)

    _scan_summary_band(total=int(len(df)), df=df)

    # per_sev provides per-severity open/resolved counts for the breakdown card sub-lines.
    per_sev, _overall = _derived.mttr_cached(sig, df)

    # The severity breakdown card + click-to-filter bar render as a 2-column row inside
    # the filter fragment, so a bar-click cross-filters the table on a cheap fragment
    # rerun (shared rerun scope with the pills).
    _filter_and_table(df, counts, per_sev or {})


def _render_grouped(nodes, has_creds) -> None:
    groups = [g for g in schema.parse_nodes(nodes) if isinstance(g, schema.AssetGroup)]
    counts = schema.severity_counts_from_groups(groups)

    _scan_summary_band(total=sum(counts.values()), n_assets=len(groups))

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
    """Sorted unique non-blank string values of ``col`` (for filter options).

    Deduplicates via ``.unique()`` (one C pass; codes-based and near-free on the
    ingestion layer's categorical columns) before any per-value Python work, instead of
    stringifying all 100k+ rows into a set."""
    if not col or col not in df.columns:
        return []
    return sorted({str(v) for v in df[col].dropna().unique() if str(v).strip()})


def _matches(series, selected):
    """Boolean mask: rows whose value's string form is one of ``selected``.

    Categorical columns match on their handful of categories instead of re-stringifying
    every row; other dtypes keep the ``str()`` coercion the option list was built with."""
    if isinstance(series.dtype, pd.CategoricalDtype):
        wanted = [c for c in series.cat.categories if str(c) in set(selected)]
        return series.isin(wanted)
    return series.astype(str).isin(selected)


def _qp_list(param, present):
    """Query-param CSV -> the subset that's a valid option (empty = no filter)."""
    raw = st.query_params.get(param, "")
    if not raw:
        return []
    allowed = set(present)
    return [x for x in raw.split(",") if x in allowed]


# Filter/search/group widget keys + the query params they mirror — cleared together by the
# "Clear filters" reset so one click returns the toolbar to its defaults. ``os_sev_chart*``
# are the click-to-filter chart's selection + its guard, cleared too so a stale bar-click
# doesn't immediately re-narrow the severity pills after a reset.
_FILTER_KEYS = (
    "os_sev_filter", "os_status_filter", "os_type_filter", "os_cloud_filter",
    "os_search", "os_group_by", "os_sev_chart", "os_sev_chart_prev",
)
_FILTER_QUERY_PARAMS = ("sev", "status", "atype", "cloud", "q", "group")


def _reset_filters() -> None:
    """Clear every findings filter/search/group control + its query param, then rerun so the
    widgets re-instantiate at their defaults (all severities, no filters, flat table)."""
    for k in _FILTER_KEYS:
        st.session_state.pop(k, None)
    for q in _FILTER_QUERY_PARAMS:
        try:
            del st.query_params[q]
        except KeyError:
            pass
    st.rerun()


@st.fragment
def _filter_and_table(df, counts, per_sev=None) -> None:
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
        _severity_cards(counts, prev, per_sev=per_sev)
    with bar_col:
        chart_rendered, chart_sel = charts.severity_bar_select(counts, key="os_sev_chart")
        if chart_rendered:
            st.caption("Click a severity bar to filter the findings below (double-click to clear).")

    ui.section_label("Filter")
    # Normalize severities once (vectorized) and reuse for both the option list
    # and the row filter, instead of running normalize_severity per-row twice.
    norm = normalize_severity_series(df["severity"]) if "severity" in df.columns else None
    present = [s for s in SEVERITY_ORDER if s in set(norm.unique())] if norm is not None else list(SEVERITY_ORDER)

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

    # One filter+view toolbar row: the text/select filters plus Group by, so the controls
    # read as a single bar instead of stacking under three separate section labels. Group by
    # is a VIEW option ("menu like filters"): its state mirrors to ?group= like the filters
    # and is applied AFTER filtering, so the groups reflect the current filtered view. Only
    # fields present in this shape are offered; "None" keeps the flat table.
    group_cols = _group_columns(df)
    group_opts = ["None", *group_cols]

    fc = st.columns([2, 2, 2, 3, 3])
    status_opts = _present(df, status_col)
    type_opts = _present(df, type_col)
    cloud_opts = _present(df, cloud_col)
    status_sel = (
        fc[0].multiselect("Status", status_opts,
                          default=_qp_list("status", status_opts),
                          key="os_status_filter", placeholder="All")
        if status_col else []
    )
    type_sel = (
        fc[1].multiselect("Asset type", type_opts,
                          default=_qp_list("atype", type_opts),
                          key="os_type_filter", placeholder="All")
        if type_col else []
    )
    cloud_sel = (
        fc[2].multiselect("Cloud", cloud_opts,
                          default=_qp_list("cloud", cloud_opts),
                          key="os_cloud_filter", placeholder="All")
        if cloud_col else []
    )
    query = fc[3].text_input("Search", value=st.query_params.get("q", ""),
                             placeholder="CVE or asset name…", key="os_search")
    group_label = fc[4].selectbox(
        "Group by",
        options=group_opts,
        index=group_opts.index(_group_from_query(group_opts)),
        key="os_group_by",
    )

    if status_col:
        st.query_params["status"] = ",".join(status_sel)
    if type_col:
        st.query_params["atype"] = ",".join(type_sel)
    if cloud_col:
        st.query_params["cloud"] = ",".join(cloud_sel)
    st.query_params["q"] = query or ""
    st.query_params["group"] = GROUP_LABEL_TO_MODE.get(group_label or "None", "")

    # One-click escape from a narrowed view — shown only when something is actually filtered
    # (so the toolbar stays clean at rest). Clears every control + query param and reruns.
    filters_active = (
        (norm is not None and set(sev_selected) != set(present))
        or bool(status_sel) or bool(type_sel) or bool(cloud_sel) or bool(query)
        or (group_label not in (None, "None"))
    )
    if filters_active and st.columns([2, 8])[0].button(
        "Clear filters",
        key="os_clear_filters",
        icon=":material/filter_alt_off:",
        help="Reset severity, filters, search and grouping to their defaults.",
    ):
        _reset_filters()

    view = df[norm.isin(sev_selected)] if norm is not None else df
    if status_sel and status_col:
        view = view[_matches(view[status_col], status_sel)]
    if type_sel and type_col:
        view = view[_matches(view[type_col], type_sel)]
    if cloud_sel and cloud_col:
        view = view[_matches(view[cloud_col], cloud_sel)]
    if query:
        mask = pd.Series(False, index=view.index)
        for c in (name_col, asset_col):
            if c:
                mask = mask | view[c].astype(str).str.contains(query, case=False, na=False, regex=False)
        view = view[mask]

    ui.section_label("Findings")
    mode = GROUP_LABEL_TO_MODE.get(group_label or "None")
    nodes = st.session_state.get("os_nodes")
    if not mode or view.empty:
        _show_table(view, full=df, key="flat_csv", nodes=nodes)
    else:
        _show_grouped(view, df, "flat_csv", nodes, mode, group_cols[group_label])


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
    visible ones — and, when grouped, the whole filtered set rather than per group.
    Deferred at scale: the full-frame CSV is only encoded when the user asks for it."""
    export_cols = [c for c in view.columns if not str(c).startswith("_")]
    sig = f"{_derived.df_token(view)}|{len(view)}|{view.index[0]}|{view.index[-1]}"
    ui.deferred_download(
        "Download CSV",
        lambda: view[export_cols].to_csv(index=False).encode("utf-8"),
        file_name="os_findings.csv",
        mime="text/csv",
        key=key,
        row_count=len(view),
        sig=sig,
    )


def _show_table(view, full=None, key="csv", nodes=None) -> None:
    full = view if full is None else full
    if view.empty:
        st.info("No findings match the current filters — clear them to see all.")
        return
    cols = _column_choice(view, key)
    # Only the current page is handed to the editor: st.data_editor serializes whatever
    # frame it's given to the browser on every rerun, which is what made a 100k-row scan
    # feel frozen. The pager snaps back to page 1 when the data (df_token) or the filter
    # result (length / boundary rows) changes, since the old offset is then meaningless.
    reset_token = f"{_derived.df_token(full)}|{len(view)}|{view.index[0]}|{view.index[-1]}"
    page_view = ui.paginate(view, key, reset_token=reset_token)
    nonce = st.session_state.get("os_editor_nonce", 0)
    page_no = st.session_state.get(f"{key}_pnum", 0)
    # The page number is part of the editor key so flipping pages can never replay one
    # page's lingering checkbox state onto another page's rows.
    _editor(page_view, cols, f"{key}_editor_{nonce}_p{page_no}", nodes)
    shown = f"{len(view):,} of {len(full):,}"
    suffix = " (filtered)" if len(view) != len(full) else ""
    st.caption(f"{shown} rows shown{suffix} · tick a row's Open box to view details.")
    _export_button(view, key)


def _group_columns(df):
    """Ordered ``{label: column}`` of the 'Group by' options available for ``df``.

    Walks ``GROUP_OPTIONS`` in declaration order, keeping only options whose field is
    present in this response shape (first matching candidate column wins). Pure, so the
    available-option set is unit-testable without Streamlit.
    """
    out = {}
    for label, (_token, cands) in GROUP_OPTIONS.items():
        col = _col(df, *cands)
        if col is not None:
            out[label] = col
    return out


def _grouped_frames(view, mode, col):
    """Split ``view`` into ordered ``[(label, subframe), ...]`` for the group mode.

    severity -> SEVERITY_ORDER (present values only, severest first); every other mode ->
    the raw ``col`` values, busiest group first. Pure (no Streamlit) so ordering/splitting
    is unit-testable; each subframe keeps ``view``'s index so the drill-down still resolves.
    """
    if mode == "severity":
        keys = normalize_severity_series(view["severity"])
        order = [s for s in SEVERITY_ORDER if s in set(keys)]
    else:
        keys = view[col].astype(str)
        order = list(keys.value_counts().index)  # busiest group first
    return [(g, view[keys == g]) for g in order]


def _group_stats(sub, mode, total):
    """Compact per-group insight numbers for the grouped findings view (pure pandas).

    Returns the dict the header + strip renderers consume:

    * ``n`` — findings in this group; ``share`` — ``n / total`` (this group's slice of
      the filtered set, 0..1).
    * ``severity`` — ``{SEV: count}`` for present severities, severest-first. Empty in
      severity mode (every row shares one severity, so a distribution is meaningless).
    * ``open`` / ``resolved`` — split from ``status`` (a finding whose status isn't a
      resolved-state counts as open); ``None`` when the response has no ``status`` column.
    * ``assets`` — distinct ``vulnerableAsset.name``; ``None`` when that column is absent
      or when grouping *by* asset (where it's a constant 1 and adds nothing).

    Pure (no Streamlit) so ordering/counting stays unit-testable.
    """
    n = len(sub)
    stats = {"n": n, "share": (n / total if total else 0.0)}

    if mode != "severity" and "severity" in sub.columns:
        vc = normalize_severity_series(sub["severity"]).value_counts()
        stats["severity"] = {s: int(vc[s]) for s in SEVERITY_ORDER if s in vc.index}
    else:
        stats["severity"] = {}

    if "status" in sub.columns:
        norm = sub["status"].astype("string").str.upper().str.strip()
        resolved = int(norm.isin(RESOLVED_STATUSES).sum())
        stats["open"], stats["resolved"] = n - resolved, resolved
    else:
        stats["open"] = stats["resolved"] = None

    if mode != "asset" and "vulnerableAsset.name" in sub.columns:
        stats["assets"] = int(sub["vulnerableAsset.name"].nunique(dropna=True))
    else:
        stats["assets"] = None

    return stats


def _group_header(label, mode, stats):
    """Expander header for one group.

    Severity mode leads with its own glyph + label + count (unchanged). Every other mode
    appends a compact severest-first glyph summary (e.g. ``🔴 12  🟠 20``) so groups can be
    compared *while collapsed* — the glyph is the non-color signal the design bar requires.
    """
    n = stats["n"]
    if mode == "severity":
        return f"{SEVERITY_GLYPHS.get(label, '')} {label} · {n:,}".strip()
    head = f"{label} · {n:,}"
    sev = stats.get("severity") or {}
    if sev:
        glyphs = "  ".join(f"{SEVERITY_GLYPHS.get(s, '')} {v:,}" for s, v in sev.items())
        head = f"{head}  ·  {glyphs}"
    return head


def _group_stats_strip_html(stats):
    """Compact stats strip shown above a group's table, or ``""`` when there's nothing.

    A thin proportional severity bar + a dot/count legend (only when a severity *mix*
    exists), then a muted meta line: open/resolved split, distinct assets, and the group's
    share of the filtered set. Severity meaning is carried by the dot + label + number, so
    it never rests on color alone; the bar is decorative reinforcement (``aria-hidden``).
    """
    sev = stats.get("severity") or {}
    parts = []
    if sev:
        denom = sum(sev.values()) or 1
        segs = "".join(
            f'<span class="group-stats__seg" aria-hidden="true" '
            f'style="width:{v / denom:.4%};background:var(--sev-{s.lower()})"></span>'
            for s, v in sev.items()
        )
        chips = "".join(
            f'<span class="group-stat-chip">{ui.sev_dot_html(s)}'
            f'<span class="group-stat-chip__label">{s.title()}</span>'
            f'<b>{v:,}</b></span>'
            for s, v in sev.items()
        )
        parts.append(f'<div class="group-stats__bar">{segs}</div>')
        parts.append(f'<div class="group-stats__chips">{chips}</div>')

    meta = []
    if stats.get("open") is not None:
        meta.append(f'<span><b>{stats["open"]:,}</b> open</span>')
        meta.append(f'<span><b>{stats["resolved"]:,}</b> resolved</span>')
    if stats.get("assets") is not None:
        noun = "asset" if stats["assets"] == 1 else "assets"
        meta.append(f'<span><b>{stats["assets"]:,}</b> {noun}</span>')
    meta.append(f'<span><b>{stats["share"]:.0%}</b> of findings</span>')
    parts.append(f'<div class="group-stats__meta">{"".join(meta)}</div>')

    return f'<div class="group-stats">{"".join(parts)}</div>'


# Render caps for grouped mode. A high-cardinality Group by (e.g. Asset) over a 100k-row
# scan would otherwise spawn thousands of expanders each holding its own st.data_editor —
# every one serialized to the browser per rerun. The caps bound render cost while the
# group *stats* (headers, strips, counts) stay computed over the full filtered set, and
# the CSV export still covers every row.
_GROUPS_RENDER_CAP = 30
_GROUP_ROWS_CAP = 250


def _show_grouped(view, full, key, nodes, mode, col) -> None:
    """Findings split into collapsible per-group sections — one count-labelled expander
    per group value, each holding a compact stats strip + that group's findings table. The
    column picker renders once above all groups; one CSV export covers the whole filtered set."""
    cols = _column_choice(view, key)
    nonce = st.session_state.get("os_editor_nonce", 0)
    groups = _grouped_frames(view, mode, col)
    total = len(view)
    for i, (label, sub) in enumerate(groups[:_GROUPS_RENDER_CAP]):
        stats = _group_stats(sub, mode, total)
        # Header carries a collapsed-state at-a-glance summary (severity glyphs / severity
        # mode's own glyph). The busiest/severest group opens by default; the rest start
        # collapsed (progressive disclosure).
        header = _group_header(label, mode, stats)
        shown = sub.iloc[:_GROUP_ROWS_CAP]
        height = min(38 * (len(shown) + 1) + 3, 420)  # compact for small groups
        with st.expander(header, expanded=(i == 0)):
            st.markdown(_group_stats_strip_html(stats), unsafe_allow_html=True)
            _editor(shown, cols, f"{key}_g{i}_editor_{nonce}", nodes, height=height)
            if len(sub) > _GROUP_ROWS_CAP:
                st.caption(
                    f"Showing the first {_GROUP_ROWS_CAP:,} of {len(sub):,} findings in "
                    "this group — narrow the filters, or download the CSV for all of them."
                )
    hidden_groups = len(groups) - _GROUPS_RENDER_CAP
    if hidden_groups > 0:
        st.caption(
            f"…and {hidden_groups:,} more group(s) not shown — narrow the filters to see them."
        )
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
    if nodes is None:
        # Lazy fast path: the raw nodes weren't needed until this first drill-down.
        # One archive parse (shared cross-session afterwards); a failed load degrades
        # to the record-dict sheet because _raw_node tolerates empty nodes.
        with st.spinner("Loading finding details…"):
            nodes = scan.ensure_nodes()
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
