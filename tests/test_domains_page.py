"""AppTest checks for the Domains section (Settings) + the domain dimension across
consumer pages (OS vulnerabilities filter/column, MTTR "By domain", Scan History)."""

from streamlit.testing.v1 import AppTest

from wiz_dashboard.data import settings
from wiz_dashboard.ui import components as ui

DOMAINS = [
    {"id": "dom-web", "name": "Web",
     "rules": [{"conditions": [{"type": "tag", "key": "team", "value": "web"}]}]},
    {"id": "dom-reg", "name": "Registry",
     "rules": [{"conditions": [{"type": "subscription", "values": ["prod-registry"]}]}]},
    {"id": "dom-leg", "name": "Legacy",
     "rules": [{"conditions": [{"type": "name_regex", "pattern": "^legacy-"}]}]},
]

# Guarded: AppTest re-executes the whole script on every rerun, so an unguarded seed
# would overwrite the very mutation (reorder/delete) a test just clicked.
_SEED = (
    "from wiz_dashboard import config\n"
    "from wiz_dashboard.data import settings\n"
    "if not settings.get_domains()['items']:\n"
    f"    settings.set_domains({DOMAINS!r})\n"
    "settings.set_fetch_severities(config.SELECTABLE_SEVERITIES)\n"
    "settings.set_display_severities(config.SELECTABLE_SEVERITIES)\n"
)

_LOAD_SAMPLE = (
    "import streamlit as st\n"
    "from wiz_dashboard import config\n"
    "from wiz_dashboard.data.client import fetch_findings\n"
    "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
    "raw = fetch_findings(dry_run=True, sample_shape='flat',"
    " severities=config.SELECTABLE_SEVERITIES)\n"
    "nodes = extract_nodes(raw)\n"
    "df = nodes_to_dataframe(nodes)\n"
    "st.session_state['os_nodes'] = nodes\n"
    "st.session_state['os_df'] = df\n"
    "st.session_state['os_shape'] = 'flat'\n"
)

_PERSIST_SAMPLE = (
    "from wiz_dashboard import config\n"
    "from wiz_dashboard.data import ledger\n"
    "from wiz_dashboard.data.client import fetch_findings\n"
    "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
    "raw = fetch_findings(dry_run=True, sample_shape='flat',"
    " severities=config.SELECTABLE_SEVERITIES)\n"
    "records = nodes_to_dataframe(extract_nodes(raw)).to_dict('records')\n"
    "ledger.persist_flat_scan(records, mode='dry-run', raw=raw,"
    " scan_id='2026-06-01T00:00:00Z')\n"
)


def _run(script):
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    return at


def _widget(at, key):
    return next((e for e in at.main if getattr(e, "key", None) == key), None)


# --------------------------------------------------------------------- section
def test_settings_page_without_domains_shows_only_add():
    at = _run("from wiz_dashboard.ui.pages import settings as sp\nsp.page()\n")
    assert [b for b in at.get("button") if b.key == "dom_add"]
    assert not [b for b in at.get("button") if str(b.key).startswith("dom_edit_")]


def test_domains_section_lists_domains_in_priority_order():
    at = _run(_SEED + "from wiz_dashboard.ui.pages import settings as sp\nsp.page()\n")
    edit_keys = [b.key for b in at.get("button") if str(b.key).startswith("dom_edit_")]
    assert edit_keys == ["dom_edit_dom-web", "dom_edit_dom-reg", "dom_edit_dom-leg"]
    up = [b for b in at.get("button") if b.key == "dom_up_dom-web"][0]
    assert up.disabled  # first row can't move up
    dn = [b for b in at.get("button") if b.key == "dom_dn_dom-leg"][0]
    assert dn.disabled  # last row can't move down


def test_reorder_persists_to_disk():
    at = _run(_SEED + "from wiz_dashboard.ui.pages import settings as sp\nsp.page()\n")
    [b for b in at.get("button") if b.key == "dom_dn_dom-web"][0].click()
    at.run()
    assert not at.exception
    names = [i["name"] for i in settings.get_domains()["items"]]
    assert names == ["Registry", "Web", "Legacy"]
    assert settings.get_domains()["version"] == 2  # seed save + reorder save


