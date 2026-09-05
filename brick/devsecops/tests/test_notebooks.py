"""The shipped notebooks, checked as artifacts.

Heir to the deleted dashboard suite, and stronger than it was in one specific way: that suite
could only check a document it *generated*, so nothing stopped the generator and the workspace
disagreeing. These notebooks are the artifact, and every `%sql` cell in them is executed here,
verbatim, against real pipeline output.

Four guards carry most of the weight:

* **the scan pin** -- a cell that reads an append-only gold table directly, rather than through a
  ``v_*`` view, blends every run that has ever happened and still draws a plausible chart;
* **cell discipline** -- metric arithmetic in a notebook is arithmetic no test can reach;
* **the ``Chart ▸`` recipes** -- the four native visualizations are not committed (their metadata
  format is undocumented), so the recipe for rebuilding them is, and it must not rot;
* **one cell 1** -- seven notebooks that boot differently is seven ways to be misconfigured.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

BRICK_DIR = Path(__file__).resolve().parents[1]
NOTEBOOK_DIR = BRICK_DIR / "notebooks"
sys.path.insert(0, str(BRICK_DIR))

NOTEBOOKS = sorted(NOTEBOOK_DIR.glob("*.ipynb"))
NAMES = [p.stem for p in NOTEBOOKS]

#: The GAS pages this set mirrors, in sidebar order, plus the runner.
PAGES = [
    "00_security_posture",
    "01_mttr_sla",
    "02_program_performance",
    "03_code_vulnerabilities",
    "04_scan_history",
    "05_estate",
    "06_run_and_verify",
    "08_code_assets",
]

#: brick/'s GAS importer has no counterpart here: the Apps Script app scans one Wiz project for
#: vulnerability findings on hosts, so there is no code-register history to seed from. The
#: numbering keeps its gap rather than renumbering the pages, so a reader who knows brick's set
#: can see at a glance which one is missing and why.
MIGRATION = []

#: Everything that ships under notebooks/, in the order `sorted(glob)` returns them -- the
#: importer is 07 and the P2P v5 page is 08, so the page list is not contiguous.
EXPECTED = sorted(PAGES + MIGRATION)


def page_only(name: str) -> None:
    """Skip a guard that only makes sense for a read page."""
    if name not in PAGES:
        pytest.skip(f"{name} is not a read page")


#: Append-only tables. A read that names one of these without pinning a scan blends every run.
APPEND_ONLY = ("findings_raw", "wiz_os_findings", "metrics_mttr", "metrics_program",
               "metrics_capacity")

#: ``Chart ▸`` keys whose value must be a real column. The rest are chart-editor settings.
COLUMN_KEYS = {"X", "Y", "Group by", "Order", "Rows", "Columns", "Value"}
SETTING_KEYS = {"Stacking", "Legend", "X title", "Y title", "Horizontal", "Colors"}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def cells(doc, kind=None):
    for cell in doc["cells"]:
        if kind is None or cell["cell_type"] == kind:
            yield cell


def source(cell) -> str:
    return "".join(cell["source"])


def title(cell) -> str:
    meta = cell["metadata"].get("application/vnd.databricks.v1+cell", {})
    return meta.get("title", "")


def sql_cells(doc):
    for cell in cells(doc, "code"):
        text = source(cell)
        if text.startswith("%sql"):
            yield cell, text.split("\n", 1)[1]


@pytest.fixture(scope="module", params=EXPECTED)
def notebook(request):
    return request.param, load(NOTEBOOK_DIR / f"{request.param}.ipynb")


# --------------------------------------------------------------------------- the artifact


def test_the_set_is_the_gas_page_set_plus_the_importer():
    assert NAMES == EXPECTED


def test_each_notebook_is_valid_nbformat_4(notebook):
    _, doc = notebook
    assert doc["nbformat"] == 4
    assert doc["cells"]
    for cell in doc["cells"]:
        assert cell["cell_type"] in ("code", "markdown")
        assert isinstance(cell["source"], list)


def test_nothing_ships_with_outputs(notebook):
    """A committed output is a number from somebody's cluster, presented as this repo's answer.

    It is also how a register's asset names end up in a public diff.
    """
    _, doc = notebook
    for cell in cells(doc, "code"):
        assert cell["outputs"] == [], f"{title(cell)!r} ships an output"
        assert cell["execution_count"] is None


def test_prose_lives_in_markdown_cells_so_github_renders_it(notebook):
    """``%md`` inside a code cell renders on Databricks and as a code block everywhere else."""
    _, doc = notebook
    for cell in cells(doc, "code"):
        assert not source(cell).startswith("%md"), title(cell)
    assert any(cells(doc, "markdown"))


def test_every_cell_has_a_unique_id(notebook):
    name, doc = notebook
    nuids = [
        cell["metadata"]["application/vnd.databricks.v1+cell"]["nuid"] for cell in doc["cells"]
    ]
    assert len(set(nuids)) == len(nuids), name


def test_the_first_markdown_cell_states_the_one_question(notebook):
    """One notebook, one question. If a page needs two, it is two pages."""
    name, doc = notebook
    first = source(doc["cells"][0])
    assert first.startswith("# "), name
    assert first.count("**") >= 2, f"{name} does not state its question in bold"


# ------------------------------------------------------------------------------- cell 1


#: The line that binds `panels`, and the only stable landmark in the boot cell.
BOOT_IMPORT = "import panels, figures, tiles"


def boot_cell(doc):
    """The cell that puts the modules on ``sys.path``, declares the widgets and builds ``ctx``.

    Found by its import line rather than by a leading ``PAGE = ``. The literal used to open the
    cell and cannot: three pages build it from ``panels.GROUP_DIMENSIONS``, and the import that
    binds ``panels`` is fifteen lines further down the SAME cell, so the notebook raised
    ``NameError`` on its own first statement and no page below it ever ran. This locator
    encoded the position that made that possible.
    """
    for cell in cells(doc, "code"):
        if BOOT_IMPORT in source(cell):
            return source(cell)
    raise AssertionError("no boot cell")


def without_page(body):
    """The boot cell minus its ``PAGE`` literal -- the part every page must share verbatim."""
    start = body.index("PAGE = ")
    end = body.index("panels.declare_widgets(", start)
    return body[:start] + body[end:]


def test_every_notebook_boots_the_same_way():
    """Seven ways to put the modules on ``sys.path`` is seven ways to be misconfigured.

    The only permitted difference is the ``PAGE`` literal -- the page's own widgets.
    """
    bodies = {}
    for name in PAGES:
        body = boot_cell(load(NOTEBOOK_DIR / f"{name}.ipynb"))
        bodies[name] = without_page(body)
    assert len(set(bodies.values())) == 1, (
        "boot cells differ beyond their PAGE literal: "
        + ", ".join(sorted(bodies))
    )


def test_the_boot_cell_handles_both_documented_deployments():
    """Files pasted flat (cwd *is* the module dir) and a Git folder (``notebooks/`` is below it),
    plus a ``module_path`` override for a cluster whose cwd is neither."""
    body = boot_cell(load(NOTEBOOK_DIR / "00_security_posture.ipynb"))
    assert "os.path.dirname(_here)" in body
    assert 'dbutils.widgets.get("module_path")' in body
    assert "sys.path.insert(0, _p)" in body
    assert "sys.path.append" not in body, "insert, not append -- see README.md, Layout"
    assert "README.md" in body, "the failure has to name where the fix is written down"


def test_the_boot_cell_pins_the_scan_and_says_which(notebook):
    """Cell 1 resolves the scan and prints it. Every figure below is as old as that line."""
    name, doc = notebook
    page_only(name)
    body = boot_cell(doc)
    assert "panels.context(spark" in body
    assert "tiles.scan_zone" in body


@pytest.mark.parametrize("name", PAGES)
def test_every_widget_read_is_declared_in_that_notebooks_page_literal(name):
    import panels

    doc = load(NOTEBOOK_DIR / f"{name}.ipynb")
    body = boot_cell(doc)
    # The page's own widgets, plus the base set every notebook declares through
    # `panels.declare_widgets`. A page may legitimately read `data_path` or `csv_path` -- both
    # decide where the register is -- and those are declared, just not by the PAGE literal.
    declared = set(re.findall(r'"(\w+)": \(', body.split("\n\nimport os")[0]))
    declared |= set(panels.BASE_WIDGETS)
    used = set()
    for cell in cells(doc, "code"):
        used |= set(re.findall(r"ctx\.(?:int_)?param\(\s*'(\w+)'", source(cell)))
        used |= set(re.findall(r'ctx\.(?:int_)?param\(\s*"(\w+)"', source(cell)))
    assert used <= declared, f"{name} reads undeclared widgets: {sorted(used - declared)}"


# --------------------------------------------------------------------- cell discipline


THINKING = (
    "spark.sql(",
    ".groupBy(",
    ".agg(",
    "count_if(",
    "max_by(",
)


def test_no_notebook_does_its_own_thinking(notebook):
    """Metric arithmetic in a notebook is arithmetic no test can reach.

    A code cell is one call into ``panels`` / ``figures`` / ``tiles``. The single exception is
    ``01``'s hero, which folds a per-severity frame down to a register total -- and it does that
    with a named aggregate rather than a formula.
    """
    name, doc = notebook
    for cell in cells(doc, "code"):
        text = source(cell)
        if text.startswith("PAGE = ") or text.startswith("%sql"):
            continue
        for token in THINKING:
            if token in text:
                assert token == ".agg(" and name == "01_mttr_sla", (
                    f"{name}: {title(cell)!r} contains {token!r} -- that belongs in panels.py"
                )


def test_every_named_helper_exists(notebook):
    """A rename breaks the build here rather than in front of an analyst."""
    pytest.importorskip("pyspark")
    pytest.importorskip("plotly")
    import figures
    import panels
    import tiles

    modules = {"panels": panels, "figures": figures, "tiles": tiles}
    name, doc = notebook
    for cell in cells(doc, "code"):
        for module, attr in re.findall(r"\b(panels|figures|tiles)\.(\w+)\b(?!\.py)", source(cell)):
            if attr == "py":  # os.path.join(_p, "panels.py") in the boot cell
                continue
            assert hasattr(modules[module], attr), f"{name}: {module}.{attr} does not exist"


def test_no_notebook_resolves_the_scan_for_itself(notebook):
    """Two answers to "which scan is this page about" is the failure the views prevent."""
    _, doc = notebook
    for cell in cells(doc, "code"):
        assert "max_by(scan_id" not in source(cell), title(cell)


# ------------------------------------------------------------------------- the scan pin


def test_no_cell_reads_an_append_only_table_directly(notebook):
    """The highest-value structural test in the set.

    An unpinned read of a gold table returns every run that has ever happened, and renders as a
    chart that looks entirely reasonable.
    """
    name, doc = notebook
    for cell in cells(doc, "code"):
        text = source(cell)
        for table in APPEND_ONLY:
            if table in text:
                assert "scan_id =" in text or "v_" in text, (
                    f"{name}: {title(cell)!r} names {table} without a pin or a view"
                )


def test_sql_cells_read_only_the_session_views(notebook):
    """And therefore contain no widget interpolation, which is what lets the next test run."""
    name, doc = notebook
    for cell, query in sql_cells(doc):
        tables = re.findall(r"\bFROM\s+([A-Za-z_][\w.]*)", query, flags=re.IGNORECASE)
        for table in tables:
            assert table.startswith("v_"), f"{name}: {title(cell)!r} reads {table}"
        assert "{" not in query and "$" not in query, f"{name}: {title(cell)!r} interpolates"


# --------------------------------------------------------------------- the chart recipes


def recipes(doc):
    for cell in cells(doc, "markdown"):
        for line in source(cell).splitlines():
            if line.strip().startswith("Chart ▸"):
                yield cell, line.strip()


def parse(recipe: str) -> dict:
    fields = {}
    for part in recipe.split("Chart ▸", 1)[1].split("·"):
        part = part.strip()
        if "=" in part:
            key, value = part.split("=", 1)
            fields[key.strip()] = value.strip()
        elif part:
            fields["type"] = part
    return fields


def test_the_native_charts_are_all_documented():
    """Six visualizations are left to the chart editor, and each one ships its recipe.

    Their metadata format is undocumented and version-dependent, so nothing here can author one
    correctly and nothing here could verify it if it did -- which is the failure mode the AI/BI
    dashboard was deleted to escape. What ships instead is a correct, sortable, exportable table
    plus the recipe to rebuild the chart in fifteen seconds. See brick/README.md.
    """
    found = [(name, r) for name in EXPECTED for _, r in recipes(load(NOTEBOOK_DIR / f"{name}.ipynb"))]
    assert len(found) == 6, [f for f, _ in found]


def test_every_recipe_parses_under_the_grammar(notebook):
    name, doc = notebook
    for _, recipe in recipes(doc):
        fields = parse(recipe)
        assert "type" in fields, recipe
        unknown = set(fields) - COLUMN_KEYS - SETTING_KEYS - {"type"}
        assert not unknown, f"{name}: unknown recipe keys {sorted(unknown)}"


def test_every_recipe_names_real_columns(notebook):
    """A setting is not a column: ``Stacking=100%`` must not be looked up as one.

    Column-valued keys resolve against the producing panel's declared ``OUTPUT_COLUMNS`` -- the
    parser does not execute the cell, so the contract is what it can check, and the contract is
    itself checked against real pipeline output in ``test_panels.py``.
    """
    pytest.importorskip("pyspark")
    import panels

    name, doc = notebook
    cell_list = doc["cells"]
    for cell, recipe in recipes(doc):
        index = cell_list.index(cell)
        following = next(
            (c for c in cell_list[index + 1 :] if c["cell_type"] == "code"), None
        )
        assert following is not None, f"{name}: a recipe with no cell under it"
        called = re.findall(r"panels\.(\w+)\(", source(following))
        assert called, f"{name}: {recipe} sits above a cell that calls no panel"
        columns = set()
        for panel in called:
            columns |= set(panels.OUTPUT_COLUMNS.get(panel, ()))
        for key, value in parse(recipe).items():
            if key in COLUMN_KEYS:
                assert value in columns, (
                    f"{name}: recipe names {value!r} which {called} does not return"
                )


# ------------------------------------------------------- the SQL actually runs (needs Spark)


@pytest.fixture(scope="module")
def live_ctx(live_tables):
    """Real pipeline output with the session views registered, exactly as cell 1 leaves them."""
    import os

    import panels

    spark, tables = live_tables
    os.environ["SCOPE"] = "sca"
    os.environ["SEVERITIES"] = "CRITICAL,HIGH"
    os.environ["SCAN_ID"] = ""
    return spark, panels.context(spark, tables=tables)


@pytest.mark.parametrize("name", EXPECTED)
def test_every_sql_cell_runs_verbatim(name, live_ctx):
    """What the old dashboard suite could only check about a document it generated, this checks
    about the artifact that ships. A column typo fails here, not on somebody's cluster."""
    pytest.importorskip("delta")
    spark, _ = live_ctx
    doc = load(NOTEBOOK_DIR / f"{name}.ipynb")
    for cell, query in sql_cells(doc):
        try:
            spark.sql(query).collect()
        except Exception as exc:  # noqa: BLE001 -- re-raised with the cell named
            raise AssertionError(f"{name}: {title(cell)!r} failed:\n{query}\n\n{exc}") from exc


