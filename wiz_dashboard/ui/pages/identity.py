"""Identity findings page (placeholder)."""

from wiz_dashboard.ui import components as ui


def page():
    ui.render_page_header(
        "Identity findings",
        "Excess privileges, stale roles, and risky IAM bindings",
    )
    ui.empty_state(
        "Identity findings — coming soon",
        "Placeholder. Wire up a Wiz identity-graph query and render it here.",
    )
