"""Smoke test: the app loads and renders the default page without raising."""

from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parent.parent / "streamlit_app.py")


def test_app_loads_without_exception():
    at = AppTest.from_file(APP, default_timeout=30)
    at.run()
    assert not at.exception
