"""Rule-based domain assignment: triage findings to organizational domains.

A *domain* is a named bucket ("Payments", "Data Platform") with an ordered position and
one or more *rules*; each rule is an AND of *conditions*; a domain claims a finding when
ANY of its rules matches (OR of rules). Domains are evaluated in list order and the
first match wins, so every finding lands in exactly one domain — or ``UNASSIGNED``.

Condition types (the persisted dicts under ``settings.json → domains.items[].rules``):

* ``{"type": "tag", "key": K, "value": V}`` — the asset carries tag ``K`` with value
  ``V``. Keys compare exact and case-sensitive (cloud tag keys are machine
  identifiers); values compare trimmed + case-insensitive. ``value: null`` means
  "key exists" with any value, including the empty string.
* ``{"type": "name_regex", "pattern": P}`` — ``re.search`` over the asset name,
  ``re.IGNORECASE``. An invalid or over-long pattern compiles to never-match
  (``validate_domains`` reports it; the engine must not guess).
* ``{"type": "subscription", "values": [...]}`` — the asset's cloud subscription
  (name or external id) equals any of the values, trimmed + case-insensitive.
* ``{"type": "support_group", "values": [...]}`` — the asset's support group equals
  any of the values, trimmed + case-insensitive. The support group is resolved live
  from the subscription's ``Wiz/provisioning`` tag and attached to each record as
  ``_supportGroup`` by the server before assignment (the engine only reads the field,
  never the subscription→group map). All-false in the Streamlit frame, which does not
  attach it — the GAS port populates it.

A rule with zero (or any malformed) conditions never matches: a hand-edited settings
file must fail closed, never become an accidental catch-all.

Pure pandas/stdlib — no Streamlit — so the matrix of semantics above is unit-testable
directly (see ``tests/test_domain_rules.py``). Cached wrappers live in
``ui/pages/_derived.py`` and key on the settings ``domains.version`` token.
"""

import json
import logging
import re
from typing import NamedTuple

import pandas as pd

from wiz_dashboard.domain.lifecycle import _present

logger = logging.getLogger(__name__)

UNASSIGNED = "Unassigned"

# Backtracking mitigation for user-supplied patterns (stdlib ``re`` has no timeout).
MAX_REGEX_LEN = 200

# ``ledger._base_df`` surfaces compacted episodes with this asset-name placeholder;
# a name regex must never "match" it — episodes carry no asset data and stay Unassigned.
_COMPACTED_ASSET = "(compacted)"

# Column candidates per frame shape. The live findings frame is the json_normalize
# output (dotted keys); the ledger base frame uses the vuln_ledger column names.
_FRAME_NAME_COLS = ("vulnerableAsset.name",)
_FRAME_SUB_COLS = (
    "vulnerableAsset.subscriptionName",
    "vulnerableAsset.subscriptionExternalId",
    "vulnerableAsset.subscriptionId",  # not in the current QUERY; opportunistic
)
_FRAME_TAGS_DICT_COL = "vulnerableAsset.tags"
_FRAME_TAGS_PREFIX = "vulnerableAsset.tags."
_LEDGER_NAME_COLS = ("asset_name",)
_LEDGER_SUB_COLS = ("subscription_name", "subscription_ext_id")
# Support group is attached live as ``_supportGroup`` by the GAS server before
# assignment; ``vulnerableAsset.supportGroup`` / ``support_group`` cover raw shapes.
_FRAME_SG_COLS = ("_supportGroup", "vulnerableAsset.supportGroup")
_LEDGER_SG_COLS = ("support_group",)


class CompiledDomain(NamedTuple):
    name: str
    rules: list  # list[list[condition]] — a None entry = a rule that never matches


def _fold(v) -> str:
    return str(v).strip().casefold()


