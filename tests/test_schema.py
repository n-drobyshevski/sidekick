"""Tests for the dual-shape pydantic schema layer (handles flat + grouped responses)."""

from wiz_dashboard.data.transform import extract_nodes
from wiz_dashboard.models import schema


def test_parse_flat_finding():
    node = {
        "id": "x",
        "severity": "HIGH",
        "firstDetectedAt": "2026-01-01T00:00:00Z",
        "vulnerableAsset": {"name": "vm1"},
        "extraField": "ignored",
    }
    parsed = schema.parse_node(node)
    assert isinstance(parsed, schema.Finding)
    assert parsed.severity == "HIGH"
    assert parsed.vulnerableAsset.name == "vm1"


def test_parse_grouped_asset_node():
    node = {
        "id": "g1",
        "vulnerableAsset": {"name": "vm2"},
        "analytics": {
            "totalFindingCount": 63,
            "criticalSeverityFindingCount": 63,
            "highSeverityFindingCount": 0,
        },
    }
    parsed = schema.parse_node(node)
    assert isinstance(parsed, schema.AssetGroup)
    assert parsed.analytics.totalFindingCount == 63


def test_parse_missing_fields_does_not_raise():
    parsed = schema.parse_node({"id": "only-id"})
    assert isinstance(parsed, schema.Finding)
    assert parsed.severity is None


def test_parse_non_dict_kept_raw():
    assert schema.parse_node("garbage") == {"_raw": "garbage"}


def test_is_grouped_shape():
    assert schema.is_grouped_shape([{"id": "g", "analytics": {"totalFindingCount": 5}}]) is True
    assert schema.is_grouped_shape([{"id": "f", "severity": "LOW"}]) is False


def test_severity_counts_from_groups():
    groups = [
        schema.parse_node({"analytics": {"criticalSeverityFindingCount": 63}}),
        schema.parse_node(
            {"analytics": {"criticalSeverityFindingCount": 57, "highSeverityFindingCount": 2}}
        ),
    ]
    counts = schema.severity_counts_from_groups(
        [g for g in groups if isinstance(g, schema.AssetGroup)]
    )
    assert counts == {"CRITICAL": 120, "HIGH": 2}


def test_committed_example_is_valid_grouped_response(grouped_sample):
    """The repaired os_vulns_response_exemple.json parses end-to-end as grouped data."""
    nodes = extract_nodes(grouped_sample)
    assert len(nodes) == 10
    assert schema.is_grouped_shape(nodes)
    groups = [g for g in schema.parse_nodes(nodes) if isinstance(g, schema.AssetGroup)]
    counts = schema.severity_counts_from_groups(groups)
    assert counts == {"CRITICAL": 494}


def test_vulnerable_asset_captures_enriched_fields(grouped_sample):
    """The enriched VulnerableAsset model surfaces the real grouped fields."""
    nodes = extract_nodes(grouped_sample)
    asset = schema.VulnerableAsset.model_validate(nodes[0]["vulnerableAsset"])
    assert asset.externalId
    assert asset.subscriptionName
    assert isinstance(asset.tags, dict) and asset.tags
