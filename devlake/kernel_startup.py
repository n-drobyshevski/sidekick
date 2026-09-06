"""IPython startup shim -- installs the ``devlake`` ``dbutils``/``spark``/``display`` shims
before ANY notebook cell runs, not just the first one.

**Why this has to run at IPython *startup*, not from a notebook cell.** The shipped notebooks'
own cell 2 (the boot cell) reads ``dbutils.widgets.get("module_path")`` inside a ``try/except``,
but the very same cell also calls ``panels.context(spark, ...)`` with ``spark`` as a bare,
unguarded name -- so a shim installed from *inside* a notebook cell (a documented "run this
first" cell, or an input transformer that only rewrites ``%sql`` cells) is already too late:
cell 2 raises ``NameError`` before either mechanism would ever get to run. IPython's own startup
sequence is the one thing that completes before the kernel accepts its first
``execute_request``, so this is what has to carry it -- see ``devlake/notebook.py`` and
``devlake/README.md``, "Open the notebooks locally".

**How to wire it in.** Drop this file (or a symlink to it) into
``<IPYTHONDIR>/profile_default/startup/``, then point ``IPYTHONDIR`` at that directory (or its
parent -- see the IPython docs on ``IPYTHONDIR``) when launching Jupyter or an ``ipykernel``
kernel. Every ``.py`` file under a profile's ``startup/`` directory is exec'd, in name order,
once the ``InteractiveShell`` exists but before it processes any cell -- exactly the window this
needs.

A no-op (raises nothing, installs nothing) unless ``DEVLAKE_LAKE`` is set, so the same profile
works unchanged for an ordinary ``ipython``/``jupyter`` session that has nothing to do with this
lake -- it only ever fires when a caller has actually asked for one, the same guard
``load_ipython_extension`` itself starts with.

**``devlake`` has to be importable before it can do anything, and the kernel's cwd is not the
repo root.** This file is *copied* (or symlinked) out of the repo into
``<IPYTHONDIR>/profile_default/startup/``, so by the time it runs, its own ``__file__`` no longer
points at the repo -- there is nothing here to derive the repo root from. And the working
directory a real Jupyter deployment hands the kernel is the *notebook's* directory
(``brick/notebooks``, per the ``jupyter lab brick/notebooks`` recipe below), not the repo root --
measured: ``cd brick/notebooks && python3 -c "import devlake"`` raises ``ModuleNotFoundError``,
because neither Python's own ``-m`` cwd-on-``sys.path`` rule nor anything else puts the repo root
there. Left alone, that ``ModuleNotFoundError`` propagates out of this file, and IPython's own
``_run_startup_files`` swallows it into one unhelpful log line
(``"Unknown error in handling startup files:"``) with **no visible traceback at all** -- its
``showtraceback()`` calls run through ``sys.stderr`` *after* ipykernel has already redirected that
name to its own zmq-backed ``OutStream``, so the traceback is published on IOPub before any
client has subscribed (the classic PUB/SUB slow-joiner) and is never delivered anywhere: not the
terminal, not a captured pytest stream, nowhere. A shim that fails this quietly is worse than one
that fails loudly, so :func:`_install` does two things beyond the plain lookup a normal `import`
would do: it searches upward from the kernel's actual cwd for the directory that holds
``devlake/__init__.py`` (an explicit ``DEVLAKE_REPO_ROOT`` env var wins over the search, for a
layout the search cannot find), and it writes any failure straight to ``sys.__stderr__`` -- the
*original* stderr object, saved by the interpreter before ipykernel replaces ``sys.stderr``, so
the message reaches the kernel's real OS-level stream instead of a PUB socket nobody is
listening to yet.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _find_repo_root() -> "Path | None":
    """The directory holding ``devlake/__init__.py``, searched for rather than assumed.

    ``DEVLAKE_REPO_ROOT`` wins outright if set (an explicit override for a layout this search
    does not cover). Otherwise walk upward from the kernel's own working directory -- covers
    both documented deployments (a plain checkout, and the notebooks pasted flat into some other
    directory *inside* the repo) the same way each notebook's own boot cell walks upward from
    ``os.getcwd()`` looking for ``panels.py``. Returns ``None`` if nothing is found; the caller
    decides what to do about that.
    """
    override = os.environ.get("DEVLAKE_REPO_ROOT")
    if override and (Path(override) / "devlake" / "__init__.py").is_file():
        return Path(override)

    here = Path.cwd()
    for candidate in (here, *here.parents):
        if (candidate / "devlake" / "__init__.py").is_file():
            return candidate
    return None


def _install() -> None:
    if not os.environ.get("DEVLAKE_LAKE"):
        return

    try:
        repo_root = _find_repo_root()
        if repo_root is not None and str(repo_root) not in sys.path:
            sys.path.append(str(repo_root))

        from devlake import notebook as devlake_notebook

        ip = get_ipython()  # noqa: F821 -- only ever exec'd inside IPython's own startup sequence
        devlake_notebook.load_ipython_extension(ip)
    except Exception as exc:  # noqa: BLE001 -- see this module's docstring: must not go silent
        print(
            f"devlake.kernel_startup: shim install FAILED ({exc!r}) -- dbutils/spark/display/"
            f"%sql will be undefined in every cell. cwd={os.getcwd()!r}, "
            f"DEVLAKE_REPO_ROOT={os.environ.get('DEVLAKE_REPO_ROOT')!r}. See "
            "devlake/kernel_startup.py's own docstring.",
            file=sys.__stderr__,
        )
        raise


_install()
