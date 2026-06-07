"""Shared findings-source registry for the Reports and Exports pages.

A small lookup over session state: each page that runs a scan stores its results
under ``{prefix}_df`` / ``{prefix}_raw`` keys, and ``loaded_sources`` surfaces the
ones that currently hold data so Reports and Exports can aggregate across them.
"""

import streamlit as st

# Findings sources the Reports / Exports pages can draw on (label -> session prefix).
SOURCES = [
    ("OS vulnerabilities", "os"),
]


def loaded_sources():
    """Return ``{label: {"prefix", "df", "raw"}}`` for sources with data in session."""
    out = {}
    for label, prefix in SOURCES:
        df = st.session_state.get(f"{prefix}_df")
        if df is not None and not getattr(df, "empty", True):
            out[label] = {
                "prefix": prefix,
                "df": df,
                "raw": st.session_state.get(f"{prefix}_raw"),
            }
    return out
