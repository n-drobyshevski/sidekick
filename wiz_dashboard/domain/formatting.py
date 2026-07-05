"""Human-friendly duration and size formatting."""

import pandas as pd


def format_bytes(n) -> str:
    """Human-friendly byte size ("1.2 MB"). None/negative -> "0 B"."""
    n = 0 if n is None else max(0, float(n))
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{int(n)} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def format_duration(days):
    """Human-friendly duration. None/NaN -> em-dash."""
    if days is None or pd.isna(days):
        return "—"
    if days < 1 / 24:
        return "<1h"
    if days < 1:
        return f"{int(round(days*24))}h"
    if days < 30:
        return f"{days:.1f}d"
    if days < 365:
        return f"{days/30:.1f}mo"
    return f"{days/365:.1f}y"
