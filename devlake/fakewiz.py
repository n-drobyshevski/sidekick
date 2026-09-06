"""A fake Wiz GraphQL transport that validates the filter SHAPE, not just the population.

The seam is ``ingest._post`` (``brick/ingest.py``, ``brick/devsecops/ingest.py``): both forks'
``fetch_findings`` call it once per page and read the connection's ``nodes`` / ``pageInfo``
straight out of the returned payload, with no error handling of its own -- a caller that got
back an error-shaped body would read ``connection.get("nodes") or []`` and silently yield
nothing. That is precisely the failure this package exists to make loud: ``FakeWiz`` reproduces
the one thing a real tenant would refuse on -- a filter value in the wrong shape for its scope's
filter type -- by raising the same ``RuntimeError`` ``_post`` itself raises on an HTTP 4xx,
formatted through the fork's own ``describe_errors`` so the message a test sees is the message a
real 400 would have produced.

``install`` patches ``ingest._post`` and ``ingest.get_token`` so ``fetch_findings`` runs
completely unmodified above the seam: real ``build_filter``, real cursor walk, real
``source.connection`` lookup, real ``_severity_gate`` (devsecops). Everything below the seam is
this module.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence

#: A scope this fake has never seen isn't a filter-shape bug -- it is a caller asking for a
#: connection that does not exist, and a fake that quietly serves an empty page for it is
#: exactly the "false zero" CLAUDE.md warns about elsewhere in this repo. Refused at
#: construction, not at the first ``post()``, so the mistake surfaces before any Spark work runs.
_UNKNOWN_SCOPE = (
    "FakeWiz: unknown scope {scope!r} for fork {fork!r} -- expected one of {expected}"
)

#: ``brick`` has exactly one connection and no ``config.OBJECT_FILTERS`` at all (see
#: ``ingest.build_filter``'s own docstring: "one filter type, one convention, nothing to
#: disagree with"). This is the table a schema *would* hold if brick ever grew a second
#: connection -- ``projectIdV2`` is the one wrapped key ``VulnerabilityFindingFilters`` has.
_BRICK_OBJECT_FILTERS_FALLBACK = {
    "os": ("projectIdV2",),
    "all": ("projectIdV2",),
}


class FakeWiz:
    """A fake GraphQL server for one ``(fork, scope)``, backed by an in-memory node list.

    ``pages`` -- an explicit list of node-lists, one per page, when the caller wants control
    over exactly how the walk is paginated -- or ``nodes`` (+ ``page_size``), sliced into pages
    here. Passing both is refused; passing neither serves one empty page, which is what a
    genuinely empty register looks like and lets a test build a ``FakeWiz`` before it has any
    fixture data in hand.

    ``calls`` records every ``post()`` invocation (``api_url``, the GraphQL ``variables``, and
    the ``query`` document) in order, so a test can assert on what the pipeline actually sent --
    including the filter-shape mutation tests, which read ``variables["filterBy"]`` back out.
    """

    def __init__(
        self,
        scope: str,
        fork_ingest_module: Any,
        *,
        nodes: Optional[Sequence[Dict[str, Any]]] = None,
        pages: Optional[Sequence[Sequence[Dict[str, Any]]]] = None,
        page_size: int = 500,
    ) -> None:
        if pages is not None and nodes is not None:
            raise RuntimeError("FakeWiz: pass either nodes= or pages=, not both")

        self.scope = scope
        self.fork_ingest_module = fork_ingest_module
        self.calls: List[Dict[str, Any]] = []

        scopes = getattr(fork_ingest_module, "SCOPES", None)
        fork_name = getattr(fork_ingest_module, "__name__", "<fork>")
        if scopes is not None and scope not in scopes:
            raise RuntimeError(
                _UNKNOWN_SCOPE.format(scope=scope, fork=fork_name, expected=sorted(scopes))
            )
        self.connection = self._resolve_connection(scope, fork_ingest_module)

        if pages is not None:
            self.pages: List[List[Dict[str, Any]]] = [list(page) for page in pages] or [[]]
        else:
            node_list = list(nodes or [])
            self.pages = [
                node_list[i : i + page_size] for i in range(0, len(node_list), page_size)
            ] or [[]]

    @staticmethod
    def _resolve_connection(scope: str, fork_ingest_module: Any) -> str:
        """The GraphQL field this scope answers under.

        ``devsecops``'s ``ingest`` re-exports ``config.SOURCES`` by name (``from config import
        ... SOURCES``), so ``SOURCES[scope].connection`` names it directly -- ``sca`` and
        ``os``/``all`` (brick has no ``SOURCES`` at all) read ``vulnerabilityFindings``, ``sast``
        reads ``sastFindings``. Brick's single connection is the fallback for the fork that has
        no such table.
        """
        sources = getattr(fork_ingest_module, "SOURCES", None)
        if sources is None:
            return "vulnerabilityFindings"
        source = sources.get(scope)
        if source is None:
            raise RuntimeError(
                _UNKNOWN_SCOPE.format(
                    scope=scope,
                    fork=getattr(fork_ingest_module, "__name__", "<fork>"),
                    expected=sorted(sources),
                )
            )
        return source.connection

    def _object_filters(self) -> Dict[str, Sequence[str]]:
        """Which filter keys this scope's filter type wants wrapped as ``{"equals": [...]}``.

        ``getattr`` rather than ``import config``: devsecops's ``ingest`` module imports
        ``OBJECT_FILTERS`` by name (``from config import ... OBJECT_FILTERS``), so it is already
        an attribute of the *loaded* ingest module -- exactly the one ``devlake.session`` put on
        ``sys.path``, with no risk of reading the other fork's ``config`` if both happened to be
        importable. Brick's ``ingest`` imports no such name, so this falls back to the table
        brick *would* hold (see the fallback's own comment).
        """
        return getattr(self.fork_ingest_module, "OBJECT_FILTERS", None) or _BRICK_OBJECT_FILTERS_FALLBACK

    def _assert_shape(self, api_url: str, filter_by: Dict[str, Any]) -> None:
        """Refuse a ``filterBy`` shaped for the wrong filter type -- the same way the live API
        would, and through the same code path a real 400 uses.

        Two directions, both real bugs this repo has shipped (CLAUDE.md, "the same field name
        carries DIFFERENT KINDS across filter types"):

        * a key the table says must be ``{"equals": [...]}`` arrives as a bare list (SAST's
          ``severity`` sent SCA's way -- the bug that cost the whole SAST population once);
        * a key the table does NOT mention arrives wrapped as ``{"equals": [...]}`` anyway (the
          sibling mistake: over-applying the object convention to a key that must stay a bare
          list).

        Anything else -- a scalar, a differently-shaped nested filter such as
        ``{"notEquals": [...]}`` or ``{"isDefaultBranch": {"equals": True}}`` -- is untouched by
        either check: those were never part of the list-vs-object convention in the first place
        (``ingest._shape_base``'s own docstring: "a nested filter object is not a list needing a
        convention"), so flagging them would be a false positive on filters that are correct.
        """
        wanted = set(self._object_filters().get(self.scope, ()))
        for key, value in (filter_by or {}).items():
            is_object_shape = (
                isinstance(value, dict) and set(value.keys()) == {"equals"} and isinstance(value["equals"], list)
            )
            if key in wanted and not is_object_shape:
                self._refuse(api_url, key, value, expected="an object ({'equals': [...]})")
            if key not in wanted and is_object_shape:
                self._refuse(api_url, key, value, expected="a bare list")

    def _refuse(self, api_url: str, key: str, value: Any, *, expected: str) -> None:
        """Raise exactly what ``ingest._post`` raises on an HTTP 4xx, built from a GraphQL-400
        body shaped the way the live API answers a filter-type mismatch -- so a test catching
        this is catching the same failure a live 400 would cause, not a fake's own invention."""
        body = json.dumps(
            {
                "errors": [
                    {
                        "message": (
                            f"Variable '$filterBy' got invalid value at 'filterBy.{key}'; "
                            f"expected {expected}, got {type(value).__name__} {value!r}"
                        ),
                        "extensions": {"code": "VALIDATION_INVALID_TYPE_VARIABLE"},
                    }
                ]
            }
        )
        describe_errors = self.fork_ingest_module.describe_errors
        raise RuntimeError(f"Wiz API returned 400 for {api_url}\n{describe_errors(body)}")

    def _page_for(self, cursor: Optional[str]) -> int:
        """The page index a cursor names. ``None`` (the first request) is page 0; every other
        cursor is one this same fake minted in :meth:`post`, so a caller passing anything else
        back is a bug in the caller, not a real Wiz cursor to accommodate."""
        if cursor is None:
            return 0
        prefix = "devlake-fakewiz-page-"
        if not cursor.startswith(prefix):
            raise RuntimeError(f"FakeWiz: unrecognised cursor {cursor!r}")
        return int(cursor[len(prefix) :])

    def post(
        self,
        api_url: str,
        token: str,
        variables: Dict[str, Any],
        timeout: int,
        session: Any = None,
        query: Optional[str] = None,
    ) -> Dict[str, Any]:
        """The ``ingest._post`` replacement. Same positional shape both forks call it with --
        devsecops additionally passes ``query=`` (brick never does, and never needs to: it has
        one document, module-global, and does not thread it through ``_post`` at all)."""
        self.calls.append(
            {"api_url": api_url, "variables": variables, "query": query, "token": token}
        )
        filter_by = (variables or {}).get("filterBy") or {}
        self._assert_shape(api_url, filter_by)

        page_index = self._page_for((variables or {}).get("after"))
        nodes = self.pages[page_index] if page_index < len(self.pages) else []
        has_next = page_index + 1 < len(self.pages)
        end_cursor = f"devlake-fakewiz-page-{page_index + 1}" if has_next else None

        return {
            "data": {
                self.connection: {
                    "nodes": nodes,
                    "pageInfo": {"hasNextPage": has_next, "endCursor": end_cursor},
                }
            }
        }


def install(
    monkeypatch_or_stack: Any,
    ingest_module: Any,
    fake: FakeWiz,
    *,
    run_pipeline_module: Optional[Any] = None,
) -> None:
    """Patch ``ingest._post`` and ``ingest.get_token`` to route through ``fake``.

    ``monkeypatch_or_stack`` is duck-typed to accept either of the two things a caller has on
    hand:

    * pytest's ``monkeypatch`` fixture, which exposes ``.setattr(target, name, value)`` and
      restores everything itself at teardown -- what every test in this package uses;
    * a plain ``contextlib.ExitStack``, for ``devlake.run``'s CLI, which is not a pytest test
      and has no fixture to ask for. ``mock.patch.object`` entered on the stack does the same
      job and un-patches when the ``with`` block exits.

    ``get_token`` returns a fixed ``"fake-token"`` string -- there is no OAuth exchange to fake
    more faithfully than that, and nothing downstream reads the token's value, only its
    presence (``ingest.secret`` still has to resolve real-looking credentials first, which is
    why ``devlake.run.scan`` sets ``WIZ_CLIENT_ID``/``WIZ_CLIENT_SECRET`` before calling
    ``main()`` -- a blank credential raises before ``get_token`` is ever reached).

    **``run_pipeline_module`` is not optional in practice, and this is the surprise Step 3
    turned up.** Both forks' ``run_pipeline.py`` import ``get_token`` with ``from ingest import
    ... get_token`` -- a *name binding*, copied into ``run_pipeline``'s own module namespace at
    import time. Patching ``ingest.get_token`` afterwards changes ``ingest``'s attribute, not
    the reference ``run_pipeline.ingest_to_bronze`` already holds, so ``main()`` would still
    call the real ``get_token`` and attempt a live OAuth exchange against
    ``https://fake.invalid/graphql`` -- unless ``run_pipeline_module.get_token`` is patched too.
    ``ingest._post`` needs no such second patch: ``fetch_findings`` is defined *inside*
    ``ingest.py`` and calls ``_post(...)`` as a bare name resolved through its own module's
    globals at call time, which the patch on ``ingest`` module reaches fine.
    """
    if hasattr(monkeypatch_or_stack, "setattr"):
        set_attr = monkeypatch_or_stack.setattr
    else:
        from unittest import mock

        stack = monkeypatch_or_stack

        def set_attr(target: Any, name: str, value: Any) -> None:
            stack.enter_context(mock.patch.object(target, name, value))

    fake_token = lambda *args, **kwargs: "fake-token"  # noqa: E731
    set_attr(ingest_module, "_post", fake.post)
    set_attr(ingest_module, "get_token", fake_token)
    if run_pipeline_module is not None:
        set_attr(run_pipeline_module, "get_token", fake_token)
