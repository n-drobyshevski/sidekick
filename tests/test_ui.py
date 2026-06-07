"""Step 3: UI components moved into wiz_dashboard.ui (exercised in bare mode).

Streamlit calls are no-ops in bare mode, so these assert the code paths don't raise.
"""

import pandas as pd

from wiz_dashboard.ui import components


def test_components_render_without_error(resolved_sample, app):
    df = app.nodes_to_dataframe(app.extract_nodes(resolved_sample))
    components.metric_card("Critical", "3", color="#ef4444", delta=2)
    components.metric_skeleton()
    components.section_label("Section")
    components.empty_state("Nothing", "body <b>html</b>")
    components.render_mttr_widget(df)  # exercises calculate_mttr + the native MTTR table
    components.render_mttr_widget(pd.DataFrame())  # no per_sev -> empty_state path
    components.render_page_header("Title", "Subtitle")


def test_show_exception_renders():
    try:
        raise ValueError("boom")
    except ValueError as exc:
        components.show_exception(exc, title="Oops")


def test_severity_badge_html_carries_label_and_class():
    html = components.severity_badge_html("CRITICAL")
    assert "sev-badge--critical" in html
    assert "Critical" in html  # text label (not color alone)
    assert 'aria-label="Severity: Critical"' in html
    # The shape signal is now a CSS-drawn dot, not an emoji glyph.
    assert "sev-dot--critical" in html
    assert "🔴" not in html
    # Unknown / junk severities degrade gracefully to the unknown variant.
    assert "sev-badge--unknown" in components.severity_badge_html("not-a-severity")


def test_kpi_card_html_delta_direction_and_escaping():
    # inverse=True (default): a rising value is "bad" (red); arrow shows direction.
    up = components._kpi_card_html("Critical", "5", delta=2)
    assert "kpi-card__delta--bad" in up and "▲" in up
    down = components._kpi_card_html("Critical", "5", delta=-3)
    assert "kpi-card__delta--good" in down and "▼" in down
    # inverse=False flips the good/bad meaning (e.g. In-SLA %).
    assert "kpi-card__delta--good" in components._kpi_card_html("In SLA", "9", delta=2, inverse=False)
    # HTML in dynamic text is escaped.
    assert "<script>" not in components._kpi_card_html("<script>", "1")


def test_kpi_card_html_threads_percent_chip():
    # The KPI card band carries the same muted "· ±N%" evolution chip as the stat list.
    h = components._kpi_card_html("Critical", "128", delta=6, pct=5.0)
    assert "kpi-card__delta-pct" in h and "5%" in h and "▲" in h
    # Backward compatible: no pct -> absolute-only delta, no percent span.
    assert "delta-pct" not in components._kpi_card_html("Critical", "128", delta=6)
    # kpi_row passes an item's "pct" straight through to the card (no exception, chip present).
    components.kpi_row([{"label": "Critical", "value": "128", "delta": 6, "pct": 5.0}])


def test_delta_html_absolute_plus_percent():
    # Rising count (inverse default True -> "bad"): absolute + muted percent chip.
    h = components._delta_html(2, pct=20.0)
    assert "+2" in h and "20%" in h and "kpi-card__delta--bad" in h and "kpi-card__delta-pct" in h
    # abs_text overrides the magnitude (e.g. a formatted duration) and the arrow shows dir.
    h2 = components._delta_html(-4.7, abs_text="4.7d", pct=-19.0)
    assert "4.7d" in h2 and "19%" in h2 and "▼" in h2
    # No pct -> backward-compatible (no percent span); unchanged -> neutral chip.
    assert "delta-pct" not in components._delta_html(3)
    assert "±0" in components._delta_html(0)


def test_kpi_row_and_severity_cards_render(resolved_sample, app):
    components.kpi_row([
        {"label": "Total", "value": "10", "accent": "var(--accent)", "delta": 1},
        {"label": "In SLA", "value": "92%", "accent": "#16a34a", "inverse": False},
    ])
    df = app.nodes_to_dataframe(app.extract_nodes(resolved_sample))
    components.severity_cards(app.count_by_severity(df), prev={"HIGH": 1})