def test_delete_flow_removes_domain():
    at = _run(_SEED + "from wiz_dashboard.ui.pages import settings as sp\nsp.page()\n")
    [b for b in at.get("button") if b.key == "dom_del_dom-reg"][0].click()
    at.run()
    assert not at.exception
    # the confirm dialog is open; confirm the deletion
    [b for b in at.get("button") if b.key == "dom_delete_confirm"][0].click()
    at.run()
    assert not at.exception
    names = [i["name"] for i in settings.get_domains()["items"]]
    assert names == ["Web", "Legacy"]


# ---------------------------------------------------------------- consumer pages
def test_os_page_domain_filter_column_and_assignments():
    at = _run(
        _SEED + _LOAD_SAMPLE +
        "from wiz_dashboard.ui.pages import _derived\n"
        "dfd, sig = _derived.domain_view(*_derived.display_view())\n"
        "st.session_state['domains_present'] = sorted(set(dfd['domain']))\n"
        "st.session_state['legacy_domain'] = dfd.loc["
        "dfd['vulnerableAsset.name'] == 'legacy-vm-12', 'domain'].iloc[0]\n"
        "from wiz_dashboard.ui.pages import os_vulns\n"
        "os_vulns.render(has_creds=False)\n"
    )
    # engine: all three condition types classified the enriched sample
    present = set(at.session_state["domains_present"])
    assert {"Web", "Registry", "Unassigned"} <= present
    assert at.session_state["legacy_domain"] == "Legacy"
    # filter widget exists with priority-ordered options (Unassigned last)
    w = _widget(at, "os_domain_filter")
    assert w is not None
    opts = list(w.options)
    assert opts == [n for n in ["Web", "Registry", "Legacy", "Unassigned"] if n in opts]
    assert opts[-1] == "Unassigned"


def test_os_page_has_no_domain_widgets_when_unconfigured():
    at = _run(
        _LOAD_SAMPLE +
        "from wiz_dashboard.ui.pages import os_vulns\n"
        "os_vulns.render(has_creds=False)\n"
    )
    assert _widget(at, "os_domain_filter") is None


def test_mttr_page_domain_scope_and_by_domain_table():
    at = _run(
        _SEED + _PERSIST_SAMPLE +
        "from wiz_dashboard.ui.pages import mttr\n"
        "mttr.page()\n"
    )
    sel = _widget(at, "mttr_domain")
    assert sel is not None
    assert list(sel.options)[0] == "All domains"
    assert any("By domain" in str(h.value) for h in at.get("markdown"))


def test_scan_history_domain_filter_present():
    at = _run(
        _SEED + _PERSIST_SAMPLE +
        "from wiz_dashboard.ui.pages import scan_history\n"
        "scan_history.page()\n"
    )
    w = _widget(at, "sh_domain")
    assert w is not None
    assert "Web" in list(w.options)


# ------------------------------------------------------------------- components
def test_finding_sheet_carries_domain_chip():
    html = ui.vuln_detail_html(
        {"name": "CVE-2026-1", "severity": "HIGH", "status": "OPEN", "domain": "Web"},
        None,
    )
    assert 'aria-label="Domain: Web"' in html
    # consumed by the header — the catch-all must not echo it as a raw "domain" row
    assert ">domain<" not in html


def test_mttr_domain_select_rescopes_metrics():
    # Interacting with the domain selectbox (inside the page-body fragment) must
    # re-scope the KPI source caption to the chosen domain.
    guarded_persist = (
        "from wiz_dashboard.data import ledger as _l\n"
        "if _l.load_scans_df().empty:\n"
        + "".join("    " + line + "\n" for line in _PERSIST_SAMPLE.strip().splitlines())
    )
    at = _run(
        _SEED + guarded_persist +
        "from wiz_dashboard.ui.pages import mttr\n"
        "mttr.page()\n"
    )
    sel = next(s for s in at.selectbox if s.key == "mttr_domain")
    domain = next(o for o in sel.options if o != "All domains")
    sel.select(domain)
    at.run()
    assert not at.exception, at.exception
    assert any(f"scoped to the **{domain}** domain" in str(c.value) for c in at.caption)
