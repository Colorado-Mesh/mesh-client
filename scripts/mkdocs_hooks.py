"""MkDocs hooks for the mesh-client docs site (wired via `hooks:` in mkdocs.yml).

Docs pages link to repository files outside `docs/` (e.g. `../package.json`,
`../.github/workflows/tests.yaml`) and to `docs/agents/`, which is excluded from
the site. Those links work on GitHub but not on the published site, so rewrite
them to GitHub URLs at build time instead of changing the source markdown.
"""

import posixpath
import re

REPO_BLOB_BASE = "https://github.com/Colorado-Mesh/mesh-client/blob/main/"

_LINK_RE = re.compile(r"(\]\()([^)\s]+)((?:\s+\"[^\"]*\")?\))")
_FENCE_RE = re.compile(r"^\s*(```|~~~)")
_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def _rewrite_target(target: str, page_dir: str) -> str:
    if target.startswith("#") or _SCHEME_RE.match(target):
        return target
    path, sep, anchor = target.partition("#")
    if not path:
        return target
    repo_path = posixpath.normpath(posixpath.join("docs", page_dir, path))
    if repo_path.startswith("docs/") and not repo_path.startswith("docs/agents/"):
        return target
    if repo_path == "docs/agents":
        repo_path = "docs/agents/README.md"
    return f"{REPO_BLOB_BASE}{repo_path}{sep}{anchor}"


def on_page_markdown(markdown, page, config, files):  # noqa: ARG001 - MkDocs hook signature
    page_dir = posixpath.dirname(page.file.src_uri)
    out = []
    in_fence = False
    for line in markdown.split("\n"):
        if _FENCE_RE.match(line):
            in_fence = not in_fence
        if not in_fence:
            line = _LINK_RE.sub(
                lambda m: f"{m.group(1)}{_rewrite_target(m.group(2), page_dir)}{m.group(3)}",
                line,
            )
        out.append(line)
    return "\n".join(out)
