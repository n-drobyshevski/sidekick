"""Cloud misconfigurations page (placeholder)."""

from wiz_dashboard.ui import components as ui


def page():
    ui.render_page_header(
        "Cloud misconfigurations",
        "IaC and runtime config drift from cloud baselines",
    )
    ui.empty_state(
        "Cloud misconfigurations — coming soon",
        "Placeholder. Wire up a Wiz configuration-findings query and render it here.",
    )
