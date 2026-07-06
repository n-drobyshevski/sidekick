"""The Settings page's "Domains" section: manage rule-based triage domains.

Each finding is assigned to the FIRST matching domain in the list (priority = list
order, reorder = ↑/↓), or "Unassigned". A domain's rules OR together; the conditions
inside one rule AND together. The three condition types (tag / name regex /
subscription) are evaluated by the pure engine in ``domain.domain_rules``; this module
is only the management UI.

Editing state model: the add/edit dialog uses the **open-flag pattern** — internal
buttons (add/remove rule or condition) mutate structure and ``st.rerun()``, which
closes any ``st.dialog`` unless it is re-invoked, so ``render()`` re-opens the dialog
whenever ``dom_editor_open`` is set. Structure lives in ``dom_edit_rules`` as lists of
per-condition **uids** (monotonic, never reused) and each condition's field values live
in widget state keyed by uid (``dom_c_<uid>_*``) — so removing a condition never shifts
another condition's widget state.
"""

import json
import re
import uuid

import streamlit as st

from wiz_dashboard.data import settings
from wiz_dashboard.domain import domain_rules
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui.pages import _derived

_TYPE_LABELS = {
    "tag": "Tag",
    "name_regex": "Asset name (regex)",
    "subscription": "Subscription",
}
_LABEL_TYPES = {v: k for k, v in _TYPE_LABELS.items()}

_EDITOR_KEYS = ("dom_editor_open", "dom_editor_target", "dom_edit_rules", "dom_edit_name")

EXPORT_KIND = "wiz-sidekick-domains"


# --------------------------------------------------------------------------- #
#  JSON export / import (pure helpers — also the interchange format with the
#  GAS rebuild, which reads/writes the same {"kind", "items"} snapshot)
# --------------------------------------------------------------------------- #
def domains_export_json(items) -> str:
    """Portable snapshot of the domain rules. Editor ``id``s and the settings
    ``version`` are stripped: neither exists in the GAS app's items, and a fresh
    id is minted on import anyway."""
    portable = [{"name": it.get("name"), "rules": it.get("rules") or []} for it in items or []]
    return json.dumps({"kind": EXPORT_KIND, "items": portable}, indent=2, ensure_ascii=False)