def test_at_least_one_page_ships_an_editable_sql_cell():
    """A ``%sql`` cell over a pinned view is the most native affordance there is: the reader can
    edit it in place without knowing anything about this repo."""
    total = sum(len(list(sql_cells(load(NOTEBOOK_DIR / f"{n}.ipynb")))) for n in PAGES)
    assert total >= 2


# ---------------------------------------------------------------------------- the tree


def test_the_readme_notebook_tree_matches_what_ships():
    """The deployment instructions cannot drift from the artifact -- the same rule the pipeline's
    own module tree has had since a stale folder cost 137,870 findings."""
    import run_pipeline

    text = (BRICK_DIR / "README.md").read_text(encoding="utf-8")
    start = next(
        i for i, line in enumerate(text.splitlines())
        if "these files go on sys.path too" in line
    )
    listed = set()
    for line in text.splitlines()[start + 1 :]:
        if line.startswith("```"):
            break
        listed |= set(re.findall(r"([\w.]+\.(?:py|ipynb))", line))
    expected = {
        f"{m}.py" for m in run_pipeline.NOTEBOOK_MODULES + run_pipeline.MIGRATION_MODULES
    } | {f"{n}.ipynb" for n in EXPECTED}
    assert listed == expected, (
        f"only in README {sorted(listed - expected)}, only shipped {sorted(expected - listed)}"
    )


def test_matplotlib_is_no_longer_a_dependency():
    """The notebooks render through Databricks itself -- Plotly in the cell, the native chart
    editor, and ``displayHTML``. A stray import would quietly bring back a static-PNG surface
    that nobody maintains and no reviewer would notice.

    Prose is exempt: ``figures.py`` says *why* it is not matplotlib, and that sentence is worth
    keeping.
    """
    here = Path(__file__).resolve()  # this file names the token it is looking for
    sources = list(BRICK_DIR.glob("*.py")) + list(BRICK_DIR.glob("tests/*.py")) + NOTEBOOKS
    for path in sources:
        if path.resolve() == here:
            continue
        text = path.read_text(encoding="utf-8")
        assert "import matplotlib" not in text, path.name
        assert "matplotlib.use" not in text, path.name
    assert "matplotlib" not in (BRICK_DIR / "requirements.txt").read_text(encoding="utf-8")
