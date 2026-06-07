"""Pure data-transform helpers: coerce raw responses into nodes and a DataFrame."""

import ast
import json

import pandas as pd


def coerce_results(results):
    """Normalize dict/list/json-string/python-repr-string into a plain object."""
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
        return pd.json_normalize(cleaned, sep=".")
    except Exception:
        cols = sorted({k for row in cleaned for k in row.keys()})
        return pd.DataFrame([{k: r.get(k) for k in cols} for r in cleaned])
