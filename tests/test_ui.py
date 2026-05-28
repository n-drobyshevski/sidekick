"""Step 3: UI components + sanitize moved into wiz_dashboard.ui (exercised in bare mode).

Streamlit calls are no-ops in bare mode, so these assert the code paths don't raise
and that the pure sanitization logic behaves.
"""

import pandas as pd

from wiz_dashboard.ui import components, sanitize


def test_sanitize_strips_script():
    out = sanitize.sanitize_html(
        "<div>ok</div><script>alert(1)</script>", allow_style=True
    )
    assert "script" not in out.lower()
    assert "ok" in out


def test_strip_html():
    assert sanitize.strip_html("<b>hi</b>") == "hi"
    assert sanitize.strip_html("plain") == "plain"


def test_components_render_without_error(resolved_sample, app):
    df = app.nodes_to_dataframe(app.extract_nodes(resolved_sample))
    components.metric_card("Critical", "3", color="#ef4444", delta=2)
    components.metric_skeleton()
    components.section_label("Section")
    components.empty_state("Nothing", "body <b>html</b>")
    components.render_mttr_widget(df)  # exercises calculate_mttr + sanitize_html
    components.render_mttr_widget(pd.DataFrame())  # no per_sev -> empty_state path
    components.render_page_header("Title", "Subtitle")


def test_show_exception_renders():
    try:
        raise ValueError("boom")
    except ValueError as exc:
        components.show_exception(exc, title="Oops")