def _compile_condition(cond):
    """One persisted condition dict → an internal spec tuple, or ``None`` (never-match)."""
    if not isinstance(cond, dict):
        return None
    ctype = cond.get("type")
    if ctype == "tag":
        key = cond.get("key")
        if not isinstance(key, str) or not key.strip():
            return None
        value = cond.get("value")
        if value is not None and not isinstance(value, (str, int, float, bool)):
            return None
        return ("tag", key.strip(), None if value is None else _fold(value))
    if ctype == "name_regex":
        pattern = cond.get("pattern")
        if not isinstance(pattern, str) or not pattern.strip() or len(pattern) > MAX_REGEX_LEN:
            return None
        try:
            return ("regex", re.compile(pattern, re.IGNORECASE))
        except re.error:
            logger.warning("Domain rule regex does not compile: %r", pattern)
            return None
    if ctype == "subscription":
        values = cond.get("values")
        if not isinstance(values, (list, tuple)) or not values:
            return None
        folded = {_fold(v) for v in values if isinstance(v, (str, int, float)) and str(v).strip()}
        return ("sub", folded) if folded else None
    if ctype == "support_group":
        values = cond.get("values")
        if not isinstance(values, (list, tuple)) or not values:
            return None
        folded = {_fold(v) for v in values if isinstance(v, (str, int, float)) and str(v).strip()}
        return ("sg", folded) if folded else None
    return None


def compile_domains(items) -> list:
    """Persisted ``items`` → priority-ordered ``CompiledDomain`` list.

    Structurally hopeless items (no dict, blank name) are skipped; a rule containing
    any malformed condition is kept as never-match (``None``) so partial corruption
    fails closed instead of widening a domain.
    """
    compiled = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        rules = []
        for rule in item.get("rules") or []:
            conds = rule.get("conditions") if isinstance(rule, dict) else None
            if not isinstance(conds, list) or not conds:
                rules.append(None)
                continue
            specs = [_compile_condition(c) for c in conds]
            rules.append(None if any(s is None for s in specs) else specs)
        compiled.append(CompiledDomain(name.strip(), rules))
    return compiled


def validate_domains(items) -> list:
    """Human-readable errors for a would-be ``items`` list; ``[]`` when saveable."""
    errors = []
    seen = set()
    for i, item in enumerate(items or [], start=1):
        label = f"Domain {i}"
        if not isinstance(item, dict):
            errors.append(f"{label}: not a valid entry.")
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append(f"{label}: name is required.")
            name = ""
        else:
            name = name.strip()
            label = f"Domain “{name}”"
            if name.casefold() == UNASSIGNED.casefold():
                errors.append(f"{label}: “{UNASSIGNED}” is reserved.")
            if "," in name:
                errors.append(f"{label}: names cannot contain commas.")
            if name.casefold() in seen:
                errors.append(f"{label}: duplicate name.")
            seen.add(name.casefold())
        rules = item.get("rules")
        if not isinstance(rules, list) or not rules:
            errors.append(f"{label}: needs at least one rule.")
            continue
        for j, rule in enumerate(rules, start=1):
            conds = rule.get("conditions") if isinstance(rule, dict) else None
            if not isinstance(conds, list) or not conds:
                errors.append(f"{label}, rule {j}: needs at least one condition.")
                continue
            for k, cond in enumerate(conds, start=1):
                where = f"{label}, rule {j}, condition {k}"
                if not isinstance(cond, dict):
                    errors.append(f"{where}: not a valid condition.")
                    continue
                ctype = cond.get("type")
                if ctype == "tag":
                    key = cond.get("key")
                    if not isinstance(key, str) or not key.strip():
                        errors.append(f"{where}: tag key is required.")
                elif ctype == "name_regex":
                    pattern = cond.get("pattern")
                    if not isinstance(pattern, str) or not pattern.strip():
                        errors.append(f"{where}: pattern is required.")
                    elif len(pattern) > MAX_REGEX_LEN:
                        errors.append(
                            f"{where}: pattern is longer than {MAX_REGEX_LEN} characters."
                        )
                    else:
                        try:
                            re.compile(pattern)
                        except re.error as exc:
                            errors.append(f"{where}: pattern does not compile ({exc}).")
                elif ctype == "subscription":
                    values = cond.get("values")
                    if (
                        not isinstance(values, (list, tuple))
                        or not any(isinstance(v, str) and v.strip() for v in values)
                    ):
                        errors.append(f"{where}: pick at least one subscription.")
                elif ctype == "support_group":
                    values = cond.get("values")
                    if (
                        not isinstance(values, (list, tuple))
                        or not any(isinstance(v, str) and v.strip() for v in values)
                    ):
                        errors.append(f"{where}: pick at least one support group.")
                else:
                    errors.append(f"{where}: unknown condition type {ctype!r}.")
    return errors