def parse_domains_import(text: str) -> tuple[list, list[str]]:
    """Exported domains JSON → ``(persistable items, errors)``.

    Accepts the canonical export ({"kind": ..., "items": [...]}), a raw settings
    wrapper ({"version": ..., "items": [...]}) or a bare JSON array. Items get
    fresh ``dom-<hex8>`` ids — the row widgets key off id, so foreign ids must
    never survive an import. Deep validation is ``domain_rules.validate_domains``,
    the same gate the editor dialog uses."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return [], [f"Not valid JSON: {exc}"]
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        raw = data["items"]
    elif isinstance(data, list):
        raw = data
    else:
        return [], ['Unrecognized format — expected {"items": [...]} or a JSON array.']
    items = []
    for i, entry in enumerate(raw, start=1):
        if not isinstance(entry, dict):
            return [], [f"Item {i}: expected an object."]
        items.append(
            {
                "id": f"dom-{uuid.uuid4().hex[:8]}",
                "name": entry.get("name"),
                "rules": entry.get("rules") or [],
            }
        )
    return items, domain_rules.validate_domains(items)


# --------------------------------------------------------------------------- #
#  Editor state
# --------------------------------------------------------------------------- #
def _next_uid() -> int:
    uid = int(st.session_state.get("dom_uid_seq", 0)) + 1
    st.session_state["dom_uid_seq"] = uid
    return uid


def _clear_editor_state() -> None:
    for k in list(st.session_state):
        if k.startswith("dom_c_") or k in _EDITOR_KEYS:
            st.session_state.pop(k, None)


def _seed_condition(cond) -> int:
    """One stored condition dict → a fresh uid with its widget state pre-filled."""
    uid = _next_uid()
    ctype = cond.get("type") if isinstance(cond, dict) else None
    st.session_state[f"dom_c_{uid}_type"] = _TYPE_LABELS.get(ctype, "Tag")
    if ctype == "tag":
        st.session_state[f"dom_c_{uid}_key"] = str(cond.get("key") or "")
        value = cond.get("value")
        st.session_state[f"dom_c_{uid}_val"] = "" if value is None else str(value)
    elif ctype == "name_regex":
        st.session_state[f"dom_c_{uid}_pat"] = str(cond.get("pattern") or "")
    elif ctype == "subscription":
        st.session_state[f"dom_c_{uid}_subs"] = [
            str(v) for v in (cond.get("values") or []) if str(v).strip()
        ]
    return uid


def _open_editor(item=None) -> None:
    """Seed the editing buffer (from ``item``, or blank for Add) and set the open flag."""
    _clear_editor_state()
    st.session_state["dom_edit_name"] = (item or {}).get("name", "")
    rules = []
    for rule in (item or {}).get("rules") or []:
        conds = rule.get("conditions") if isinstance(rule, dict) else None
        rules.append([_seed_condition(c) for c in (conds or [{}])])
    if not rules:
        rules = [[_seed_condition({})]]
    st.session_state["dom_edit_rules"] = rules
    st.session_state["dom_editor_target"] = (item or {}).get("id")
    st.session_state["dom_editor_open"] = True


def _cond_from_state(uid) -> dict:
    """Rebuild one condition dict from its widgets (may be incomplete — the
    validator reports it; the engine fails closed on it)."""
    ctype = _LABEL_TYPES.get(st.session_state.get(f"dom_c_{uid}_type"), "tag")
    if ctype == "tag":
        value = str(st.session_state.get(f"dom_c_{uid}_val", "")).strip()
        return {
            "type": "tag",
            "key": str(st.session_state.get(f"dom_c_{uid}_key", "")).strip(),
            "value": value or None,  # blank = "key exists"
        }
    if ctype == "name_regex":
        return {
            "type": "name_regex",
            "pattern": str(st.session_state.get(f"dom_c_{uid}_pat", "")).strip(),
        }
    return {
        "type": "subscription",
        "values": [str(v) for v in st.session_state.get(f"dom_c_{uid}_subs", []) or []],
    }


def _built_item() -> dict:
    """The in-progress domain as a persisted-shape dict."""
    return {
        "id": st.session_state.get("dom_editor_target") or f"dom-{uuid.uuid4().hex[:8]}",
        "name": str(st.session_state.get("dom_edit_name", "")).strip(),
        "rules": [
            {"conditions": [_cond_from_state(uid) for uid in rule_uids]}
            for rule_uids in st.session_state.get("dom_edit_rules", [])
        ],
    }


def _would_be_items(built) -> list:
    """The full items list as it would be saved (edit replaces by id, add appends)."""
    items = settings.get_domains()["items"]
    if st.session_state.get("dom_editor_target"):
        return [built if it.get("id") == built["id"] else it for it in items]
    return items + [built]


# --------------------------------------------------------------------------- #
#  Preview data (loaded frame preferred; durable ledger as fallback)
# --------------------------------------------------------------------------- #
def _preview_data():
    """``(df, kind)`` to run match previews against, or ``(None, None)`` pre-scan."""
    df, _sig = _derived.display_view()
    if df is not None and not df.empty:
        return df, "frame"
    base = _derived.ledger_base_cached(_derived.display_scope())
    if base is not None and not base.empty:
        return base, "ledger"
    return None, None


def _assign_over_preview(df, kind, compiled):
    if kind == "frame":
        return domain_rules.assign_domains_frame(df, compiled)
    return domain_rules.assign_domains_ledger(df, compiled)


def _subscription_options() -> list:
    """Observed subscription names/ids (loaded frame + ledger) for the multiselect."""
    opts = set()
    df, _sig = _derived.display_view()
    if df is not None and not df.empty:
        for col in ("vulnerableAsset.subscriptionName",
                    "vulnerableAsset.subscriptionExternalId"):
            if col in df.columns:
                opts |= {str(v) for v in df[col].dropna().unique() if str(v).strip()}
    base = _derived.ledger_base_cached(_derived.display_scope())
    if base is not None and not base.empty:
        for col in ("subscription_name", "subscription_ext_id"):
            if col in base.columns:
                opts |= {str(v) for v in base[col].dropna().unique() if str(v).strip()}
    return sorted(opts)


# --------------------------------------------------------------------------- #
#  Section
# --------------------------------------------------------------------------- #
def render() -> None:
    ui.section_label("Domains")
    st.caption(
        "Triage findings to organizational domains by rule: match on resource tags, "
        "asset-name patterns or cloud subscriptions. Each finding lands in the **first** "
        "matching domain, top to bottom; the rest read Unassigned. Assignments update "
        "everywhere the moment rules change — nothing is rewritten in the scan history."
    )

    _rows()

    # Both dialogs open HERE, at render()'s app scope — a dialog invoked during a
    # fragment rerun won't render, so the row buttons inside _rows set their
    # open-flags and full-rerun to reach these invocations.
    if st.session_state.get("dom_editor_open"):
        _domain_editor()

    if st.session_state.get("dom_import_open"):
        _import_dialog()

    # Delete confirm uses the same open-flag pattern as the editor: the dialog is
    # re-invoked on every run while the target is set, so its own buttons stay live
    # across the rerun their click triggers.
    target = st.session_state.get("dom_delete_target")
    if target:
        items = settings.get_domains()["items"]
        item = next((it for it in items if it.get("id") == target), None)
        if item is None:
            st.session_state.pop("dom_delete_target", None)
        else:
            _confirm_delete(item)


@st.fragment
def _rows() -> None:
    """The domain list (reorder/edit/delete rows + Add) as one fragment: plain row
    interactions rerun only this region. Buttons whose outcome must escape the
    fragment full-rerun explicitly — reorder via ``_persist``'s app-scope rerun
    (assignments change on every page), and each dialog-opening button after setting
    its open-flag (a dialog invoked during a fragment rerun won't render, so
    ``render()`` opens it at app scope)."""
    toast = st.session_state.pop("_domains_toast", None)
    if toast:
        ui.show_toast(toast, "success")

    items = settings.get_domains()["items"]
    counts, total = _section_match_counts(items)

    for i, item in enumerate(items):
        _domain_row(items, i, item, counts, total)

    with st.container(horizontal=True):
        if st.button("Add domain", key="dom_add", icon=":material/add:"):
            _open_editor(None)
            st.rerun()
        st.download_button(
            "Export JSON",
            data=domains_export_json(items).encode("utf-8"),
            file_name="wiz_domains.json",
            mime="application/json",
            key="dom_export",
            icon=":material/download:",
            disabled=not items,
        )
        if st.button("Import JSON", key="dom_import", icon=":material/upload:"):
            st.session_state["dom_import_open"] = True
            st.rerun()


def _section_match_counts(items):
    """``({domain: matches}, total)`` over the preview data, honoring priority."""
    if not items:
        return {}, 0
    df, kind = _preview_data()
    if df is None:
        return None, 0  # None = "no data to preview against"
    if kind == "frame":
        dfd, _sig = _derived.domain_view(*_derived.display_view())
        series = dfd["domain"] if "domain" in dfd.columns else None
    else:
        _items, version = _derived.domains_config()
        base = _derived.ledger_base_domains_cached(_derived.display_scope(), version)
        series = base["domain"] if "domain" in base.columns else None
    if series is None:
        return None, 0
    return series.value_counts().to_dict(), len(series)


def _domain_row(items, i, item, counts, total) -> None:
    name = item.get("name", "")
    n_rules = len(item.get("rules") or [])
    with st.container(horizontal=True, vertical_alignment="center"):
        up = st.button(
            "", key=f"dom_up_{item['id']}", icon=":material/arrow_upward:",
            disabled=i == 0, help="Move up (higher priority)",
        )
        down = st.button(
            "", key=f"dom_dn_{item['id']}", icon=":material/arrow_downward:",
            disabled=i == len(items) - 1, help="Move down (lower priority)",
        )
        st.markdown(ui.domain_chip_html(name), unsafe_allow_html=True)
        if counts is None:
            detail = f"{n_rules} rule(s) · run a scan to preview matches"
        else:
            detail = f"{n_rules} rule(s) · matches {counts.get(name, 0):,} of {total:,} findings"
        st.caption(detail)
        edit = st.button("Edit", key=f"dom_edit_{item['id']}", icon=":material/edit:")
        delete = st.button("Delete", key=f"dom_del_{item['id']}", icon=":material/delete:")

    if up:
        items[i - 1], items[i] = items[i], items[i - 1]
        _persist(items, "Domain order updated")
    if down:
        items[i + 1], items[i] = items[i], items[i + 1]
        _persist(items, "Domain order updated")
    if edit:
        _open_editor(item)
        st.rerun()
    if delete:
        st.session_state["dom_delete_target"] = item["id"]
        st.rerun()


def _persist(items, toast) -> None:
    settings.set_domains(items)
    _derived.clear_domain_caches()
    st.session_state["_domains_toast"] = toast
    st.rerun()


# --------------------------------------------------------------------------- #
#  Add / Edit dialog
# --------------------------------------------------------------------------- #
@st.dialog("Domain", width="large")
def _domain_editor() -> None:
    st.text_input(
        "Name", key="dom_edit_name", placeholder="e.g. Payments",
        help="Shown as the finding's domain everywhere in the dashboard.",
    )

    rules = st.session_state.get("dom_edit_rules", [])
    sub_options = _subscription_options()
    for i, rule_uids in enumerate(rules):
        anchor = rule_uids[0] if rule_uids else i
        with st.container(border=True):
            head = st.columns([5, 1.6], vertical_alignment="center")
            head[0].caption(f"Rule {i + 1} — all conditions must match")
            if len(rules) > 1 and head[1].button(
                "Remove rule", key=f"dom_rm_rule_{anchor}", icon=":material/close:"
            ):
                st.session_state["dom_edit_rules"] = [
                    r for j, r in enumerate(rules) if j != i
                ]
                st.rerun()
            for uid in rule_uids:
                _condition_row(uid, removable=len(rule_uids) > 1,
                               sub_options=sub_options)
            if st.button("Add condition (AND)", key=f"dom_add_cond_{anchor}",
                         icon=":material/add:"):
                rule_uids.append(_seed_condition({}))
                st.rerun()
        if i < len(rules) - 1:
            st.caption("— or —")

    if st.button("Add rule (OR)", key="dom_add_rule", icon=":material/add:"):
        rules.append([_seed_condition({})])
        st.rerun()

    built = _built_item()
    would_be = _would_be_items(built)
    errors = domain_rules.validate_domains(would_be)
    for err in errors:
        st.warning(err, icon="⚠️")

    _editor_preview(built)

    c1, c2 = st.columns(2)
    if c1.button("Cancel", key="dom_editor_cancel", width="stretch"):
        _clear_editor_state()
        st.rerun()
    if c2.button("Save domain", type="primary", key="dom_editor_save",
                 width="stretch", disabled=bool(errors), icon=":material/save:"):
        _clear_editor_state()
        _persist(would_be, f"Domain “{built['name']}” saved")


def _condition_row(uid, removable, sub_options) -> None:
    cols = st.columns([2, 4.4, 0.7], vertical_alignment="bottom")
    label = cols[0].selectbox("Condition", list(_LABEL_TYPES), key=f"dom_c_{uid}_type")
    ctype = _LABEL_TYPES.get(label, "tag")
    with cols[1]:
        if ctype == "tag":
            kv = st.columns(2)
            kv[0].text_input("Tag key", key=f"dom_c_{uid}_key", placeholder="e.g. team")
            kv[1].text_input(
                "Value", key=f"dom_c_{uid}_val",
                placeholder="any value — leave blank for “key exists”",
            )
        elif ctype == "name_regex":
            pat = st.text_input(
                "Pattern", key=f"dom_c_{uid}_pat", placeholder=r"e.g. ^(web|api)-prod-",
                help="Case-insensitive, matches anywhere in the asset name.",
            )
            if pat:
                try:
                    re.compile(pat)
                except re.error as exc:
                    st.warning(f"Invalid pattern: {exc}", icon="⚠️")
        else:
            stored = st.session_state.get(f"dom_c_{uid}_subs", []) or []
            options = sorted(set(sub_options) | {str(v) for v in stored})
            st.multiselect(
                "Subscriptions", options, key=f"dom_c_{uid}_subs",
                accept_new_options=True, placeholder="Pick or type a subscription…",
                help="Matches the subscription name or external id (any of).",
            )
    if removable and cols[2].button(
        "", key=f"dom_c_{uid}_rm", icon=":material/close:", help="Remove condition"
    ):
        st.session_state["dom_edit_rules"] = [
            [u for u in rule if u != uid]
            for rule in st.session_state.get("dom_edit_rules", [])
        ]
        st.rerun()


def _editor_preview(built) -> None:
    """Live "matches N of M" for the in-progress domain (ignores other domains'
    priority, and says so)."""
    df, kind = _preview_data()
    if df is None:
        st.caption("Run a scan to preview which findings this domain would match.")
        return
    probe = dict(built, name=built["name"] or "…")
    compiled = domain_rules.compile_domains([probe])
    series = _assign_over_preview(df, kind, compiled)
    n = int((series != domain_rules.UNASSIGNED).sum())
    st.caption(
        f"Matches **{n:,}** of {len(series):,} loaded findings. Preview ignores domain "
        "priority — a higher domain may claim some of these."
    )


# --------------------------------------------------------------------------- #
#  Delete confirmation
# --------------------------------------------------------------------------- #
@st.dialog("Import domains")
def _import_dialog() -> None:
    st.write(
        "Load a domains JSON exported from this app or the GAS rebuild. "
        "Importing **replaces the entire current list**."
    )
    file = st.file_uploader("Domain rules JSON", type=["json"], key="dom_import_file")
    items, errors = [], []
    if file is not None:
        try:
            items, errors = parse_domains_import(file.getvalue().decode("utf-8"))
        except UnicodeDecodeError:
            errors = ["File is not UTF-8 text."]
        for err in errors:
            st.warning(err, icon="⚠️")
        if not errors:
            current = settings.get_domains()["items"]
            names = ", ".join(str(it["name"]) for it in items)
            st.write(
                f"Replaces the current {len(current)} domain(s) with "
                f"{len(items)} imported: **{names}**."
            )
    c1, c2 = st.columns(2)
    if c1.button("Cancel", key="dom_import_cancel", width="stretch"):
        st.session_state.pop("dom_import_open", None)
        st.rerun()
    if c2.button(
        "Replace domains", type="primary", key="dom_import_confirm",
        width="stretch", icon=":material/upload:",
        disabled=file is None or bool(errors),
    ):
        st.session_state.pop("dom_import_open", None)
        _persist(items, f"Imported {len(items)} domain(s)")


@st.dialog("Delete domain?")
def _confirm_delete(item) -> None:
    name = item.get("name", "")
    st.write(
        f"Findings currently in **{name}** will fall through to the next matching "
        "domain or read Unassigned. Its rules are not recoverable."
    )
    c1, c2 = st.columns(2)
    if c1.button("Cancel", key="dom_delete_cancel", width="stretch"):
        st.session_state.pop("dom_delete_target", None)
        st.rerun()
    if c2.button("Delete domain", type="primary", key="dom_delete_confirm",
                 width="stretch", icon=":material/delete:"):
        remaining = [
            it for it in settings.get_domains()["items"] if it.get("id") != item.get("id")
        ]
        st.session_state.pop("dom_delete_target", None)
        _persist(remaining, f"Domain “{name}” deleted")
