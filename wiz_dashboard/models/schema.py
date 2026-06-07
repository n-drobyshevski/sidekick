"""Pydantic models tolerant of BOTH Wiz response shapes.

The Wiz API can return either:

* **flat findings** -- one node per finding with ``severity`` + timestamps
  (``firstDetectedAt``/``resolvedAt``), used for MTTR/SLA analytics; or
* **grouped-by-asset** -- one node per asset carrying a nested ``analytics``
  block of per-severity finding *counts* (the shape of the committed fixture).

Every field is optional and extras are ignored, so parsing never raises on the
huge, field-sparse real responses; unparseable rows are kept as ``{"_raw": ...}``.
"""

from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict, ValidationError


class VulnerableAsset(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    type: Optional[str] = None
    name: Optional[str] = None
    cloudPlatform: Optional[str] = None
    externalId: Optional[str] = None
    subscriptionId: Optional[str] = None
    subscriptionName: Optional[str] = None
    subscriptionExternalId: Optional[str] = None
    tags: Optional[Dict[str, str]] = None


class Finding(BaseModel):
    """Flat per-finding record (the MTTR/SLA shape)."""

    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    name: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    firstDetectedAt: Optional[str] = None
    resolvedAt: Optional[str] = None
    fixedVersion: Optional[str] = None
    vulnerableAsset: Optional[VulnerableAsset] = None


class GroupAnalytics(BaseModel):
    """Per-asset finding counts nested under a grouped node's ``analytics`` key."""

    model_config = ConfigDict(extra="ignore")
    vulnerableAssetCount: Optional[int] = None
    totalFindingCount: Optional[int] = None
    criticalSeverityFindingCount: Optional[int] = None
    highSeverityFindingCount: Optional[int] = None
    mediumSeverityFindingCount: Optional[int] = None
    lowSeverityFindingCount: Optional[int] = None
    informationalSeverityFindingCount: Optional[int] = None


class AssetGroup(BaseModel):
    """Grouped-by-asset node (vulnerabilityFindingsGroupedByValues)."""

    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    vulnerableAsset: Optional[VulnerableAsset] = None
    analytics: Optional[GroupAnalytics] = None


ParsedNode = Union[Finding, AssetGroup, Dict[str, Any]]


def is_grouped_shape(nodes: List[Any]) -> bool:
    """True when nodes look grouped-by-asset (carry ``analytics`` counts, no severity)."""
    for n in nodes:
        if isinstance(n, dict) and "severity" not in n and isinstance(
            n.get("analytics"), dict
        ):
            return True
    return False


def parse_node(node: Any) -> ParsedNode:
    """Parse one node, tolerating both shapes; keep the raw dict on failure."""
    if not isinstance(node, dict):
        return {"_raw": node}
    if "severity" in node:
        try:
            return Finding.model_validate(node)
        except ValidationError:
            return {"_raw": node}
    if isinstance(node.get("analytics"), dict):
        try:
            return AssetGroup.model_validate(node)
        except ValidationError:
            return {"_raw": node}
    try:
        return Finding.model_validate(node)
    except ValidationError:
        return {"_raw": node}


def parse_nodes(nodes: List[Any]) -> List[ParsedNode]:
    return [parse_node(n) for n in nodes]


def severity_counts_from_groups(groups: List[AssetGroup]) -> Dict[str, int]:
    """Aggregate grouped per-asset analytics into a {severity: count} dict."""
    totals = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "INFO": 0}
    for g in groups:
        a = getattr(g, "analytics", None)
        if a is None:
            continue
        totals["CRITICAL"] += a.criticalSeverityFindingCount or 0
        totals["HIGH"] += a.highSeverityFindingCount or 0
        totals["MEDIUM"] += a.mediumSeverityFindingCount or 0
        totals["LOW"] += a.lowSeverityFindingCount or 0
        totals["INFO"] += a.informationalSeverityFindingCount or 0
    return {k: v for k, v in totals.items() if v}