def domain_names(items) -> list:
    """Priority-ordered domain names with ``UNASSIGNED`` appended (filter options)."""
    names = [
        item["name"].strip()
        for item in items or []
        if isinstance(item, dict)
        and isinstance(item.get("name"), str)
        and item["name"].strip()
    ]
    return names + [UNASSIGNED]


# --------------------------------------------------------------------------- #
#  Per-record evaluation (drill-down records, tests, vectorization parity)
# --------------------------------------------------------------------------- #
def _record_tags(record) -> dict:
    """The asset's tags from a raw node or a flattened record. ``{}`` when absent."""
    va = record.get("vulnerableAsset")
    if isinstance(va, dict) and isinstance(va.get("tags"), dict):
        return va["tags"]
    tags = record.get("vulnerableAsset.tags")
    if isinstance(tags, dict):
        return tags
    out = {
        k[len(_FRAME_TAGS_PREFIX):]: v
        for k, v in record.items()
        if k.startswith(_FRAME_TAGS_PREFIX) and _present(v)
    }
    if out:
        return out
    tags_json = record.get("tags_json")
    if isinstance(tags_json, str) and tags_json:
        try:
            parsed = json.loads(tags_json)
            if isinstance(parsed, dict):
                return parsed
        except (ValueError, TypeError):
            pass
    return {}


def _record_values(record, *keys) -> list:
    """ALL present values among dotted keys (unlike ``lifecycle.field``'s first-wins)."""
    out = []
    va = record.get("vulnerableAsset")
    for k in keys:
        v = record.get(k)
        if _present(v):
            out.append(str(v))
        elif isinstance(va, dict):
            v = va.get(k.split(".")[-1])
            if _present(v):
                out.append(str(v))
    return out


def _condition_matches(spec, record, tags) -> bool:
    kind = spec[0]
    if kind == "tag":
        _, key, value = spec
        if key not in tags or tags[key] is None:
            return False
        return value is None or _fold(tags[key]) == value
    if kind == "regex":
        names = _record_values(record, *_FRAME_NAME_COLS) or _record_values(
            record, *_LEDGER_NAME_COLS
        )
        return any(spec[1].search(n) for n in names)
    if kind == "sub":
        subs = _record_values(record, *_FRAME_SUB_COLS) + _record_values(
            record, *_LEDGER_SUB_COLS
        )
        return any(_fold(s) in spec[1] for s in subs)
    if kind == "sg":
        sgs = _record_values(record, *_FRAME_SG_COLS) + _record_values(
            record, *_LEDGER_SG_COLS
        )
        return any(_fold(s) in spec[1] for s in sgs)
    return False


def assign_domain(record, compiled) -> str:
    """The domain a single finding record belongs to (first match wins)."""
    name = _record_values(record, *_LEDGER_NAME_COLS)
    if name and name[0] == _COMPACTED_ASSET:
        return UNASSIGNED
    tags = _record_tags(record)
    for dom in compiled:
        for rule in dom.rules:
            if rule and all(_condition_matches(spec, record, tags) for spec in rule):
                return dom.name
    return UNASSIGNED


# --------------------------------------------------------------------------- #
#  Vectorized evaluation over a whole frame
# --------------------------------------------------------------------------- #
def _folded(series) -> pd.Series:
    """Trimmed, casefolded string view of a column (categoricals included)."""
    return series.astype(str).str.strip().str.casefold()


