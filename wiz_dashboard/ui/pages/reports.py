"""Reports page (placeholder)."""

from wiz_dashboard.ui import components as ui


def page():
    ui.render_page_header("Reports", "Scheduled and ad-hoc security reporting")
    ui.empty_state(
        "Reports — coming soon",
        "Placeholder. Add scheduled/ad-hoc report generation here.",
    )
