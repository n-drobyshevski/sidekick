"""Charts over the gold tables, for a notebook.

Pure rendering: every function takes a **pandas** frame and returns a
``matplotlib.figure.Figure``. No Spark, no file writing, no ``plt.show()`` -- the caller
decides what to do with the figure. That keeps these testable, and keeps a scheduled Job from
ever building a picture nobody is going to look at (``run_pipeline`` never imports this).

``load()`` is the one Spark-aware helper: it reads the gold tables and hands back pandas. The
gold tables are one row per severity, so collecting them is safe.

Two rules run through all of it:

* **NULL is not zero.** ``metrics.safe_pct`` returns NULL for an empty denominator on purpose.
  A severity with nothing resolved gets an annotated gap, never a zero-height bar -- a zero bar
  reads as "closed instantly", which is the opposite of "we have never closed one".
* **Severity is never carried by colour alone.** The palette is a heat ramp that fails a
  categorical colourblind check (see ``config.SEVERITY_COLORS``), so every mark is identified
  by an axis tick or a text label and colour is redundant on top.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.figure import Figure

from config import SEVERITY_COLORS, SEVERITY_ORDER, SLA_TARGETS

OVERALL = "OVERALL"

# Ink and chrome. Text wears ink, never a series colour; the grid is a solid hairline one
# shade off the surface (dashed gridlines read as a threshold when they are just a grid).
INK = "#0a0a0a"
MUTED = "#64748b"
GRID = "#e2e8f0"
ACCENT = "#2563eb"  # brand / data accent, per DESIGN.md
SURFACE = "#ffffff"


# ------------------------------------------------------------------------------ loading


def load(spark, tables, scan_id: Optional[str] = None) -> Dict[str, pd.DataFrame]:
    """The MTTR and program gold frames for one scan, as pandas.

    The gold tables are appended, so an unfiltered read would blend every run that has ever
    happened into one chart. ``scan_id`` defaults to the most recent scan rather than to
    everything.
    """
    if scan_id is None:
        latest = spark.table(tables.mttr).selectExpr("max_by(scan_id, scan_ts) AS s").collect()
        scan_id = latest[0]["s"] if latest else None
    if scan_id is None:
        raise RuntimeError(f"{tables.mttr} is empty -- run the pipeline before charting.")

    def frame(name: str) -> pd.DataFrame:
        return spark.table(name).where(f"scan_id = '{scan_id}'").toPandas()

    return {"scan_id": scan_id, "mttr": frame(tables.mttr), "program": frame(tables.program)}


# ------------------------------------------------------------------------------ helpers


def _ordered(pdf: pd.DataFrame, *, drop_overall: bool = True) -> pd.DataFrame:
    """Rows in SEVERITY_ORDER. OVERALL is dropped by default: an aggregate bar sitting beside
    the bars it aggregates invites reading it as one more component."""
    work = pdf.copy()
    if drop_overall:
        work = work[work["severity"] != OVERALL]
    rank = {sev: i for i, sev in enumerate(SEVERITY_ORDER)}
    work["_rank"] = work["severity"].map(lambda s: rank.get(s, len(rank)))
    return work.sort_values("_rank").drop(columns="_rank").reset_index(drop=True)


def _overall_row(pdf: pd.DataFrame) -> Optional[pd.Series]:
    rows = pdf[pdf["severity"] == OVERALL]
    return rows.iloc[0] if len(rows) else None


def _present(value) -> bool:
    """NULL / NaN means unknown, and unknown is not a number we can plot."""
    return value is not None and not pd.isna(value)


def _frame(title: str, subtitle: str = "", *, height: float = 4.2) -> tuple:
    """A figure with the chrome pushed back: no top/right spines, hairline axes, muted ticks.

    Title and subtitle are drawn on the *figure*, not the axes, so a long subtitle cannot
    collide with the title however tall the plot is.
    """
    fig, ax = plt.subplots(figsize=(9, height), dpi=120)
    fig.patch.set_facecolor(SURFACE)
    ax.set_facecolor(SURFACE)
    fig.suptitle(title, color=INK, fontsize=13, fontweight="600", x=0.012, ha="left", y=0.985)
    if subtitle:
        fig.text(0.012, 0.93, subtitle, color=MUTED, fontsize=9.5, ha="left", va="top")
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
        ax.spines[side].set_linewidth(0.8)
    ax.tick_params(colors=MUTED, labelsize=9.5, length=0)
    return fig, ax


def _categorical_axis(ax, rows: pd.DataFrame, ypos, xlabel: str) -> None:
    """Shared setup for the two per-severity charts.

    ``set_ylim`` explicitly rather than letting autoscale decide: a severity whose only mark is
    a 'no data' annotation contributes no artist, so autoscale would crop its row out of the
    figure entirely -- the row would not read as empty, it would simply not exist.
    """
    ax.set_yticks(list(ypos))
    ax.set_yticklabels(rows["severity"], color=INK, fontsize=10)
    ax.set_ylim(-0.7, len(rows) - 0.3)
    ax.set_xlabel(xlabel, color=MUTED, fontsize=9.5)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    ax.margins(x=0.16)


def _no_data(ax, y: float, text: str, at_x: Optional[float] = None) -> None:
    """An explicit gap. The alternative -- a zero-length bar -- is a lie.

    Anchored in *axes* coordinates by default, not at data x=0: an axis that starts at 55 days
    would put a data-space annotation off-screen, turning 'nothing open' into a blank row that
    reads as an oversight rather than as empty.

    ``at_x`` places it just past a data-space landmark instead -- used to clear the SLA target
    tick, which otherwise strikes through the text.
    """
    from matplotlib.transforms import blended_transform_factory

    if at_x is None:
        xy, coords = (0.012, y), blended_transform_factory(ax.transAxes, ax.transData)
    else:
        xy, coords = (at_x, y), ax.transData
    ax.annotate(
        text, xy=xy, xycoords=coords, xytext=(8, 0), textcoords="offset points",
        color=MUTED, fontsize=9, va="center", style="italic",
    )


def _legend_below(ax, ncol: int = 3) -> None:
    """Legend under the plot. Inside the axes it lands on the data sooner or later."""
    handles, _ = ax.get_legend_handles_labels()
    if not handles:
        return
    legend = ax.legend(
        loc="upper left", bbox_to_anchor=(0, -0.16), frameon=False, fontsize=9,
        ncol=ncol, handletextpad=0.5, columnspacing=1.6,
    )
    for text in legend.get_texts():
        text.set_color(MUTED)


# -------------------------------------------------------------------------- MTTR + SLA


def mttr_sla_chart(mttr: pd.DataFrame, scan_id: str = "") -> Figure:
    """Median days-to-remediate per severity, against that severity's SLA target.

    Horizontal bars with a bullet-chart target tick. Both quantities are days, so they share
    one axis -- the in-SLA percentage is annotated as text rather than given a second y-scale,
    because two scales on one plot invent a relationship that is not in the data.
    """
    rows = _ordered(mttr)
    overall = _overall_row(mttr)

    # The encoding key always survives -- a reader who cannot tell what the tick means cannot
    # read the chart, however good the headline is.
    subtitle = (
        "bar = Kaplan–Meier median, counting still-open findings as censored"
        " · vertical tick = SLA target"
    )
    if overall is not None:
        km, naive = overall.get("km_median"), overall.get("mttr_median")
        sla = overall.get("sla_pct")
        parts = []
        if _present(km):
            parts.append(f"overall KM median {km:.1f}d")
            if _present(naive):
                # Showing both is the argument for KM: the gap is the survivorship bias.
                parts.append(f"naive (closed-only) {naive:.1f}d")
        elif _present(overall.get("km_median_lower_bound")):
            parts.append(f"overall KM median > {overall['km_median_lower_bound']:.0f}d")
        if _present(sla):
            parts.append(f"{sla:.0f}% in SLA")
        if _present(overall.get("resolved")):
            parts.append(f"{int(overall['resolved'])} resolved, {int(overall['open'])} open")
        if parts:
            subtitle += "\n" + " · ".join(parts)
    if scan_id:
        subtitle += f" · scan {scan_id}"

    fig, ax = _frame(
        "Mean time to remediate, against SLA", subtitle, height=0.62 * len(rows) + 2.6
    )

    ypos = list(range(len(rows)))[::-1]  # CRITICAL at the top
    for y, (_, row) in zip(ypos, rows.iterrows()):
        sev = row["severity"]
        median = row.get("km_median")
        target = SLA_TARGETS.get(sev)

        # Survival never fell to 50%, i.e. more than half of this severity is still open. The
        # median genuinely does not exist yet; a bar drawn from the closed-only rows here would
        # be the exact bias KM exists to remove.
        if not _present(median) and _present(row.get("km_median_lower_bound")) and row.get(
            "km_events", 0
        ):
            _no_data(
                ax, y,
                f"over half still open — median > {row['km_median_lower_bound']:.0f}d",
                at_x=target,
            )
            if target:
                ax.plot(
                    [target, target], [y - 0.3, y + 0.3],
                    color=INK, linewidth=2, solid_capstyle="butt", zorder=5,
                )
            continue

        if _present(median):
            ax.barh(
                y, median, height=0.42,
                color=SEVERITY_COLORS.get(sev, MUTED),
                edgecolor=SURFACE, linewidth=2, zorder=3,
            )
            label = f"{median:.1f}d"
            if target and median > target:
                label += f"  ▲ over {target}d SLA"
            ax.annotate(
                label, xy=(median, y), xytext=(8, 0), textcoords="offset points",
                color=INK, fontsize=9.5, va="center", zorder=4,
            )
        else:
            resolved = row.get("resolved")
            n_open = row.get("open")
            _no_data(
                ax, y,
                "no resolved findings"
                + (f" · {int(n_open)} open" if _present(n_open) and n_open else ""),
                at_x=target,  # clear the target tick rather than let it strike the text
            )

        if target:
            ax.plot(
                [target, target], [y - 0.3, y + 0.3],
                color=INK, linewidth=2, solid_capstyle="butt", zorder=5,
            )

    _categorical_axis(ax, rows, ypos, "days")
    fig.tight_layout(rect=(0, 0, 1, 0.88))
    return fig


# --------------------------------------------------------------------------- open age


def open_age_chart(mttr: pd.DataFrame, scan_id: str = "") -> Figure:
    """How stale the open backlog is: the p50-to-p90 age span per severity.

    A range, drawn as a range -- the segment between the two markers is the point. MTTR
    answers "how fast do we close things"; this answers "how long has what we have not closed
    been sitting there", and a programme can look good on one and bad on the other.
    """
    rows = _ordered(mttr)
    subtitle = "segment spans the median (p50) to the 90th-percentile age of what is still open"
    if scan_id:
        subtitle += f" · scan {scan_id}"
    fig, ax = _frame("Age of still-open findings", subtitle, height=0.62 * len(rows) + 2.9)

    ypos = list(range(len(rows)))[::-1]
    labelled = False
    for y, (_, row) in zip(ypos, rows.iterrows()):
        sev = row["severity"]
        p50, p90 = row.get("open_age_p50"), row.get("open_age_p90")
        colour = SEVERITY_COLORS.get(sev, MUTED)

        if not (_present(p50) and _present(p90)):
            _no_data(ax, y, "nothing open")
            continue

        ax.plot([p50, p90], [y, y], color=colour, linewidth=3, solid_capstyle="round", zorder=3)
        ax.scatter([p50], [y], s=70, color=SURFACE, edgecolor=colour, linewidth=2.5, zorder=4)
        ax.scatter([p90], [y], s=70, color=colour, edgecolor=SURFACE, linewidth=2, zorder=4)
        labelled = True
        # One label per row, at the far end. A number on both markers doubles the ink and
        # says little -- p90 is the one that tells you how bad the tail is.
        label = f"{p90:.0f}d" if p90 > p50 else f"{p90:.0f}d (all the same age)"
        ax.annotate(
            label, xy=(p90, y), xytext=(11, 0), textcoords="offset points",
            color=INK, fontsize=9.5, va="center",
        )

    _categorical_axis(ax, rows, ypos, "days open")
    if labelled:
        # Neutral legend handles, built by hand. Letting matplotlib reuse the first plotted
        # marker would paint the key in CRITICAL's red and imply p50/p90 are a severity.
        from matplotlib.lines import Line2D

        ax.legend(
            handles=[
                Line2D([], [], marker="o", linestyle="none", markersize=8,
                       markerfacecolor=SURFACE, markeredgecolor=MUTED, markeredgewidth=2,
                       label="p50 — half the open findings are older"),
                Line2D([], [], marker="o", linestyle="none", markersize=8,
                       markerfacecolor=MUTED, markeredgecolor=SURFACE, label="p90 — the tail"),
            ],
            loc="upper left", bbox_to_anchor=(0, -0.16), frameon=False, fontsize=9,
            ncol=2, handletextpad=0.5, columnspacing=1.6, labelcolor=MUTED,
        )
    fig.tight_layout(rect=(0, 0.06, 1, 0.9))
    return fig


# ---------------------------------------------------------------- coverage x efficiency


def coverage_efficiency_chart(program: pd.DataFrame, scan_id: str = "") -> Figure:
    """The Prioritization-to-Prediction pair, plotted against each other.

    Coverage (did we fix the risky things?) against efficiency (was what we fixed actually
    risky?). They are in tension and meaningless apart, which is why they share one plot.

    Two things make this honest rather than flattering:

    * the lo/hi bounds are drawn as error bars -- their width IS the size of the doubt the
      unclassified findings create, and hiding it behind a confident point is the failure mode
      the whole module is shaped around;
    * ``prevalence`` is drawn as the random-selection baseline. Efficiency at or below it means
      the prioritisation is not beating picking findings at random, which turns a number into
      a verdict.
    """
    overall = _overall_row(program)
    rows = _ordered(program)

    subtitle = "coverage: did we fix the risky things · efficiency: was what we fixed risky"
    if overall is not None and _present(overall.get("signal_coverage_pct")):
        subtitle += (
            f"\n{overall['signal_coverage_pct']:.0f}% of findings had exploit signals — "
            f"every rate is conditional on that"
        )
    if scan_id:
        subtitle += f" · scan {scan_id}"

    fig, ax = _frame("Remediation coverage vs efficiency", subtitle, height=5.6)

    for _, row in rows.iterrows():
        x, y = row.get("coverage_pct"), row.get("efficiency_pct")
        if not (_present(x) and _present(y)):
            continue
        colour = SEVERITY_COLORS.get(row["severity"], MUTED)
        ax.scatter([x], [y], s=90, color=colour, edgecolor=SURFACE, linewidth=2, zorder=4)
        # The palette cannot carry identity on its own, so every point says its own name.
        ax.annotate(
            row["severity"], xy=(x, y), xytext=(0, 11), textcoords="offset points",
            color=INK, fontsize=9, ha="center",
        )

    if overall is not None:
        x, y = overall.get("coverage_pct"), overall.get("efficiency_pct")
        if _present(x) and _present(y):
            cov_lo = overall.get("coverage_lo") or x
            cov_hi = overall.get("coverage_hi") or x
            xerr = [[x - cov_lo], [cov_hi - x]]
            yerr = [
                [y - (overall.get("efficiency_lo") or y)],
                [(overall.get("efficiency_hi") or y) - y],
            ]
            ax.errorbar(
                [x], [y], xerr=xerr, yerr=yerr,
                fmt="o", markersize=11, color=ACCENT, ecolor=ACCENT, elinewidth=1.6,
                capsize=4, markeredgecolor=SURFACE, markeredgewidth=2, zorder=5,
                label="overall (bars = unclassified uncertainty)",
            )
            ax.annotate(
                OVERALL, xy=(x, y), xytext=(0, 14), textcoords="offset points",
                color=ACCENT, fontsize=9.5, fontweight="600", ha="center",
            )

        prevalence = overall.get("prevalence_pct")
        if _present(prevalence):
            ax.axhline(
                prevalence, color=MUTED, linewidth=1.2, zorder=2,
                label=f"prevalence {prevalence:.0f}% — random-selection baseline",
            )

    ax.set_xlabel(
        "coverage % — of high-risk findings, share remediated", color=MUTED, fontsize=9.5
    )
    ax.set_ylabel("efficiency % — of remediations, share high-risk", color=MUTED, fontsize=9.5)
    ax.set_xlim(-4, 104)
    ax.set_ylim(-4, 104)
    ax.grid(True, color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    _legend_below(ax, ncol=1)
    fig.tight_layout(rect=(0, 0.08, 1, 0.88))
    return fig


# ------------------------------------------------------------------------------ all


def render_all(spark, tables, scan_id: Optional[str] = None) -> List[Figure]:
    """Every chart for one scan, in reading order. Returns the figures; in a notebook they
    display themselves as the cell's output."""
    data = load(spark, tables, scan_id)
    sid = data["scan_id"]
    return [
        mttr_sla_chart(data["mttr"], sid),
        open_age_chart(data["mttr"], sid),
        coverage_efficiency_chart(data["program"], sid),
    ]
