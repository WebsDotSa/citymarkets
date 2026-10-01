#!/usr/bin/env python3
"""
PCP-76 dead-imports scanner.

Parses every route.ts under src/app/api/, drops import lines from the body,
then regex-searches for each imported alias. A symbol is dead if zero matches.

Outputs:
  audit-scan-out/all_routes.txt           — every route path
  audit-scan-out/dead_imports.txt         — dead-symbols-per-file (text)
  audit-scan-out/dead_imports_grouped.md  — same, grouped markdown report
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Iterable

ROOT = Path("src/app/api").resolve()
OUT_DIR = Path("audit-scan-out")

IMPORT_LINE = re.compile(r'^\s*import\s+(?:type\s+)?(?:[\s\S]+?)\s*from\s+[\'"][^\'"]+[\'"]\s*;?\s*$', re.M)
NAMED_IMPORT = re.compile(r'\{([^}]+)\}')
DEFAULT_IMPORT = re.compile(r'import\s+([A-Za-z_$][\w$]*)\s+from')
NAMESPACE_IMPORT = re.compile(r'import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from')

ALIAS_TOKEN = re.compile(r'(?<![\w$.])([A-Za-z_$][\w$]*)\b')


def collect_routes() -> list[Path]:
    return sorted(p for p in ROOT.rglob("route.ts"))


def strip_imports(src: str) -> str:
    def _drop(m: re.Match[str]) -> str:
        return ""
    return IMPORT_LINE.sub(_drop, src)


def parse_imports(src: str) -> list[str]:
    """Return list of imported aliases (named, default, namespace)."""
    aliases: list[str] = []
    for m in IMPORT_LINE.finditer(src):
        line = m.group(0)
        # default: `import X from "y"`
        dm = DEFAULT_IMPORT.search(line)
        if dm:
            aliases.append(dm.group(1))
        # namespace: `import * as X from "y"`
        nm = NAMESPACE_IMPORT.search(line)
        if nm:
            aliases.append(nm.group(1))
        # named: `{ a, b as c, type d }`
        for nm in NAMED_IMPORT.finditer(line):
            inner = nm.group(1)
            for part in inner.split(","):
                part = part.strip()
                if not part or part.startswith("type "):
                    part = part.removeprefix("type ").strip()
                if " as " in part:
                    part = part.split(" as ", 1)[1].strip()
                if part and re.match(r'^[A-Za-z_$][\w$]*$', part):
                    aliases.append(part)
    # dedupe preserving order
    seen, out = set(), []
    for a in aliases:
        if a not in seen:
            seen.add(a)
            out.append(a)
    return out


def is_used(alias: str, body: str) -> bool:
    """Symbol must appear as a whole word outside of import lines."""
    pat = re.compile(r'(?<![\w$.])' + re.escape(alias) + r'(?![\w$])')
    return bool(pat.search(body))


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    routes = collect_routes()
    (OUT_DIR / "all_routes.txt").write_text(
        "\n".join(str(p) for p in routes) + "\n", encoding="utf-8"
    )
    print(f"Routes: {len(routes)}")

    per_file_text: list[str] = []
    grouped_md: list[str] = ["# Dead imports by file", ""]
    total_files = 0
    total_dead = 0

    for p in routes:
        src = p.read_text(encoding="utf-8")
        aliases = parse_imports(src)
        body = strip_imports(src)
        dead = [a for a in aliases if not is_used(a, body)]
        if dead:
            total_files += 1
            total_dead += len(dead)
            rel = str(p)
            per_file_text.append(f"{rel}: {', '.join(dead)}")
            grouped_md.append(f"## `{rel}`")
            grouped_md.append("")
            for d in dead:
                grouped_md.append(f"- `{d}`")
            grouped_md.append("")

    (OUT_DIR / "dead_imports.txt").write_text("\n".join(per_file_text) + "\n", encoding="utf-8")
    (OUT_DIR / "dead_imports_grouped.md").write_text("\n".join(grouped_md), encoding="utf-8")
    print(f"Files with dead imports: {total_files}")
    print(f"Total dead symbols: {total_dead}")


if __name__ == "__main__":
    main()