class _FrameContext:
    """Per-frame column access with tag-series memoization for one assign pass."""

    def __init__(self, df, name_cols, sub_cols, tags_dicts, sg_cols=()):
        self.df = df
        self.name_cols = [c for c in name_cols if c in df.columns]
        self.sub_cols = [c for c in sub_cols if c in df.columns]
        self.sg_cols = [c for c in sg_cols if c in df.columns]
        self._tags_dicts = tags_dicts  # Series of dict|None, or None
        self._tag_cache = {}
        self._false = pd.Series(False, index=df.index)

    def tag_masks(self, key):
        """``(present, folded_values)`` for one tag key across the frame."""
        if key in self._tag_cache:
            return self._tag_cache[key]
        present = self._false.copy()
        values = pd.Series("", index=self.df.index, dtype=object)
        col = _FRAME_TAGS_PREFIX + key
        if col in self.df.columns:
            s = self.df[col]
            p = s.notna()
            present |= p
            values[p] = _folded(s[p])
        if self._tags_dicts is not None:
            extracted = self._tags_dicts.map(
                lambda t: t.get(key) if isinstance(t, dict) else None
            )
            p = extracted.notna()
            fill = p & ~present
            present |= p
            if fill.any():
                values[fill] = extracted[fill].map(_fold)
        self._tag_cache[key] = (present, values)
        return present, values

    def condition_mask(self, spec) -> pd.Series:
        kind = spec[0]
        if kind == "tag":
            _, key, value = spec
            present, values = self.tag_masks(key)
            return present if value is None else present & (values == value)
        if kind == "regex":
            mask = self._false.copy()
            for col in self.name_cols:
                s = self.df[col]
                mask |= s.notna() & s.astype(str).str.contains(spec[1], na=False)
            return mask
        if kind == "sub":
            mask = self._false.copy()
            for col in self.sub_cols:
                s = self.df[col]
                mask |= s.notna() & _folded(s).isin(spec[1])
            return mask
        if kind == "sg":
            mask = self._false.copy()
            for col in self.sg_cols:
                s = self.df[col]
                mask |= s.notna() & _folded(s).isin(spec[1])
            return mask
        return self._false


def _assign_over(ctx, compiled, eligible) -> pd.Series:
    result = pd.Series(UNASSIGNED, index=ctx.df.index, dtype=object)
    unclaimed = eligible.copy()
    for dom in compiled:
        if not unclaimed.any():
            break
        dom_mask = ctx._false.copy()
        for rule in dom.rules:
            if not rule:
                continue
            rule_mask = None
            for spec in rule:
                m = ctx.condition_mask(spec)
                rule_mask = m if rule_mask is None else rule_mask & m
                if not rule_mask.any():
                    break
            if rule_mask is not None:
                dom_mask |= rule_mask
        take = dom_mask & unclaimed
        result[take] = dom.name
        unclaimed &= ~take
    return result


def assign_domains_frame(df, compiled) -> pd.Series:
    """Domain per row of a live findings frame (``nodes_to_dataframe`` shape)."""
    if df is None or df.empty:
        return pd.Series([], dtype=object)
    tags_dicts = df[_FRAME_TAGS_DICT_COL] if _FRAME_TAGS_DICT_COL in df.columns else None
    ctx = _FrameContext(df, _FRAME_NAME_COLS, _FRAME_SUB_COLS, tags_dicts, _FRAME_SG_COLS)
    return _assign_over(ctx, compiled, pd.Series(True, index=df.index))


def _parse_tags_json(s):
    if isinstance(s, str) and s:
        try:
            parsed = json.loads(s)
            return parsed if isinstance(parsed, dict) else None
        except (ValueError, TypeError):
            return None
    return None


def assign_domains_ledger(df, compiled) -> pd.Series:
    """Domain per row of the ledger base frame (``ledger.load_base_df`` shape).

    Compacted episode rows (placeholder asset name, no rule inputs) are pinned to
    ``UNASSIGNED`` before any condition runs — honest degradation over sealed data.
    """
    if df is None or df.empty:
        return pd.Series([], dtype=object)
    tags_dicts = df["tags_json"].map(_parse_tags_json) if "tags_json" in df.columns else None
    ctx = _FrameContext(df, _LEDGER_NAME_COLS, _LEDGER_SUB_COLS, tags_dicts, _LEDGER_SG_COLS)
    eligible = pd.Series(True, index=df.index)
    if "asset_name" in df.columns:
        eligible &= df["asset_name"].astype(str) != _COMPACTED_ASSET
    return _assign_over(ctx, compiled, eligible)
