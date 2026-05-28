# Wiz Security Dashboard

A Streamlit dashboard for [Wiz](https://www.wiz.io/) vulnerability findings: OS-level
CVEs on host workloads, severity breakdowns, and MTTR / SLA remediation analytics.

## Quickstart

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (use: source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
streamlit run app.py
```

The app opens at <http://localhost:8501>. Without credentials it runs in **dry-run**
mode with bundled sample data, so you can explore it immediately.

### Live data

Provide Wiz service-account credentials in `wiz_config.json` at the repo root
(git-ignored — never commit it):

```json
{ "wiz_client_id": "…", "wiz_client_secret": "…" }
```

You also need the [Wiz Python SDK](https://docs.wiz.io/docs/python-sdk) installed
(`wiz_sdk`). The sidebar shows whether credentials were loaded.

## Project structure

```
app.py                      # entry point — st.navigation / st.Page
os_vulns.py                 # Wiz GraphQL query + fetch_findings() + CLI
wiz_dashboard/
  config.py                 # severity taxonomy, SLA targets, cache settings
  data/   client.py         # cached fetch (st.cache_data) + disk snapshot
          cache.py          # last_results.json "last known good" snapshot
          transform.py      # coerce / extract nodes / DataFrame
  domain/ severity.py        metrics.py (MTTR/SLA)   formatting.py
  models/ schema.py          # pydantic models (handles flat AND grouped responses)
  ui/     components.py       sanitize.py   theme.py
          pages/             # os_vulns, cloud, identity, reports, exports
  assets/ styles.css         # custom widget CSS (loaded once via load_css)
.streamlit/config.toml      # native [theme] (accent/fonts; follows system light/dark)
tests/                      # pytest unit tests + AppTest smoke/scan
```

## Response shapes

The Wiz API can return either **flat per-finding** records (with `severity` +
timestamps, used for MTTR/SLA) or **grouped-by-asset** nodes (per-asset analytics
counts). The OS page detects which shape arrived and renders accordingly; the schema
layer tolerates missing/extra fields without raising.

## CLI

`os_vulns.py` also works standalone:

```bash
python os_vulns.py --dry-run --format json     # sample data
python os_vulns.py --format table              # live (needs credentials + wiz_sdk)
```

## Testing

```bash
pytest
```

Pure-logic units run without a browser; app-level checks use Streamlit's `AppTest`.
