"""``brick/README.md`` used to be one 2,070-line file: 62 internal ``#fragment`` links, all
valid, because everything they pointed at lived in the one file being read. Splitting it into a
91-line ``README.md`` plus seven files under ``docs/`` turned every one of those into a
cross-file link -- a bare path, a path with a fragment, or a fragment alone that now means "this
file" instead of "the file the reader has open". A broken markdown link is not an error anywhere
in that pipeline: GitHub and every other renderer just print it as ordinary text, so a typo in a
path or a slug that drifted when a heading was reworded produces no crash, no warning, nothing a
reviewer's eye catches in a diff of prose. It sits there until a reader clicks it and lands
nowhere. This module is the check that would have caught it at the time of the split, and catches
it at every change afterwards: every link target must resolve to a real file, and every fragment
must match a real heading in whatever file it targets, slugified the way GitHub does it.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

BRICK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BRICK_DIR.parent
DOCS_DIR = BRICK_DIR / "docs"

#: The whole split: the condensed front door plus every reader-specific page it routes to.
MARKDOWN_FILES = tuple(sorted([BRICK_DIR / "README.md", *DOCS_DIR.glob("*.md")]))

_LINK_RE = re.compile(r"\]\(([^)]+)\)")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE_RE = re.compile(r"^\s*```")


def _display(path: Path) -> str:
    """The path a failure message names, relative to the repo so it is pasteable."""
    return str(path.relative_to(REPO_ROOT))


def _visible_lines(path: Path):
    """Yield ``(line_no, line)`` for lines outside fenced code blocks.

    A ``` line toggles fence state and is itself skipped (it is fence syntax, not content). Both
    the link scanner and the heading scanner run over this, not the raw text: several docs fence
    shell/python snippets that contain their own ``#`` comments and even, in one, a leading ``#``
    line that reads exactly like an ATX heading (``docs/storage.md``'s CSV example) -- neither is
    a link nor a heading, and counting it as one would produce a slug nothing in prose ever meant.
    """
    in_fence = False
    for line_no, line in enumerate(path.read_text().splitlines(), start=1):
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        yield line_no, line


def _slugify(heading_text: str) -> str:
    """GitHub's rule: lowercase, drop anything that is not a word char/space/hyphen, then
    turn spaces into hyphens. Applied to the heading text as written -- inline code backticks,
    em dashes and punctuation all fall out in the strip step, exactly as they do on GitHub.
    """
    text = heading_text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)
    return text.replace(" ", "-")


@lru_cache(maxsize=None)
def _heading_slugs(path: Path) -> frozenset[str]:
    """Every heading in ``path``, slugified. Cached: several files are a link target more than
    once across the corpus, and a heading fence-scan is wasted work to repeat.
    """
    return frozenset(
        _slugify(match.group(2))
        for _, line in _visible_lines(path)
        if (match := _HEADING_RE.match(line))
    )


def _iter_links():
    """Yield ``(source_file, line_no, target)`` for every markdown link in the corpus, in
    reading order, skipping fenced code (a code sample containing ``](...)`` is not a link) and
    external/mail links (nothing under this repo to resolve them against).
    """
    for source in MARKDOWN_FILES:
        for line_no, line in _visible_lines(source):
            for match in _LINK_RE.finditer(line):
                target = match.group(1).strip()
                if target.startswith(("http://", "https://", "mailto:")):
                    continue
                yield source, line_no, target


def test_every_link_path_resolves():
    failures = []
    for source, line_no, target in _iter_links():
        path_part = target.split("#", 1)[0]
        if not path_part:
            continue  # a same-file fragment link, e.g. `](#maintenance)` -- no path to resolve
        target_path = source.parent / path_part
        if not target_path.exists():
            failures.append(
                f"{_display(source)}:{line_no}: link target {target!r} -- "
                f"{_display(source.parent)}/{path_part} does not exist "
                f"(resolved to {target_path})"
            )
    assert not failures, "broken link path(s):\n" + "\n".join(failures)


def test_every_link_fragment_resolves():
    failures = []
    for source, line_no, target in _iter_links():
        path_part, sep, fragment = target.partition("#")
        if not sep:
            continue  # no fragment on this link
        if path_part:
            target_file = source.parent / path_part
            if not target_file.exists():
                continue  # already reported by test_every_link_path_resolves
        else:
            target_file = source  # a same-file fragment link: "this file", not "target file"
        slugs = _heading_slugs(target_file)
        if fragment not in slugs:
            failures.append(
                f"{_display(source)}:{line_no}: link target {target!r} -- "
                f"fragment '#{fragment}' matches no heading in {_display(target_file)} "
                f"(known slugs: {sorted(slugs)})"
            )
    assert not failures, "broken link fragment(s):\n" + "\n".join(failures)


def test_every_doc_is_reachable_from_readme():
    """A new file dropped into ``docs/`` without a link from ``README.md``'s routing table is
    invisible to a reader who starts, as everyone does, at the README -- it exists but nothing
    points at it. This does not require the link to sit in the table specifically (the register
    of what a reader wants is also linked inline, earlier in the file); it requires only that
    README.md links to the file *somewhere*, which is what "reachable" means for a reader who
    has no other way in.
    """
    readme = BRICK_DIR / "README.md"
    linked_docs = set()
    for _, line in _visible_lines(readme):
        for match in _LINK_RE.finditer(line):
            target = match.group(1).strip()
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            path_part = target.split("#", 1)[0]
            if not path_part:
                continue
            resolved = (readme.parent / path_part).resolve()
            if resolved.parent == DOCS_DIR.resolve():
                linked_docs.add(resolved)

    doc_files = {p.resolve() for p in DOCS_DIR.glob("*.md")}
    orphans = doc_files - linked_docs
    assert not orphans, "doc(s) under brick/docs/ not linked from README.md: " + ", ".join(
        sorted(_display(p) for p in orphans)
    )
