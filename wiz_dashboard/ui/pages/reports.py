"""Reports page: build an ad-hoc security summary from the loaded findings.

Pick which loaded sources to include and a format, preview the severity + MTTR/SLA
summary, then download it as Markdown, CSV or JSON. Reuses the same domain helpers
as the findings pages, so the numbers always match.
"""

import json
from datetime import datetime, timezone

import pandas as pd
import streamlit as st

from wiz_dashboard.config import SEVERITY_ORDER
from wiz_dashboard.domain.formatting import format_duration
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui.pages import _derived, _findings


def page():
    ui.render_page_header("Reports", "Ad-hoc security summary across your loaded findings")

    sources = _findings.loaded_sources()
    if not sources:
        ui.empty_state(
            "Nothing to report yet",
            "Run a scan on the **OS vulnerabilities** page first — then build a "
            "report here.",
        )
        return

    ui.section_label("Build report")
    c1, c2 = st.columns([3, 2])
    selected_labels = c1.multiselect(
        "Include sources", options=list(sources), default=list(sources),
        key="report_sources", placeholder="Choose sources",
    )
    fmt = c2.radio("Format", ["Markdown", "CSV", "JSON"], horizontal=True, key="report_fmt")

    selected = {label: sources[label] for label in selected_labels}
    if not selected:
        st.info("Select at least one source to include in the report.")
        return

    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    ui.section_label("Preview")
    _preview(selected)

    ui.section_label("Download")
    if fmt == "CSV":
        # The CSV report concatenates every selected source row-for-row — the one format
        # whose size scales with the data, so its payload is built on demand at scale.
        # Markdown/JSON stay eager below: they only carry the (tiny) aggregates.
        ui.deferred_download(
            "Download report (.csv)",
            lambda: _combined_csv(selected).encode("utf-8"),
            file_name="wiz_security_report.csv",
            mime="text/csv",
            key="report_dl",
            row_count=sum(len(info["df"]) for info in selected.values()),
            sig="|".join(info["sig"] for info in selected.values()),
        )
    else:
        if fmt == "Markdown":
            data = _markdown_report(selected, generated).encode("utf-8")
            mime, ext = "text/markdown", "md"
        else:
            data = json.dumps(_summary_dict(selected, generated), indent=2, default=str,
                              ensure_ascii=False).encode("utf-8")
            mime, ext = "application/json", "json"
        st.download_button(f"Download report (.{ext})", data=data,
                           file_name=f"wiz_security_report.{ext}", mime=mime, key="report_dl")
    st.caption(f"Generated {generated} · {len(selected)} source(s).")


# --------------------------------------------------------------------------- #
#  Summaries
# --------------------------------------------------------------------------- #
def _source_summary(info):
    """Severity counts + overall MTTR for one loaded source, via the shared caches.

    Radio/multiselect reruns of this page used to recompute both aggregates over the
    full frame; keying on the scan token makes every rerun after the first a lookup."""
    df = info["df"]
    token = info["sig"]  # display-scoped token from loaded_sources
    counts = _derived.counts_cached(token, df)
    _, overall = _derived.mttr_cached(token, df)
    return counts, overall


def _preview(selected) -> None:
    # Severity-count matrix (rows = source, cols = severity) + headline totals.
    rows = []
    for label, info in selected.items():
        counts, overall = _source_summary(info)
        row = {"Source": label, "Total": len(info["df"])}
        row.update({s.title(): counts.get(s, 0) for s in SEVERITY_ORDER})
        row["Median MTTR"] = format_duration(overall.get("mttr_median"))
        row["Open"] = int(overall.get("open", 0))
        rows.append(row)
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")


def _markdown_report(selected, generated) -> str:
    lines = ["# Wiz Security Report", "", f"_Generated {generated}_", ""]
    for label, info in selected.items():
        df = info["df"]
        counts, overall = _source_summary(info)
        lines += [f"## {label}", "", f"- **Total findings:** {len(df):,}"]
        median = overall.get("mttr_median")
        if median is not None and not pd.isna(median):
            lines.append(f"- **Median MTTR:** {format_duration(median)}")
        lines.append(
            f"- **Resolved / Open:** {int(overall.get('resolved', 0)):,}"
            f" / {int(overall.get('open', 0)):,}"
        )
        lines += ["", "| Severity | Count |", "| --- | ---: |"]
        for sev in SEVERITY_ORDER:
            if counts.get(sev):
                lines.append(f"| {sev.title()} | {counts[sev]:,} |")
        lines.append("")
    return "\n".join(lines)


def _combined_csv(selected) -> str:
    frames = []
    for label, info in selected.items():
        clean = info["df"][[c for c in info["df"].columns if not str(c).startswith("_")]].copy()
        clean.insert(0, "source", label)
        frames.append(clean)
    combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    return combined.to_csv(index=False)


def _summary_dict(selected, generated) -> dict:
    out = {"generated_at": generated, "sources": {}}
    for label, info in selected.items():
        counts, overall = _source_summary(info)
        out["sources"][label] = {
            "total": int(len(info["df"])),
            "severity_counts": {s: int(counts.get(s, 0)) for s in SEVERITY_ORDER if counts.get(s)},
            "mttr_median_days": (
                None if overall.get("mttr_median") is None or pd.isna(overall.get("mttr_median"))
                else round(float(overall["mttr_median"]), 2)
            ),
            "resolved": int(overall.get("resolved", 0)),
            "open": int(overall.get("open", 0)),
        }
    return out
