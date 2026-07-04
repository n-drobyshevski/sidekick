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


def test_extract_nodes_committed_fixture_grouped(app, fixture_text):
    # The committed fixture is now valid JSON in the grouped-by-asset shape; extract_nodes
    # coerces the JSON text and digs out the 10 grouped asset nodes.
    nodes = app.extract_nodes(fixture_text)
    assert len(nodes) == 10
    assert all(isinstance(n, dict) and "analytics" in n for n in nodes)


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


def test_nodes_to_dataframe_categorizes_low_cardinality_columns(app, flat_sample):
    import pandas as pd

    df = app.nodes_to_dataframe(app.extract_nodes(flat_sample))
    # Dictionary-encoded at ingestion (memory + Arrow-payload win at 100k+ rows)…
    assert isinstance(df["severity"].dtype, pd.CategoricalDtype)
    # …while the values still round-trip as the plain strings every consumer expects.
    sev = df["severity"].iloc[0]
    assert isinstance(sev, str)
    assert df.to_dict("records")[0]["severity"] == sev

    # A list-valued or otherwise unhashable column is left untouched rather than raising.
    mixed = app.nodes_to_dataframe([{"severity": "HIGH", "status": ["OPEN"]},
                                    {"severity": "LOW", "status": ["RESOLVED"]}])
    assert isinstance(mixed["severity"].dtype, pd.CategoricalDtype)
    assert mixed["status"].dtype == object


def test_merge_nodes_delta_wins_new_appended_inputs_untouched(app):
    from wiz_dashboard.data.transform import merge_nodes

    baseline = [
        {"id": "v1", "severity": "HIGH", "status": "OPEN"},
        {"id": "v2", "severity": "LOW", "status": "OPEN"},
    ]
    delta = [
        {"id": "v2", "severity": "LOW", "status": "RESOLVED", "resolvedAt": "2026-07-01T00:00:00Z"},
        {"id": "v3", "severity": "MEDIUM", "status": "OPEN"},
        # intra-delta duplicate: the LAST occurrence must win (freshest page)
        {"id": "v3", "severity": "CRITICAL", "status": "OPEN"},
    ]
    baseline_before = [dict(n) for n in baseline]
    delta_before = [dict(n) for n in delta]

    merged = merge_nodes(baseline, delta)

    assert [n["id"] for n in merged] == ["v1", "v2", "v3"]  # order kept, new appended
    assert merged[1]["status"] == "RESOLVED"                # delta replaced baseline node
    assert merged[2]["severity"] == "CRITICAL"              # last duplicate won
    assert baseline == baseline_before and delta == delta_before  # inputs never mutated
    assert merged[0] is baseline[0]  # untouched nodes shared by reference (no copies)


def test_merge_nodes_empty_edges(app):
    from wiz_dashboard.data.transform import merge_nodes

    base = [{"id": "v1"}]
    assert merge_nodes(base, []) == base
    assert merge_nodes(base, None) == base
    assert [n["id"] for n in merge_nodes([], [{"id": "v9"}])] == ["v9"]
    assert merge_nodes(None, None) == []
