"""Regenerate gas/src/server/sampleData.ts from the repo's example fixtures.

Run from the repo root: python gas/test/extract_samples.py
"""

import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
flat = json.loads((root / "os_vulns_response_exemple.json").read_text())
grouped = json.loads((root / "os_vulns_grouped_response_example.json").read_text())
out = f"""// Bundled sample payloads for dry-run mode (no Wiz credentials configured),
// generated from the repo's example fixtures by gas/test/extract_samples.py.

export const SAMPLE_FLAT = {json.dumps(flat)};

export const SAMPLE_GROUPED = {json.dumps(grouped)};
"""
(root / "gas/src/server/sampleData.ts").write_text(out)
print("wrote gas/src/server/sampleData.ts")