def test_vuln_detail_html_escapes_and_skips_absent_sections():
    html = components.vuln_detail_html({
        "name": "<script>alert(1)</script>",
        "severity": "CRITICAL",
        "status": "OPEN",
        "vulnerableAsset.name": "vm-1",
        "vulnerableAsset.type": "VIRTUAL_MACHINE",
        "firstDetectedAt": "2026-01-01T00:00:00Z",
    })
    # Dynamic text is escaped (no raw tag survives into the markup).
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    # Structural classes / reused badge + CSS dot are present.
    assert "vuln-sheet__title" in html
    assert "sev-badge" in html and "sev-dot--critical" in html
    assert "status-pill--neutral" in html       # OPEN -> neutral pill
    # Present sections render; sections with no resolvable field are dropped.
    assert "Affected asset" in html
    assert "Exploitability" not in html and "Remediation" not in html
    # Dates are normalised to YYYY-MM-DD (raw ISO does not leak through).
    assert "2026-01-01" in html and "T00:00:00Z" not in html


def test_vuln_detail_html_risk_strip_and_bool_pct():
    html = components.vuln_detail_html({
        "name": "CVE-2026-1",
        "severity": "HIGH",
        "hasExploit": True,
        "hasCisaKevExploit": False,
        "epssProbability": 0.42,
        "cvssv3.score": 7.5,
    })
    # At-a-glance risk strip: CVSS + EPSS stat tiles, plus a truthy-only exploit chip.
    assert "vuln-risk" in html
    assert "risk-chip--danger" in html  # hasExploit True
    assert "42.0%" in html              # EPSS tile (0.42 -> 42.0%)
    assert ">7.5<" in html              # CVSS tile
    # Exploitability section renders the bool rows.
    assert "Exploitability" in html
    assert ">Yes<" in html              # Exploit available
    assert ">No<" in html               # CISA KEV False


def test_vuln_detail_html_grouped_node_breakdown_and_tags():
    record = {
        "vulnerableAsset.name": "gke-x",
        "vulnerableAsset.cloudPlatform": "GCP",
        "analytics.criticalSeverityFindingCount": 63,
    }
    raw = {
        "vulnerableAsset": {"name": "gke-x", "cloudPlatform": "GCP",
                            "tags": {"cluster": "inix", "env": "prod"}},
        "analytics": {"criticalSeverityFindingCount": 63, "totalFindingCount": 63},
    }
    html = components.vuln_detail_html(record, raw)
    assert "Findings breakdown" in html
    assert "vuln-breakdown__fill" in html and "width:100%" in html  # all-critical
    assert "Affected asset" in html
    assert "tag-chip" in html and "cluster" in html
    assert "Exploitability" not in html  # grouped: no flat per-finding sections


def test_vuln_detail_html_sla_verdict_and_catch_all():
    html = components.vuln_detail_html({
        "name": "CVE-2026-9",
        "severity": "CRITICAL",
        "firstDetectedAt": "2026-01-01T00:00:00Z",
        "resolvedAt": "2026-01-20T00:00:00Z",   # 19d > 7d CRITICAL target -> breached
        "mysteryField": "keep-me",
    })
    # SLA verdict computed from resolved age vs config target (deterministic: resolved).
    assert "SLA status" in html and "Breached" in html
    # An unmodeled scalar lands in the collapsible "All other fields" catch-all.
    assert "All other fields" in html
    assert "mysteryField" in html and "keep-me" in html


def test_sla_bullet_thresholds():
    assert "sla-bullet__fill--ok" in components.sla_bullet_html(95)
    assert "sla-bullet__fill--warn" in components.sla_bullet_html(75)
    assert "sla-bullet__fill--bad" in components.sla_bullet_html(40)
    # clamps + tolerates junk
    assert "width:100%" in components.sla_bullet_html(150)
    assert "sla-bullet__fill--bad" in components.sla_bullet_html(None)
