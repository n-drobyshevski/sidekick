"""Shared findings-source registry for the Reports and Exports pages.

A small lookup over session state: each page that runs a scan stores its results
under ``{prefix}_df`` / ``{prefix}_raw`` keys, and ``loaded_sources`` surfaces the
ones that currently hold data so Reports and Exports can aggregate across them.
"""

import streamlit as st

from wiz_dashboard.ui.pages import _derived

# Findings sources the Reports / Exports pages can draw on (label -> session prefix).
SOURCES = [
    ("OS vulnerabilities", "os"),
]


def loaded_sources():
    """Return ``{label: {"prefix", "df", "sig", "raw"}}`` for sources with session data.

    ``df`` is the frame under the display filter (hide-everywhere semantics: reports and
    table exports match what the pages show) with ``sig`` its cache token. ``raw`` stays
    the verbatim API payload — filtering it would fabricate a response that never
    existed; the raw-JSON export is the one deliberately unfiltered output.
    """
    out = {}
    for label, prefix in SOURCES:
        full = st.session_state.get(f"{prefix}_df")
        if full is None or getattr(full, "empty", True):
            continue
        df, sig = _derived.display_view(prefix)
        out[label] = {
            "prefix": prefix,
            "df": df,
            "sig": sig,
            "raw": st.session_state.get(f"{prefix}_raw"),
        }
    return out
