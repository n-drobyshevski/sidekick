"""Step 4: external stylesheet + native theme config."""

import tomllib
from pathlib import Path

from wiz_dashboard.ui import theme

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_load_css_reads_stylesheet():
    text = theme._css_text()
    assert ".metric-card" in text
    assert ".mttr-card" in text
    assert "light-dark(" in text
    theme.load_css()  # no-op in bare mode, must not raise


def test_config_toml_is_valid():
    cfg = tomllib.loads((REPO_ROOT / ".streamlit" / "config.toml").read_text())
    assert cfg["theme"]["primaryColor"] == "#2563eb"
    assert "base" not in cfg["theme"]  # follow system light/dark
