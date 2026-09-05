"""The requirements pin and the jar pin have to name the same Delta release.

An unpinned ``pyspark>=3.5`` resolves to pyspark 4.x today (PyPI has no 3.5-only floor), and
4.x mismatches the ``io.delta:delta-spark_2.12:3.3.2`` jar coordinate hardcoded as
``DELTA_PACKAGE`` in ``conftest.py`` -- delta-spark 3.3.x declares ``pyspark>=3.5.3,<3.6``. The
failure that produces is not a pip error: it installs cleanly and then dies building the
``SparkSession``, so the fix belongs in the requirements file, not in a version check at import
time. This test pins the fix rather than the failure: the ``delta-spark`` floor in
``requirements.txt`` must equal the jar version in ``conftest.py``, and ``pyspark`` must carry
an upper bound below 3.6 so a future ``pip install`` cannot silently drift back onto 4.x.
"""

from __future__ import annotations

import importlib.metadata
import re
from pathlib import Path

import pytest

BRICK_DIR = Path(__file__).resolve().parents[1]


def _delta_package_version(conftest_path: Path) -> str:
    text = conftest_path.read_text()
    match = re.search(r'DELTA_PACKAGE\s*=\s*"io\.delta:delta-spark_2\.12:([\d.]+)"', text)
    assert match, f"DELTA_PACKAGE not found in {conftest_path}"
    return match.group(1)


def _requirement_bounds(requirements_path: Path, package: str) -> str:
    """Return the raw version-specifier tail of ``package``'s line, e.g. '>=3.3.2,<3.4'."""
    text = requirements_path.read_text()
    match = re.search(rf"^{re.escape(package)}\s*((?:[<>=!~][^\s#]*)(?:,[^\s#]*)*)", text, re.M)
    assert match, f"{package} requirement not found in {requirements_path}"
    return match.group(1)


@pytest.mark.parametrize(
    "requirements_name, conftest_name",
    [
        ("requirements.txt", "tests/conftest.py"),
        ("devsecops/requirements.txt", "devsecops/tests/conftest.py"),
    ],
)
def test_delta_spark_floor_matches_the_pinned_jar(requirements_name, conftest_name):
    requirements_path = BRICK_DIR / requirements_name
    conftest_path = BRICK_DIR / conftest_name

    jar_version = _delta_package_version(conftest_path)
    bounds = _requirement_bounds(requirements_path, "delta-spark")
    lower_match = re.search(r">=\s*([\d.]+)", bounds)
    assert lower_match, f"delta-spark has no lower bound in {requirements_path}: {bounds!r}"
    assert lower_match.group(1) == jar_version, (
        f"{requirements_path} pins delta-spark>={lower_match.group(1)} but "
        f"{conftest_path} pins the jar at {jar_version} -- they must name the same release."
    )


@pytest.mark.parametrize(
    "requirements_name",
    ["requirements.txt", "devsecops/requirements.txt"],
)
def test_pyspark_is_upper_bounded_below_3_6(requirements_name):
    requirements_path = BRICK_DIR / requirements_name
    bounds = _requirement_bounds(requirements_path, "pyspark")
    upper_match = re.search(r"<\s*([\d.]+)", bounds)
    assert upper_match, (
        f"{requirements_path} pins pyspark{bounds!r} with no upper bound -- an unpinned "
        "pyspark>=3.5 resolves to pyspark 4.x today, which mismatches the delta-spark 3.3.x "
        "jar pinned in conftest.py (delta-spark 3.3.x declares pyspark>=3.5.3,<3.6)."
    )
    assert upper_match.group(1) == "3.6", (
        f"{requirements_path} bounds pyspark below {upper_match.group(1)}, expected <3.6 to "
        "match what delta-spark 3.3.x actually declares."
    )


@pytest.mark.parametrize(
    "conftest_name",
    ["tests/conftest.py", "devsecops/tests/conftest.py"],
)
def test_installed_delta_spark_matches_the_pinned_jar_exactly(conftest_name):
    """The installed Python package and the ``--packages`` jar have to be the SAME release.

    ``delta-spark`` and its jar ship together from one Delta release, and the jar is what
    decides at runtime: ``StagedDeltaTableV2.capabilities()`` is a property of the JAR, not of
    the Python package, so a jar one patch behind the installed package can silently refuse a
    write the Python API looks like it should support. That was measured here -- delta-spark
    3.3.3 installed, jar pinned at 3.3.2 -- and the failure was not a version-mismatch error: it
    was ``AnalysisException: Table ... does not support truncate in batch mode``, raised deep
    inside ``csvstore.restore``'s ``saveAsTable`` call, nowhere near this pin. So this asserts
    equality, not a floor: a floor lets the jar and the package drift apart again the next time
    either is bumped alone.
    """
    conftest_path = BRICK_DIR / conftest_name
    jar_version = _delta_package_version(conftest_path)
    installed_version = importlib.metadata.version("delta-spark")
    assert installed_version == jar_version, (
        f"installed delta-spark=={installed_version} but {conftest_path} pins the jar at "
        f"{jar_version} -- they must name the same release, or the jar's capabilities (e.g. "
        "TRUNCATE/OVERWRITE_BY_FILTER on a staged Delta table) can lag what the installed "
        "package expects, and the symptom shows up as an AnalysisException about truncate "
        "support deep inside a restore, not as a version-mismatch error here."
    )
