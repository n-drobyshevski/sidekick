"""The HTML fragments, checked as strings. No Spark, no plotly, no browser.

The interesting assertions are the three that are not about layout:

* **Escaping.** A subscription or asset name comes from a cloud tenant this pipeline does not
  control and lands inside markup. That is the one genuinely new attack surface this UI layer
  introduces, and it gets a test rather than a promise.
* **The two-token severity rule.** Marks wear ``config.SEVERITY_COLORS``; coloured *text* wears
  the darkened ``figures.SEVERITY_TEXT`` sibling, because the fill ramp fails 4.5:1 as text.
* **The uncoloured matrix.** A red-washed "high risk, still open" cell is the security-vendor
  theatre PRODUCT.md names as an anti-reference. The assertion is that the fragment's *body*
  contains no severity or status colour at all.
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

import pytest

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import tiles  # noqa: E402
from config import SEVERITY_COLORS, SEVERITY_ORDER  # noqa: E402
from figures import SEVERITY_TEXT, STATUS  # noqa: E402


def body(fragment: str) -> str:
    """The markup below the fragment's own stylesheet.

    Every fragment ships its own ``<style>`` -- each ``displayHTML`` output is a sandboxed
    iframe with no stylesheet to share -- so a colour assertion about the *content* has to look
    past the token definitions.
    """
    return fragment.split("</style>", 1)[1]


class _Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.bad = []

    def handle_starttag(self, tag, attrs):
        if tag not in ("br", "img", "hr", "input", "meta", "link"):
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.bad.append(tag)


ONE_ROW = {
    "tp": 3, "fp": 3, "fn": 2, "tn": 2, "unknown_remediated": 1, "unknown_open": 1,
    "high_risk": 5, "not_high_risk": 5, "unknown": 2,
}


def every_fragment():
    return {
        "hero": tiles.hero(
            label="Median MTTR (Kaplan–Meier)", value=12.0, source="1,204 tracked lifecycles",
            badge=tiles.delta_badge(3.2), minis=[{"label": "In SLA", "value": "62%"}],
        ),
        "hero_null": tiles.hero(
            label="Median MTTR (Kaplan–Meier)", value=None, lower_bound=91.0,
        ),
        "kpi_row": tiles.kpi_row(
            [{"label": "Open", "value": "1,204", "sub": "awaiting remediation"}]
        ),
        "severity_tiles": tiles.severity_tiles(
            [{"severity": "HIGH", "open": 12}, {"severity": "CRITICAL", "open": 0}]
        ),
        "stat_cards": tiles.stat_cards(
            [{"severity": "HIGH", "open": 12, "resolved": 3, "total": 15, "delta_open": 2}]
        ),
        "scan_zone": tiles.scan_zone(
            scan_ts="2026-08-01 00:00:00", scan_id="scan-2", scope="os",
            severities="CRITICAL,HIGH", total=1204, age_days=1.2,
        ),
        "matrix": tiles.matrix(ONE_ROW),
        "rule_card": tiles.rule_card(
            "CISA KEV or public exploit or EPSS >= 0.10",
            [{"text": "Listed in the CISA KEV catalog", "fired": 12, "missing": 3}],
            signal_coverage=68.0,
        ),
        "methodology": tiles.methodology(
            [{"term": "Coverage", "definition": "TP / (TP + FN)"}],
            summary="How these numbers are calculated",
        ),
        "note": tiles.note("brick has no domain rules."),
    }


@pytest.fixture
def fragments():
    return every_fragment()


# ------------------------------------------------------------------------ iframe isolation


@pytest.mark.parametrize("name", sorted(every_fragment()))
def test_every_fragment_carries_its_own_stylesheet(name, fragments):
    """No shared stylesheet exists to inherit from: each output is its own sandboxed iframe."""
    fragment = fragments[name]
    assert fragment.startswith("<style>")
    assert "</style>" in fragment
    assert 'class="wiz"' in fragment


@pytest.mark.parametrize("name", sorted(every_fragment()))
def test_every_fragment_is_self_contained_and_inert(name, fragments):
    """No script, no external font, no remote image. A metrics page fetches nothing."""
    fragment = fragments[name]
    assert "<script" not in fragment.lower()
    assert not re.search(r"https?://", fragment)
    assert "@import" not in fragment


@pytest.mark.parametrize("name", sorted(every_fragment()))
def test_every_fragment_parses(name, fragments):
    parser = _Parser()
    parser.feed(body(fragments[name]))
    assert not parser.bad, f"{name} closes tags out of order: {parser.bad}"
    assert not parser.stack, f"{name} leaves {parser.stack} open"


@pytest.mark.parametrize("name", sorted(every_fragment()))
def test_every_fragment_keeps_a_reduced_motion_alternative(name, fragments):
    """Nothing animates today. The block is kept so that if anything ever does, the alternative
    already exists rather than being remembered."""
    assert "prefers-reduced-motion" in fragments[name]


# --------------------------------------------------------------------------------- escaping


@pytest.mark.parametrize(
    "make",
    [
        lambda s: tiles.note(s),
        lambda s: tiles.hero(label=s, value=1.0, source=s),
        lambda s: tiles.kpi_row([{"label": s, "value": "1", "sub": s}]),
        lambda s: tiles.scan_zone(
            scan_ts=s, scan_id=s, scope=s, severities=s, total=1, age_days=1.0
        ),
    ],
)
def test_register_derived_strings_are_escaped(make):
    """An ``asset_name`` is whatever a cloud tenant called a machine. It renders as text."""
    hostile = '<img src=x onerror="alert(1)">'
    fragment = body(make(hostile))
    assert "<img" not in fragment
    assert "onerror" not in fragment or "&quot;" in fragment
    assert "&lt;img" in fragment


# --------------------------------------------------------------------- NULL is not zero


def test_a_null_median_says_what_it_means_rather_than_going_blank():
    """Survival never fell to 50%: more than half the register is still open. That is a
    finding, not a missing value, and neither a blank nor a 0 says it."""
    fragment = tiles.hero(label="Median MTTR", value=None, lower_bound=91.0)
    assert "&gt; 13w" in fragment
    assert "over half still open" in fragment
    assert ">0<" not in body(fragment)


def test_a_null_with_no_lower_bound_is_an_em_dash():
    fragment = tiles.hero(label="Median MTTR", value=None)
    assert tiles.DASH in fragment
    assert "nothing resolved yet" in fragment


def test_a_null_number_is_an_em_dash_not_a_zero():
    fragment = tiles.kpi_row([{"label": "Coverage", "value": tiles._num(None, 1, "%")}])
    assert tiles.DASH in fragment
    assert "0.0%" not in fragment


# ------------------------------------------------------------- colour is never the only cue


def test_a_severity_tile_carries_a_dot_and_the_word():
    fragment = tiles.severity_tiles([{"severity": "HIGH", "open": 12}])
    assert "High" in fragment
    assert SEVERITY_COLORS["HIGH"] in fragment
    assert "sev-dot" in fragment


def test_severity_tiles_come_back_in_taxonomy_order():
    fragment = tiles.severity_tiles(
        [{"severity": "MEDIUM", "open": 1}, {"severity": "CRITICAL", "open": 0}]
    )
    assert fragment.index("Critical") < fragment.index("Medium")


def test_a_zero_severity_count_is_shown_not_hidden():
    """"No criticals" is the most reassuring thing this page can say, and it only says it if
    the tile is there to say it."""
    fragment = tiles.severity_tiles([{"severity": "CRITICAL", "open": 0}])
    assert "Critical" in fragment and ">0<" in fragment


def test_a_change_chip_carries_a_glyph_and_the_baseline_not_only_a_tint():
    rose = tiles.delta_badge(3.2)
    fell = tiles.delta_badge(-3.2)
    assert "▲" in rose and "vs 7d ago" in rose
    assert "▼" in fell and "vs 7d ago" in fell
    assert tiles.delta_badge(0.0).count("±0") == 1
    assert tiles.DASH in tiles.delta_badge(None)


def test_rising_mttr_reads_as_bad_and_falling_as_good():
    """The metric this decorates is MTTR, where up is worse. The glyph says so either way."""
    assert 'class="chg up"' in tiles.delta_badge(3.2, inverted=True)
    assert 'class="chg down"' in tiles.delta_badge(-3.2, inverted=True)
    assert 'class="chg down"' in tiles.delta_badge(3.2, inverted=False)


def test_a_verdict_is_a_word_and_a_glyph():
    assert "Falling behind" in tiles.verdict_pill("falling-behind")
    assert "Gaining ground" in tiles.verdict_pill("gaining")
    assert tiles.DASH in tiles.verdict_pill(None)


def test_a_status_pill_leads_with_a_dot_and_spells_the_state_out():
    fragment = tiles.status_pill("warn", "32% unclassified")
    assert "pill warn" in fragment and "32% unclassified" in fragment


# --------------------------------------------------------------- the two-token severity rule


def test_coloured_text_uses_the_darkened_token_and_marks_use_the_fill():
    """Setting severity text in the fill colour on a tint fails contrast. That is the rule."""
    for sev in SEVERITY_ORDER:
        badge = tiles.severity_badge(sev)
        assert SEVERITY_TEXT[sev] in badge, f"{sev} label must use the text token"
        assert SEVERITY_COLORS[sev] in badge, f"{sev} dot must use the fill token"
        assert f"color:{SEVERITY_COLORS[sev]}" not in badge


def test_the_text_ramp_is_darker_than_the_fill_ramp():
    def luminance(hex_colour):
        hex_colour = hex_colour.lstrip("#")
        return sum(int(hex_colour[i : i + 2], 16) for i in (0, 2, 4))

    for sev in SEVERITY_ORDER:
        assert luminance(SEVERITY_TEXT[sev]) <= luminance(SEVERITY_COLORS[sev]), sev


# ------------------------------------------------------------------------- the matrix


def test_the_matrix_speaks_english():
    fragment = tiles.matrix(ONE_ROW)
    for words in tiles.MATRIX_WORDS.values():
        assert words in fragment, words


def test_the_matrix_carries_no_colour_at_all():
    """A red-washed FN cell is exactly the theatre PRODUCT.md steers away from -- and it would
    make the other three cells unreadable by comparison."""
    content = body(tiles.matrix(ONE_ROW)).lower()
    for colour in list(SEVERITY_COLORS.values()) + list(STATUS.values()):
        assert colour.lower() not in content, colour


def test_the_unclassified_row_sits_outside_the_two_by_two():
    """A finding whose signal was never captured is not a fifth quadrant; it is a population
    that left both rates."""
    fragment = tiles.matrix(ONE_ROW)
    assert 'class="unclassified"' in fragment
    assert "not counted as low risk" in fragment


def test_the_rule_card_warns_when_the_rule_could_not_see_the_register():
    fragment = tiles.rule_card("KEV", [{"text": "KEV", "fired": 1, "missing": 9}], signal_coverage=40.0)
    assert "60% unclassified" in fragment
    quiet = tiles.rule_card("KEV", [{"text": "KEV", "fired": 1, "missing": 0}], signal_coverage=99.0)
    assert "unclassified</span>" not in quiet


def test_the_rule_card_says_the_clauses_overlap():
    fragment = tiles.rule_card("KEV", [{"text": "KEV", "fired": 1, "missing": 0}])
    assert "do not sum" in fragment


# -------------------------------------------------------------------------- type discipline


def test_only_the_hero_uses_the_hero_step():
    """DESIGN.md allows one hero value per page; KPI cards are a step down at 1.5rem."""
    assert "font-size:2rem" in tiles.hero(label="x", value=1.0).replace(" ", "")
    assert "2rem" not in body(tiles.kpi_row([{"label": "Open", "value": "1"}]))


def test_figures_are_tabular():
    """A jittering metric reads as untrustworthy."""
    assert "tabular-nums" in tiles.kpi_row([{"label": "Open", "value": "1"}])
