"""Bare-mode render checks for the placeholder pages (no widgets/session needed)."""

from wiz_dashboard.ui.pages import cloud, identity, reports


def test_stub_pages_render_without_error():
    cloud.page()
    identity.page()
    reports.page()
