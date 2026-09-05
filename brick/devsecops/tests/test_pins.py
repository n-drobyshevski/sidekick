"""Mirror of ``brick/tests/test_pins.py`` for this fork.

Running ``pytest brick/devsecops/tests`` in isolation (the command this suite is actually run
with) never collects ``brick/tests/test_pins.py``, so the same regression -- an unpinned
``pyspark>=3.5`` resolving to 4.x and mismatching the ``io.delta:delta-spark_2.12:3.3.2`` jar
pinned in ``conftest.py`` -- needs its own guard here rather than relying on the upstream
suite to have been run too. See ``brick/tests/test_pins.py`` for the full defect writeup; this
copy checks only this directory's ``requirements.txt`` and ``conftest.py``.
"""

from __future__ import annotations

import re
from pathlib import Path

DEVSECOPS_DIR = Path(__file__).resolve().parents[1]


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


def test_delta_spark_floor_matches_the_pinned_jar():
    requirements_path = DEVSECOPS_DIR / "requirements.txt"
    conftest_path = DEVSECOPS_DIR / "tests" / "conftest.py"

    jar_version = _delta_package_version(conftest_path)
    bounds = _requirement_bounds(requirements_path, "delta-spark")
    lower_match = re.search(r">=\s*([\d.]+)", bounds)
    assert lower_match, f"delta-spark has no lower bound in {requirements_path}: {bounds!r}"
    assert lower_match.group(1) == jar_version, (
        f"{requirements_path} pins delta-spark>={lower_match.group(1)} but "
        f"{conftest_path} pins the jar at {jar_version} -- they must name the same release."
    )


def test_pyspark_is_upper_bounded_below_3_6():
    requirements_path = DEVSECOPS_DIR / "requirements.txt"
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
