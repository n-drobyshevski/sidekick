"""Load the dashboard's custom stylesheet once per run."""

from functools import lru_cache
from pathlib import Path

import streamlit as st

CSS_PATH = Path(__file__).resolve().parent.parent / "assets" / "styles.css"


@lru_cache(maxsize=1)
def _css_text(_mtime: float) -> str:
    try:
        return CSS_PATH.read_text(encoding="utf-8")
    except Exception:
        return ""


def load_css() -> None:
    """Inject the custom stylesheet. Native theme (config.toml) handles fonts/accent."""
    # Cache keyed on the file's mtime (not just its path) so an edit to styles.css is
    # picked up on the next rerun instead of being served stale for the life of the
    # server process -- a plain lru_cache() would otherwise require a hard restart.
    try:
        mtime = CSS_PATH.stat().st_mtime
    except OSError:
        mtime = 0.0
    css = _css_text(mtime)
    if css:
        st.markdown(f"<style>\n{css}\n</style>", unsafe_allow_html=True)
