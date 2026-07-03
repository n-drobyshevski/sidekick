"""Vectorized severity normalization matches the scalar path; df_signature is stable."""

import pandas as pd

from wiz_dashboard.data.transform import df_signature
from wiz_dashboard.domain.severity import (
    count_by_severity,
    normalize_severity,
    normalize_severity_series,
)

_SAMPLES = ["critical", "INFORMATIONAL", "Info", " High ", "weird", None, 123, "", "LOW"]


def test_series_matches_scalar_elementwise():
    s = pd.Series(_SAMPLES)
    assert list(normalize_severity_series(s)) == [normalize_severity(x) for x in _SAMPLES]


def test_count_by_severity_matches_apply_path():
    df = pd.DataFrame({"severity": _SAMPLES})
    expected = df["severity"].apply(normalize_severity).value_counts().to_dict()
    assert count_by_severity(df) == expected


def test_count_by_severity_empty_or_missing_column():
    assert count_by_severity(pd.DataFrame()) == {}
    assert count_by_severity(pd.DataFrame({"x": [1]})) == {}


def test_df_signature_stable_and_sensitive():
    df = pd.DataFrame({"severity": ["HIGH", "LOW"], "name": ["a", "b"]})
    sig = df_signature(df)
    assert sig == df_signature(df.copy())  # same data -> same signature
    mutated = df.copy()
    mutated.loc[0, "severity"] = "CRITICAL"
    assert df_signature(mutated) != sig  # changed data -> changed signature
    assert df_signature(pd.DataFrame()) == "empty"


def test_series_categorical_fast_path_matches_scalar():
    # The ingestion layer dictionary-encodes severity; the categorical fast path must be
    # element-for-element identical to the scalar path, including mixed-type categories
    # (123), missing values (None) and unknowns — and still return plain object dtype.
    s = pd.Series(_SAMPLES, dtype="category")
    out = normalize_severity_series(s)
    assert out.dtype == object
    assert list(out) == [normalize_severity(x) for x in _SAMPLES]


def test_count_by_severity_on_categorical_column():
    df = pd.DataFrame({"severity": pd.Series(_SAMPLES, dtype="category")})
    expected = pd.DataFrame({"severity": _SAMPLES})["severity"].apply(
        normalize_severity).value_counts().to_dict()
    assert count_by_severity(df) == expected
