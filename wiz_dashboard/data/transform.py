"""Pure data-transform helpers: coerce raw responses into nodes and a DataFrame."""

import ast
import json

import pandas as pd


def coerce_results(results):
    """Normalize dict/list/json-string/python-repr-string/SDK-result into a plain object.

    The Wiz SDK returns a ``WizAPIResult`` wrapper that holds a live SSL socket and so
    can't be pickled by ``st.cache_data``. This converts it (and any similar wrapper) to
    plain Python data so the cached ``fetch_findings`` value is serializable. The SDK's
    ``.nodes`` property is preferred because it spans *all* paginated pages (unlike
    ``.data``, which is only the last page); the nodes are re-wrapped in the canonical
    ``{"data": {"vulnerabilityFindings": {"nodes": [...]}}}`` envelope that
    ``extract_nodes`` understands. ``to_json()`` (the SDK's own serializer, also
    page-aware) and the unwrapped ``.data`` dict are fallbacks.
    """
    if isinstance(results, (dict, list)):
        return results
    if isinstance(results, str):
        s = results.strip()
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            pass
        try:
            parsed = ast.literal_eval(s)
            if isinstance(parsed, (dict, list)):
                return parsed
        except (ValueError, SyntaxError):
            pass
        return results
    # SDK wrapper objects (e.g. WizAPIResult): not pickle-safe (live SSL socket).
    # Prefer .nodes — it aggregates every paginated page — wrapped in the envelope
    # extract_nodes expects.
    try:
        nodes = getattr(results, "nodes", None)
        if isinstance(nodes, list):
            return {"data": {"vulnerabilityFindings": {"nodes": nodes}}}
    except Exception:
        pass
    # to_json(): the SDK's own page-aware serializer (string of dict or list of pages).
    for method in ("to_json", "to_dict", "as_dict"):
        fn = getattr(results, method, None)
        if callable(fn):
            try:
                candidate = fn()
                if isinstance(candidate, str):
                    candidate = json.loads(candidate)
                if isinstance(candidate, (dict, list)):
                    return candidate
            except Exception:
                pass
    # Last resort: the (current-page-only) data dict, re-wrapped so extract_nodes can
    # find data.<group>.nodes.
    for attr in ("data", "raw"):
        try:
            candidate = getattr(results, attr, None)
        except Exception:
            candidate = None
        if isinstance(candidate, dict):
            return candidate if "data" in candidate else {"data": candidate}
        if isinstance(candidate, list):
            return candidate
    return results


def extract_nodes(results):
    results = coerce_results(results)
    if not results:
        return []
    if isinstance(results, list) and results and isinstance(results[0], dict):
        merged = []
        ok = False
        for page in results:
            if isinstance(page, dict):
                sub = extract_nodes(page)
                if sub:
                    merged.extend(sub)
                    ok = True
        if ok:
            return merged
    if isinstance(results, dict):
        if "data" in results and isinstance(results["data"], dict):
            data = results["data"]
            if "vulnerabilityFindings" in data:
                vf = data["vulnerabilityFindings"]
                if isinstance(vf, dict) and "nodes" in vf:
                    return vf.get("nodes") or []
            for v in data.values():
                if isinstance(v, dict) and "nodes" in v:
                    return v.get("nodes") or []
        if "nodes" in results:
            return results.get("nodes") or []
    if isinstance(results, list):
        return results
    return [results]


def df_signature(df) -> str:
    """Cheap, stable signature for cache-keying computations derived from ``df``.

    Used with the ``@st.cache_data`` ``(sig, _df)`` idiom so the (potentially large)
    DataFrame isn't hashed on every rerun -- only this string is. Falls back to a
    shape+columns key when cells aren't hashable (e.g. list-valued columns).
    """
    if df is None or getattr(df, "empty", True):
        return "empty"
    try:
        h = int(pd.util.hash_pandas_object(df, index=True).sum())
    except Exception:
        h = hash(tuple(map(str, df.columns)))
    return f"{df.shape}|{tuple(df.columns)}|{h}"


# Low-cardinality string columns worth dictionary-encoding after flattening. ``category``
# dtype shrinks a 100k+-row frame's memory severalfold AND the Arrow payload
# st.dataframe/st.data_editor serialize to the browser on every render (Arrow encodes
# categoricals dictionary-style). Values compare equal to their plain-string selves, so
# filters/groupbys downstream are unaffected.
_CATEGORY_COLUMNS = (
    "severity",
    "status",
    "detectionMethod",
    "vendorSeverity",
    "nvdSeverity",
    "epssSeverity",
    "vulnerableAsset.type",
    "vulnerableAsset.cloudPlatform",
    "vulnerableAsset.region",
    "vulnerableAsset.subscriptionName",
)


def _categorize(df):
    for col in _CATEGORY_COLUMNS:
        if col in df.columns:
            try:
                df[col] = df[col].astype("category")
            except (TypeError, ValueError):
                pass  # unhashable cells (e.g. lists) -- leave the column as-is
    return df


def nodes_to_dataframe(nodes):
    if not nodes:
        return pd.DataFrame()
    if isinstance(nodes, dict):
        nodes = [nodes]
    cleaned = []
    for item in nodes:
        if isinstance(item, dict):
            cleaned.append(item)
            continue
        if isinstance(item, str):
            for parser in (json.loads, ast.literal_eval):
                try:
                    p = parser(item)
                    if isinstance(p, dict):
                        cleaned.append(p)
                        break
                except Exception:
                    pass
            else:
                cleaned.append({"_raw": str(item)})
                continue
            continue
        cleaned.append({"_raw": str(item)})
    try:
        df = pd.json_normalize(cleaned, sep=".")
    except Exception:
        cols = sorted({k for row in cleaned for k in row.keys()})
        df = pd.DataFrame([{k: r.get(k) for k in cols} for r in cleaned])
    return _categorize(df)
