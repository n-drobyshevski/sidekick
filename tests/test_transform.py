"""Characterization tests for the data-transform layer (coerce/extract/normalize)."""


def test_coerce_results_passthrough_and_parse(app):
    assert app.coerce_results({"a": 1}) == {"a": 1}
    assert app.coerce_results([1, 2]) == [1, 2]
    assert app.coerce_results('{"a": 1}') == {"a": 1}
    assert app.coerce_results("{'a': 1}") == {"a": 1}  # python-repr via ast
    assert app.coerce_results("not json") == "not json"


def test_extract_nodes_flat_sample(app, flat_sample):
    nodes = app.extract_nodes(flat_sample)
    assert len(nodes) == 1
    assert nodes[0]["id"] == "dry-1"


def test_extract_nodes_paginated_list(app, flat_sample):
    nodes = app.extract_nodes([flat_sample, flat_sample])
    assert len(nodes) == 2


def test_extract_nodes_malformed_fixture_is_raw(app, fixture_text):
    # KNOWN: the committed fixture is malformed JSON (two concatenated docs) and
    # grouped-by-asset. Current behavior: JSON parse fails -> extract_nodes returns
    # the raw string wrapped in a list. Pinned here so the refactor must be deliberate.
    nodes = app.extract_nodes(fixture_text)
    assert len(nodes) == 1
    assert isinstance(nodes[0], str)


def test_nodes_to_dataframe_columns(app, flat_sample):
    df = app.nodes_to_dataframe(app.extract_nodes(flat_sample))
    assert {"id", "name", "severity", "vulnerableAsset.name"}.issubset(df.columns)


def test_nodes_to_dataframe_raw_fallback(app):
    df = app.nodes_to_dataframe(["garbage{"])
    assert "_raw" in df.columns
    assert df.shape == (1, 1)


def test_nodes_to_dataframe_empty(app):
    assert app.nodes_to_dataframe([]).empty
    assert app.nodes_to_dataframe(None).empty
