"""Step 4: external stylesheet + native theme config."""

import tomllib
from pathlib import Path

from wiz_dashboard.ui import theme

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_load_css_reads_stylesheet():
    text = theme._css_text()
    # Light-only theme: the sheet carries no dual-mode light-dark() values and pins
    # color-scheme to light. Layout CSS survives the native-component migration; the
    # bespoke .metric-card/.mttr-card rules were deleted once st.metric/column_config
    # replaced the hand-rolled HTML.
    assert "light-dark(" not in text
    assert "color-scheme: light;" in text
    assert ".block-container" in text
    assert ".status-pill" in text
    assert ".metric-card" not in text
    assert ".mttr-card" not in text
    theme.load_css()  # no-op in bare mode, must not raise


def test_config_toml_is_valid():
    cfg = tomllib.loads((REPO_ROOT / ".streamlit" / "config.toml").read_text())
    assert cfg["theme"]["primaryColor"] == "#2563eb"
    assert cfg["theme"]["base"] == "light"  # pinned to light, ignore system preference
