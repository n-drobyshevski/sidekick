"""AppTest smoke + dry-run scan for the new st.navigation entry point (app.py)."""

from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parent.parent / "app.py")


def _at():
    return AppTest.from_file(APP, default_timeout=30)


def test_app_loads_default_page():
    at = _at().run()
    assert not at.exception
    # render_page_header now uses native st.title (not custom HTML in st.markdown).
    assert any("OS vulnerabilities" in t.value for t in at.title)


def test_dry_run_scan_renders_severity_cards():
    at = _at().run()
    at.button(key="os_run").click().run()
    assert not at.exception
    # The flat dry-run sample has CRITICAL findings. Severity cards render as
    # accent-colored custom KPI cards (a CSS severity dot + the label "Critical")
    # in the markdown stream rather than st.metric.
    assert any("Critical" in m.value for m in at.markdown)


def test_dry_run_scan_then_exports_has_data():
    at = _at().run()
    at.button(key="os_run").click().run()
    assert not at.exception
    assert "os_df" in at.session_state
    df = at.session_state["os_df"]
    assert not df.empty


def test_mttr_widget_renders_headline_metric():
    # With resolved findings present, the MTTR section shows a native headline metric
    # (the dry-run SAMPLE has no resolvedAt, so use a self-contained resolved sample).
    script = (
        "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
        "from wiz_dashboard.ui import components\n"
        "sample = {'data': {'vulnerabilityFindings': {'nodes': ["
        "{'id':'a','severity':'HIGH','status':'RESOLVED',"
        "'firstDetectedAt':'2026-04-01T00:00:00Z','resolvedAt':'2026-04-08T00:00:00Z'},"
        "{'id':'b','severity':'HIGH','status':'OPEN',"
        "'firstDetectedAt':'2026-05-01T00:00:00Z','resolvedAt':None}]}}}\n"
        "df = nodes_to_dataframe(extract_nodes(sample))\n"
        "components.render_mttr_widget(df)\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
    assert any("Overall median MTTR" in m.label for m in at.metric)


def test_mttr_widget_can_hide_overall_headline():
    # show_overall=False drops the duplicate "Overall median MTTR" metric + caption (used by
    # the MTTR page, where the Key metrics card already shows it) but keeps the per-severity table.
    script = (
        "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
        "from wiz_dashboard.ui import components\n"
        "sample = {'data': {'vulnerabilityFindings': {'nodes': ["
        "{'id':'a','severity':'HIGH','status':'RESOLVED',"
        "'firstDetectedAt':'2026-04-01T00:00:00Z','resolvedAt':'2026-04-08T00:00:00Z'},"
        "{'id':'b','severity':'HIGH','status':'OPEN',"
        "'firstDetectedAt':'2026-05-01T00:00:00Z','resolvedAt':None}]}}}\n"
        "df = nodes_to_dataframe(extract_nodes(sample))\n"
        "components.render_mttr_widget(df, show_overall=False)\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
    assert not any("Overall median MTTR" in m.label for m in at.metric)  # headline hidden
    assert len(at.dataframe) >= 1  # per-severity table still renders


def test_os_page_no_longer_renders_mttr_sections():
    # MTTR moved to its own page: after a dry-run scan, the OS page should not emit the
    # "Remediation performance" / "MTTR trend" section labels (section_label -> "## ...").
    at = _at().run()
    at.button(key="os_run").click().run()
    assert not at.exception
    assert not any("Remediation performance" in m.value for m in at.markdown)
    assert not any("MTTR trend" in m.value for m in at.markdown)


def test_mttr_page_empty_state_without_scan():
    # With no findings in session and no on-disk history, the MTTR page shows its
    # empty state pointing back to the OS vulnerabilities page.
    script = (
        "import pandas as pd\n"
        "from wiz_dashboard.ui.pages import _derived, mttr\n"
        "_derived.history_cached = lambda: pd.DataFrame()\n"  # isolate from local history file
        "mttr.page()\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
    assert any("MTTR & SLA" in t.value for t in at.title)
    assert any("No remediation data yet" in m.value for m in at.markdown)


def test_mttr_page_renders_headline_after_findings_loaded():
    # With flat per-finding data in session, the MTTR page's headline is the Key metrics
    # card ("Median MTTR"); the per-severity widget no longer repeats it as an "Overall
    # median MTTR" st.metric -- the card above already shows it (de-duplicated).
    script = (
        "import pandas as pd\n"
        "import streamlit as st\n"
        "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
        "from wiz_dashboard.ui.pages import _derived, mttr\n"
        "_derived.history_cached = lambda: pd.DataFrame()\n"
        "sample = {'data': {'vulnerabilityFindings': {'nodes': ["
        "{'id':'a','severity':'HIGH','status':'RESOLVED',"
        "'firstDetectedAt':'2026-04-01T00:00:00Z','resolvedAt':'2026-04-08T00:00:00Z'},"
        "{'id':'b','severity':'HIGH','status':'OPEN',"
        "'firstDetectedAt':'2026-05-01T00:00:00Z','resolvedAt':None}]}}}\n"
        "nodes = extract_nodes(sample)\n"
        "st.session_state['os_nodes'] = nodes\n"
        "st.session_state['os_df'] = nodes_to_dataframe(nodes)\n"
        "mttr.page()\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
    assert any("Median MTTR" in m.value for m in at.markdown)  # Key metrics card headline
    assert not any("Overall median MTTR" in m.label for m in at.metric)  # no duplicate metric


def test_freshness_caption_prefers_session_then_base_then_prompt():
    import pandas as pd

    from wiz_dashboard.ui import scan

    # 1) An in-session scan wins and reports its own metadata.
    meta = {"count": 1234, "mode": "live", "at": "2026-06-07 13:38 UTC"}
    session_msg = scan.freshness_caption(meta, None)
    assert "1,234 findings" in session_msg and "live" in session_msg

    # 2) No in-session scan, but the durable base has scans -> summarise the base so a page
    #    full of saved data never reads "No scan yet".
    scans = pd.DataFrame(
        [{"ts": pd.Timestamp("2026-05-30T15:42:00Z"), "mode": "dry-run", "total": 40}]
    )
    base_msg = scan.freshness_caption(None, scans)
    assert "No scan yet" not in base_msg
    assert "40 findings" in base_msg and "Saved base" in base_msg

    # 3) Nothing anywhere -> prompt the first scan (and no em dash, per the copy rules).
    empty_msg = scan.freshness_caption(None, pd.DataFrame())
    assert "No scan yet" in empty_msg and "—" not in empty_msg


def test_findings_table_with_cve_links_renders():
    # CVE-named findings should configure a LinkColumn (+ DatetimeColumn, glyph)
    # without raising. The dry-run sample isn't CVE-named, so assert this path here.
    script = (
        "import pandas as pd\n"
        "from wiz_dashboard.ui.pages.os_vulns import _show_table\n"
        "df = pd.DataFrame([\n"
        "  {'severity':'CRITICAL','name':'CVE-2026-1234',"
        "'firstDetectedAt':'2026-04-01T00:00:00Z'},\n"
        "  {'severity':'HIGH','name':'CVE-2026-5678',"
        "'firstDetectedAt':'2026-04-02T00:00:00Z'},\n"
        "])\n"
        "_show_table(df, key='flat_csv')\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception


def test_run_scan_sample_shape_override_beats_session():
    # The degroup button forces a flat fetch via run_scan(sample_shape="flat") even when
    # the sidebar selection (dry_run_shape) says grouped.
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.ui import scan\n"
        "st.session_state['dry_run_shape'] = 'grouped'\n"
        "scan.run_scan(force=True, has_creds=False, sample_shape='flat')\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
    from wiz_dashboard.models import schema

    assert not schema.is_grouped_shape(at.session_state["os_nodes"])  # flat won, not grouped
    assert not at.session_state["os_df"].empty


def test_degroup_button_loads_individual_findings():
    # Default dry-run shape is grouped: a scan renders the grouped-by-asset view, and the
    # "Show individual findings" button re-fetches the flat shape so the page degroups.
    from wiz_dashboard.models import schema

    at = _at().run()
    at.button(key="os_run").click().run()
    assert not at.exception
    assert schema.is_grouped_shape(at.session_state["os_nodes"])  # grouped first
    at.button(key="os_degroup").click().run()
    assert not at.exception
    assert not schema.is_grouped_shape(at.session_state["os_nodes"])  # degrouped to flat
    assert not at.session_state["os_df"].empty


def test_os_severity_baseline_prefers_session_then_durable():
    # The severity breakdown's change-badge baseline: prefer the in-session previous scan
    # (os_prev_counts); when that's empty (a session's first scan) fall back to the durable
    # ledger's previous flat scan, so the % badges show across sessions like the MTTR KPIs.
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.data import ledger\n"
        "from wiz_dashboard.ui.pages import _derived, os_vulns\n"
        "ledger.persist_flat_scan("
        "[{'id':'a1','severity':'CRITICAL','vulnerableAsset.name':'vm-1'}],"
        " mode='dry-run', scan_id='2026-05-01T00:00:00Z')\n"
        "ledger.persist_flat_scan("
        "[{'id':'a1','severity':'CRITICAL','vulnerableAsset.name':'vm-1'},"
        "{'id':'a2','severity':'HIGH','vulnerableAsset.name':'vm-2'}],"
        " mode='dry-run', scan_id='2026-05-02T00:00:00Z')\n"
        "_derived.previous_severity_counts_cached.clear()\n"
        "st.session_state['_durable'] = os_vulns._severity_prev()\n"   # no os_prev_counts -> durable
        "st.session_state['os_prev_counts'] = {'CRITICAL': 99}\n"
        "st.session_state['_session'] = os_vulns._severity_prev()\n"   # in-session wins when present
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
    assert at.session_state["_durable"] == {"CRITICAL": 1}    # second-to-last flat scan
    assert at.session_state["_session"] == {"CRITICAL": 99}   # in-session preferred over durable


def test_dry_run_scans_evolve_so_badges_have_deltas():
    # Two consecutive dry-run flat scans must return DIFFERENT per-severity counts, so the
    # severity badges show a real scan-over-scan delta instead of ±0. run_scan steps the
    # demo sequence (seq 0 -> baseline, seq 1 -> next scenario).
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.data.client import fetch_findings\n"
        "from wiz_dashboard.ui import scan\n"
        "fetch_findings.clear()\n"
        "st.session_state['dry_run_shape'] = 'flat'\n"
        "scan.run_scan(force=False, has_creds=False)\n"
        "st.session_state['c1'] = dict(st.session_state['os_counts'])\n"
        "scan.run_scan(force=False, has_creds=False)\n"
        "st.session_state['c2'] = dict(st.session_state['os_counts'])\n"
        "st.session_state['p2'] = dict(st.session_state['os_prev_counts'])\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
    assert at.session_state["c1"]                              # first scan loaded the baseline
    assert at.session_state["c2"] != at.session_state["c1"]    # data evolved between scans
    assert at.session_state["p2"] == at.session_state["c1"]    # scan 2's baseline is scan 1


def test_os_hero_flat_shows_pct_badges():
    # The KPI card band (Total / Critical / High / Medium) now carries the muted "· ±N%"
    # evolution chip, consistent with the severity breakdown list below it.
    script = (
        "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
        "from wiz_dashboard.domain.severity import count_by_severity\n"
        "from wiz_dashboard.ui.pages import os_vulns\n"
        "cur = [{'id':'a1','name':'CVE-2026-1','severity':'CRITICAL','vulnerableAsset.name':'vm-1'},"
        "{'id':'a3','name':'CVE-2026-3','severity':'CRITICAL','vulnerableAsset.name':'vm-3'},"
        "{'id':'a2','name':'CVE-2026-2','severity':'HIGH','vulnerableAsset.name':'vm-2'}]\n"
        "df = nodes_to_dataframe(extract_nodes({'data':{'vulnerabilityFindings':{'nodes':cur}}}))\n"
        "os_vulns._hero_flat(df, count_by_severity(df), {'CRITICAL': 1, 'HIGH': 1})\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
    blob = "".join(m.value for m in at.markdown)
    assert "kpi-card__delta-pct" in blob   # KPI band carries the percent chip
    assert "100%" in blob                  # Critical 1 -> 2 == +100%
    assert "50%" in blob                   # Total 2 -> 3 == +50%


def test_os_severity_breakdown_shows_pct_badge_from_durable_baseline():
    # End-to-end: with os_prev_counts EMPTY (a fresh session's first scan) but a prior flat
    # scan in the durable ledger, the severity breakdown still renders the muted "· +N%"
    # evolution chip — Critical 1 -> 2 across scans is +100%, mirroring the MTTR KPIs.
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.data import ledger\n"
        "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
        "from wiz_dashboard.domain.severity import count_by_severity\n"
        "from wiz_dashboard.ui.pages import _derived, os_vulns\n"
        "prev = [{'id':'a1','name':'CVE-2026-1','severity':'CRITICAL','vulnerableAsset.name':'vm-1'},"
        "{'id':'a2','name':'CVE-2026-2','severity':'HIGH','vulnerableAsset.name':'vm-2'}]\n"
        "cur = prev + [{'id':'a3','name':'CVE-2026-3','severity':'CRITICAL','vulnerableAsset.name':'vm-3'}]\n"
        "ledger.persist_flat_scan(prev, mode='dry-run', scan_id='2026-05-01T00:00:00Z')\n"
        "ledger.persist_flat_scan(cur, mode='dry-run', scan_id='2026-05-02T00:00:00Z')\n"
        "_derived.previous_severity_counts_cached.clear()\n"
        "df = nodes_to_dataframe(extract_nodes({'data':{'vulnerabilityFindings':{'nodes':cur}}}))\n"
        "os_vulns._filter_and_table(df, count_by_severity(df))\n"  # os_prev_counts unset
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
    blob = "".join(m.value for m in at.markdown)
    assert "kpi-card__delta-pct" in blob   # the muted percent chip rendered
    assert "100%" in blob                  # Critical 1 -> 2 == +100% from the durable baseline


def test_finding_sheet_body_renders():
    # The right-anchored Sheet variant is also a native st.dialog; run its body
    # (HTML detail + the NVD link_button path) headless to assert it doesn't raise.
    script = (
        "from wiz_dashboard.ui.pages.os_vulns import _finding_sheet\n"
        "_finding_sheet("
        "{'name': 'CVE-2026-1', 'severity': 'CRITICAL', "
        "'vulnerableAsset.name': 'vm-sample', "
        "'vulnerableAsset.type': 'VIRTUAL_MACHINE', 'fixedVersion': '1.2.3'}, "
        "{'id': 'n0', 'severity': 'CRITICAL'})\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
