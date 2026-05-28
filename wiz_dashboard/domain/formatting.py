"""Human-friendly duration formatting."""

import pandas as pd


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
