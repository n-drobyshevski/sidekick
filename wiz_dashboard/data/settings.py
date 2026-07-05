"""Persisted user settings (``data/settings.json``).

Holds the severity scope: which severities scans *pull* from the Wiz API
(``fetch_severities``) and which the UI *displays* (``display_severities``,
always a subset of the fetch scope). Values are canonical uppercase tuples
ordered by ``config.SEVERITY_ORDER`` so they're stable as ``st.cache_data``
keys and comparable across sessions.

Reads mirror ``config.load_wiz_config``: a missing or unreadable file means
defaults, never an error. Writes are atomic (tmp + ``os.replace``) so a crash
mid-save can't leave a truncated file. ``config.DATA_DIR`` is read at call
time, so the test suite's ``_isolated_ledger`` fixture isolates this file too.
"""

import json
import logging
import os
import tempfile

from wiz_dashboard import config
from wiz_dashboard.domain.severity import normalize_severity

logger = logging.getLogger(__name__)

SETTINGS_FILENAME = "settings.json"


def _settings_path():
    return config.DATA_DIR / SETTINGS_FILENAME


def load_settings() -> dict:
    """Load the settings dict; ``{}`` on missing or invalid file."""
    p = _settings_path()
    if not p.exists():
        return {}
    try:
        loaded = json.loads(p.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        logger.warning("Unreadable settings file %s; using defaults", p, exc_info=True)
        return {}


def save_settings(d: dict) -> None:
    """Atomically write the settings dict."""
    p = _settings_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".settings-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(d, fh, indent=2)
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _canonical(values, default):
    """Normalize + validate a severity list into a canonical ordered tuple.

    Unknown/invalid entries are dropped (``INFORMATIONAL`` normalizes to
    ``INFO``); an empty or non-list result falls back to ``default``.
    """
    if not isinstance(values, (list, tuple)):
        return tuple(default)
    chosen = {normalize_severity(v) for v in values if isinstance(v, str)}
    chosen &= set(config.SELECTABLE_SEVERITIES)
    if not chosen:
        return tuple(default)
    return tuple(s for s in config.SEVERITY_ORDER if s in chosen)


def get_fetch_severities() -> tuple:
    """Severities scans pull from the Wiz API (canonical ordered tuple)."""
    return _canonical(load_settings().get("fetch_severities"), config.DEFAULT_FETCH_SEVERITIES)


def get_display_severities() -> tuple:
    """Severities the UI shows — always clamped to a subset of the fetch scope."""
    fetch = get_fetch_severities()
    disp = _canonical(
        load_settings().get("display_severities"), config.DEFAULT_DISPLAY_SEVERITIES
    )
    clamped = tuple(s for s in disp if s in fetch)
    return clamped or fetch


def set_fetch_severities(sevs) -> None:
    """Persist the fetch scope; re-clamps the stored display scope to stay a subset."""
    d = load_settings()
    fetch = _canonical(sevs, config.DEFAULT_FETCH_SEVERITIES)
    d["fetch_severities"] = list(fetch)
    disp = _canonical(d.get("display_severities"), fetch)
    d["display_severities"] = [s for s in disp if s in fetch] or list(fetch)
    save_settings(d)


def set_display_severities(sevs) -> None:
    """Persist the display scope, clamped to the stored fetch scope."""
    d = load_settings()
    fetch = _canonical(d.get("fetch_severities"), config.DEFAULT_FETCH_SEVERITIES)
    disp = _canonical(sevs, config.DEFAULT_DISPLAY_SEVERITIES)
    d["display_severities"] = [s for s in disp if s in fetch] or list(fetch)
    save_settings(d)


def get_retention_days():
    """Retention window in days for compacting old, closed data — or ``None`` (off).

    Default is ``config.DEFAULT_RETENTION_DAYS`` (retention ON out of the box; disable
    on the Settings page). Stored values are clamped to ``config.RETENTION_MIN_DAYS``
    so a hand-edited settings file can never seal fresh history.
    """
    raw = load_settings().get("retention_days", config.DEFAULT_RETENTION_DAYS)
    if raw is None:
        return None
    try:
        return max(int(raw), config.RETENTION_MIN_DAYS)
    except (TypeError, ValueError):
        return config.DEFAULT_RETENTION_DAYS


def set_retention_days(days) -> None:
    """Persist the retention window; ``None`` turns compaction off."""
    d = load_settings()
    if days is None:
        d["retention_days"] = None
    else:
        d["retention_days"] = max(int(days), config.RETENTION_MIN_DAYS)
    save_settings(d)


def get_auto_compact() -> bool:
    """Whether a successful scan persist also runs compaction (default: on)."""
    val = load_settings().get("auto_compact", True)
    return bool(val) if isinstance(val, bool) else True


def set_auto_compact(enabled) -> None:
    d = load_settings()
    d["auto_compact"] = bool(enabled)
    save_settings(d)


def api_severity_filter(severities):
    """GraphQL ``filterBy.severity`` values for a scope, or ``None`` when unscoped.

    A scope covering every selectable severity emits no filter at all, keeping
    the query byte-identical to the pre-settings behavior.
    """
    sevs = _canonical(severities, config.DEFAULT_FETCH_SEVERITIES)
    if set(sevs) == set(config.SELECTABLE_SEVERITIES):
        return None
    return [config.API_SEVERITY_VALUES[s] for s in sevs]
