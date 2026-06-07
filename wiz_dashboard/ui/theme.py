"""Load the dashboard's custom stylesheet once per run."""

from functools import lru_cache
from pathlib import Path

import streamlit as st

CSS_PATH = Path(__file__).resolve().parent.parent / "assets" / "styles.css"


@lru_cache(maxsize=1)
def _css_text() -> str:
    try:
        return CSS_PATH.read_text(encoding="utf-8")
    except Exception:
        return ""


def load_css() -> None:
    """Inject the custom stylesheet. Native theme (config.toml) handles fonts/accent."""
    css = _css_text()
    if css:
        st.markdown(f"<style>\n{css}\n</style>", unsafe_allow_html=True)


_COMPACT_CSS = """
[data-testid="stDataFrame"] tbody tr { height: 28px; }
[data-testid="stMetric"] { padding: 6px 10px; }
"""


def apply_density(dense: bool) -> None:
    """Apply compact spacing without the old inline <script> attribute hack."""
    if dense:
        st.markdown(f"<style>{_COMPACT_CSS}</style>", unsafe_allow_html=True)
