"""Unit tests for the persisted severity-scope settings (data/settings.py)."""

import json

from wiz_dashboard import config
from wiz_dashboard.data import settings


def _settings_file():
    return config.DATA_DIR / settings.SETTINGS_FILENAME


class TestDefaults:
    def test_missing_file_yields_defaults(self):
        assert settings.get_fetch_severities() == config.DEFAULT_FETCH_SEVERITIES
        assert settings.get_display_severities() == config.DEFAULT_DISPLAY_SEVERITIES

    def test_corrupt_file_yields_defaults(self):
        _settings_file().parent.mkdir(parents=True, exist_ok=True)
        _settings_file().write_text("{not json", encoding="utf-8")
        assert settings.load_settings() == {}
        assert settings.get_fetch_severities() == config.DEFAULT_FETCH_SEVERITIES

    def test_non_dict_json_yields_defaults(self):
        _settings_file().parent.mkdir(parents=True, exist_ok=True)
        _settings_file().write_text('["CRITICAL"]', encoding="utf-8")
        assert settings.load_settings() == {}


class TestRoundTrip:
    def test_canonical_ordering(self):
        settings.set_fetch_severities(("HIGH", "CRITICAL", "MEDIUM"))
        assert settings.get_fetch_severities() == ("CRITICAL", "HIGH", "MEDIUM")

    def test_persists_to_disk(self):
        settings.set_fetch_severities(("CRITICAL",))
        on_disk = json.loads(_settings_file().read_text(encoding="utf-8"))
        assert on_disk["fetch_severities"] == ["CRITICAL"]

    def test_invalid_values_dropped(self):
        settings.set_fetch_severities(("CRITICAL", "BOGUS", 42, "UNKNOWN"))
        assert settings.get_fetch_severities() == ("CRITICAL",)

    def test_informational_normalizes_to_info(self):
        settings.set_fetch_severities(("INFORMATIONAL", "critical"))
        assert settings.get_fetch_severities() == ("CRITICAL", "INFO")

    def test_empty_selection_falls_back_to_default(self):
        settings.set_fetch_severities(())
        assert settings.get_fetch_severities() == config.DEFAULT_FETCH_SEVERITIES

    def test_other_keys_survive_a_save(self):
        settings.save_settings({"unrelated": 1})
        settings.set_fetch_severities(("CRITICAL",))
        assert settings.load_settings()["unrelated"] == 1


class TestDisplayClamp:
    def test_display_clamped_to_fetch_on_read(self):
        settings.save_settings(
            {"fetch_severities": ["CRITICAL"], "display_severities": ["CRITICAL", "HIGH"]}
        )
        assert settings.get_display_severities() == ("CRITICAL",)

    def test_narrowing_fetch_reclamps_stored_display(self):
        settings.set_fetch_severities(("CRITICAL", "HIGH", "MEDIUM"))
        settings.set_display_severities(("CRITICAL", "HIGH", "MEDIUM"))
        settings.set_fetch_severities(("CRITICAL",))
        on_disk = json.loads(_settings_file().read_text(encoding="utf-8"))
        assert on_disk["display_severities"] == ["CRITICAL"]

    def test_disjoint_display_falls_back_to_fetch(self):
        settings.save_settings(
            {"fetch_severities": ["CRITICAL"], "display_severities": ["LOW"]}
        )
        assert settings.get_display_severities() == ("CRITICAL",)

    def test_set_display_clamps_against_stored_fetch(self):
        settings.set_fetch_severities(("CRITICAL", "HIGH"))
        settings.set_display_severities(("HIGH", "LOW"))
        assert settings.get_display_severities() == ("HIGH",)


class TestDomains:
    def test_missing_config_reads_as_off(self):
        assert settings.get_domains() == {"version": 0, "items": []}
        assert settings.domains_version() == 0

    def test_set_bumps_version_monotonically(self):
        items = [{"id": "dom-1", "name": "Payments", "rules": []}]
        settings.set_domains(items)
        assert settings.domains_version() == 1
        settings.set_domains(items)
        assert settings.domains_version() == 2
        assert settings.get_domains()["items"] == items

    def test_order_is_preserved(self):
        items = [{"id": "dom-b", "name": "B", "rules": []},
                 {"id": "dom-a", "name": "A", "rules": []}]
        settings.set_domains(items)
        assert [i["name"] for i in settings.get_domains()["items"]] == ["B", "A"]

    def test_malformed_items_dropped_on_read_and_write(self):
        settings.set_domains([{"name": "Ok", "rules": []}, "junk", {"rules": []},
                              {"name": "  ", "rules": []}])
        assert [i["name"] for i in settings.get_domains()["items"]] == ["Ok"]
        _settings_file().write_text(
            json.dumps({"domains": {"version": "x", "items": {"not": "a list"}}}),
            encoding="utf-8",
        )
        assert settings.get_domains() == {"version": 0, "items": []}

    def test_other_keys_survive_a_domains_save(self):
        settings.set_fetch_severities(("CRITICAL",))
        settings.set_domains([{"id": "d", "name": "X", "rules": []}])
        assert settings.get_fetch_severities() == ("CRITICAL",)
        settings.set_fetch_severities(("CRITICAL", "HIGH"))
        assert settings.get_domains()["items"][0]["name"] == "X"


class TestApiFilter:
    def test_info_maps_to_informational(self):
        assert settings.api_severity_filter(("INFO",)) == ["INFORMATIONAL"]

    def test_scoped_filter_lists_api_values(self):
        assert settings.api_severity_filter(("CRITICAL", "HIGH")) == ["CRITICAL", "HIGH"]

    def test_full_scope_emits_no_filter(self):
        assert settings.api_severity_filter(config.SELECTABLE_SEVERITIES) is None
