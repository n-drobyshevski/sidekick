"""Generate the AI/BI dashboard file, and optionally push it to the workspace.

    python brick/dashboard_cli.py --catalog=<catalog> --schema=<schema> [--scope=os]

Writes ``wiz_<scope>_metrics.lvdash.json`` next to you by default. Import it with the Databricks
CLI, which is the documented and by far the better-trodden route::

    databricks workspace import --format AUTO \\
      --file wiz_os_metrics.lvdash.json "/Users/<you>/Wiz metrics.lvdash.json"

``--workspace-path`` will do the import over the REST API instead, using DATABRICKS_HOST and
DATABRICKS_TOKEN. It is offered for automation, but the CLI above is the recommended path --
this code has never run against a live workspace.

Deployment is deliberately its own entry point and never part of ``run_pipeline``: a scheduled
metrics job should not be redefining someone's dashboard behind their back.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

import dashboard
from run_pipeline import param, resolve_namespace, resolve_scope, resolve_tables

WORKSPACE_IMPORT_PATH = "/api/2.0/workspace/import"


def import_to_workspace(content: str, workspace_path: str, host: str, token: str,
                        overwrite: bool = True) -> None:
    """POST the document to the Workspace Import API.

    ``format=AUTO`` plus a path ending in ``.lvdash.json`` is what makes Databricks recognise
    the upload as an AI/BI dashboard rather than a plain file.
    """
    import requests

    if not workspace_path.endswith(".lvdash.json"):
        raise RuntimeError(
            f"workspace path must end in .lvdash.json, or it imports as a plain file: "
            f"{workspace_path}"
        )
    response = requests.post(
        host.rstrip("/") + WORKSPACE_IMPORT_PATH,
        headers={"Authorization": f"Bearer {token}"},
        json={
            "path": workspace_path,
            "format": "AUTO",
            "overwrite": overwrite,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        },
        timeout=60,
    )
    if response.status_code >= 400:
        # Same reasoning as ingest._post: the body names the offending widget, and the status
        # code on its own gives you nothing to fix.
        raise RuntimeError(
            f"Workspace import returned {response.status_code}\n{response.text[:2000]}"
        )


def main() -> None:
    namespace = resolve_namespace()
    scope = resolve_scope()
    tables = resolve_tables(namespace, scope)
    content = dashboard.to_json(tables, scope)

    workspace_path = param("workspace_path")
    if workspace_path:
        host, token = param("databricks_host"), param("databricks_token")
        if not (host and token):
            raise RuntimeError(
                "--workspace_path needs DATABRICKS_HOST and DATABRICKS_TOKEN (or "
                "--databricks_host= / --databricks_token=). Or skip it and use: "
                "databricks workspace import --format AUTO --file <file> <path>"
            )
        import_to_workspace(content, workspace_path, host, token)
        print(f"imported {workspace_path}")
        return

    out = Path(param("out") or f"wiz_{scope}_metrics.lvdash.json")
    out.write_text(content, encoding="utf-8")
    doc = dashboard.build(tables, scope)
    print(
        f"wrote {out} — {len(doc['pages'])} pages, {len(doc['datasets'])} datasets, "
        f"over {namespace}\n\n"
        f"Import it with:\n"
        # out.name, not out.stem: the stem of "x.lvdash.json" is "x.lvdash", and the doubled
        # suffix would import as a plain file instead of a dashboard.
        f'  databricks workspace import --format AUTO --file {out} '
        f'"/Users/<you>/{out.name}"'
    )


if __name__ == "__main__":
    sys.exit(main())
