# `brick/fixtures/`

Three committed Wiz payloads, replayed by `brick/tests/` and by `devlake/run.py` so the pipeline
can be exercised without a network call or a live tenant.

## `sast_response.json` — live tenant capture

A captured SAST `sastFindings` response: 40 nodes, `totalCount` 11,406 (this is one page of a
much larger register), alongside a GraphQL `errors` entry on an otherwise-`200` response (a
`Resource not found` under `sastFindings.nodes.@.weaknesses.@`) — the tolerance this shape
requires is deliberate, not a bug in the capture.

## `sca_response.json` — live tenant capture, grouped

A captured SCA response from the **grouped** `vulnerabilityFindingsGroupedByValues` query: one
row per repository, carrying severity counts, not individual findings. It has **no per-finding
rows and cannot drive a pipeline** — it exists as evidence of the grouped shape and of the real
`vulnerableAsset` fields (`REPOSITORY_BRANCH`, its id, name, cloud platform) a code register
gets back.

## `sca_findings_example.json` — synthetic

54 findings shaped like what the **ungrouped** `vulnerabilityFindings` query returns, since no
ungrouped SCA capture exists. Synthesised over the repository branches, ids and cloud platforms
`sca_response.json` does contain; the findings themselves (CVEs, packages, timestamps, exploit
signals) are invented to cover all four confusion-matrix quadrants plus an unclassified row.
This is the fixture the whole Spark suite's `live_tables` session fixture runs on.

## Why `os_vulns_response_exemple.json` isn't here

It stays at the repo root: `wiz_dashboard/`, `gas/test/`, the root pytest suite and `devlake/`
all read it, and none of the other three are `brick/`-specific either.
