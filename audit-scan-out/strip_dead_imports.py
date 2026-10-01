#!/usr/bin/env python3
"""
PCP-100 dead-import stripper.

Reads `audit-scan-out/dead_imports.txt` (path: comma,separated,symbols) and
removes those imports from the corresponding files. Uses regex on full
multi-line import blocks.

Handles:
  - single-line named imports:     `import { a, b as c, type d } from "x";`
  - multi-line named imports:      `import {\n  a,\n  b,\n} from "x";`
  - default imports:               `import pool from "x";`
  - namespace imports:             `import * as X from "x";`
  - `as` aliases:                  `import { a as b }`; drop `b`
  - `type` prefixes:               `import { type X }`

Drops whole statement if every specifier is dead. Otherwise rewrites the
brace span, removing the dead specifiers and tidying trailing commas.

Usage:
  python3 audit-scan-out/strip_dead_imports.py [--dry]
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(".").resolve()
DEAD_LIST = ROOT / "audit-scan-out" / "dead_imports.txt"


def parse_specifiers(brace_inner: str) -> list[tuple[str, str]]:
    """Parse `a, b as c, type d` into list of (raw_text, alias).

    `raw_text` is the original substring (preserves formatting/whitespace).
    `alias` is the local binding name.
    """
    if not brace_inner.strip():
        return []
    parts: list[str] = []
    depth = 0
    cur: list[str] = []
    for ch in brace_inner:
        if ch == "{":
            depth += 1
            cur.append(ch)
        elif ch == "}":
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if cur:
        parts.append("".join(cur))

    out: list[tuple[str, str]] = []
    for raw in parts:
        text = raw.strip()
        if not text:
            continue
        if text.startswith("type "):
            text = text[len("type "):].strip()
        if " as " in text:
            text = text.rsplit(" as ", 1)[1].strip()
        if re.match(r"^[A-Za-z_$][\w$]*$", text):
            out.append((raw, text))
    return out


def collect_block_aliases(block_text: str, nbrace: str | None) -> list[str]:
    """Pull every alias from an import block: named + default + namespace."""
    aliases: list[str] = []
    if nbrace is not None:
        for _, alias in parse_specifiers(nbrace):
            aliases.append(alias)
    # Default: `import X from "y"`
    dm = re.match(r"^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from", block_text)
    if dm:
        aliases.append(dm.group(1))
    # Namespace: `import * as X from "y"`
    nm = re.match(r"^[ \t]*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from", block_text)
    if nm:
        aliases.append(nm.group(1))
    return aliases


# Matches an import statement across lines.
# - Either default-only: `import X from "y";`
# - Or namespace:       `import * as X from "y";`
# - Or named:           `import { a, b } from "y";`  (single OR multi-line)
IMPORT_BLOCK = re.compile(
    r"""
    ^[ \t]* import [ \t]+
    (?:
        # Default or namespace import (no braces)
        (?P<default_or_ns>[A-Za-z_$][\w$]*|\*[ \t]+as[ \t]+[A-Za-z_$][\w$]*)
        [ \t]+ from [ \t]+ (?P<dquote>['"][^'"]+['"]) [ \t]* ;?
    |
        # Named import — single or multi-line
        \{ (?P<nbrace>[^}]*) \}
        [ \t]+ from [ \t]+ (?P<nquote>['"][^'"]+['"]) [ \t]* ;?
    )
    """,
    re.MULTILINE | re.VERBOSE | re.DOTALL,
)


def rewrite_block(
    block_text: str,
    nbrace: str | None,
    nquote: str | None,
    dead: set[str],
) -> str | None:
    """Return rewritten import text, or None to drop the block entirely."""
    if nbrace is not None:
        specs = parse_specifiers(nbrace)
        alive_specs = [(raw_s, alias) for raw_s, alias in specs if alias not in dead]
        if not alive_specs:
            return None
        new_inner = ", ".join(s[0].strip() for s in alive_specs)
        quote = nquote
        # Recover leading whitespace + `import ` prefix from block_text
        m = re.match(r"^(?P<ws>[ \t]*import[ \t]+)\{", block_text)
        if not m:
            return None
        return f"{m.group('ws')}{{ {new_inner} }} from {quote};"
    # default or namespace
    dm = re.match(r"^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from", block_text)
    if dm:
        name = dm.group(1)
        if name in dead:
            return None
        return block_text
    nm = re.match(r"^[ \t]*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from", block_text)
    if nm:
        name = nm.group(1)
        if name in dead:
            return None
        return block_text
    return block_text


def strip_file(path: Path, dead: set[str]) -> tuple[bool, str]:
    src = path.read_text(encoding="utf-8")
    out_parts: list[str] = []
    last = 0
    changed = False

    for m in IMPORT_BLOCK.finditer(src):
        block_text = m.group(0)
        nbrace = m.group("nbrace")
        nquote = m.group("nquote")

        aliases_here = collect_block_aliases(block_text, nbrace)
        local_dead = {a for a in aliases_here if a in dead}
        if not local_dead:
            continue

        rewritten = rewrite_block(block_text, nbrace, nquote, dead)

        # Determine end of statement (incl. trailing newline) and any
        # subsequent blank separator line that we'd want to consume.
        end = m.end()
        while end < len(src) and src[end] in " \t":
            end += 1
        had_eol = end < len(src) and src[end] == "\n"
        end_after_eol = end + 1 if had_eol else end

        if rewritten is None:
            # Drop whole statement. Also consume one trailing blank line
            # so we don't leave two consecutive blank lines between
            # surviving imports.
            consume_extra = end_after_eol < len(src) and src[end_after_eol] == "\n"
            drop_end = end_after_eol + 1 if consume_extra else end_after_eol
            out_parts.append(src[last : m.start()])
            last = drop_end
            changed = True
        else:
            # Replace the block range. Preserve trailing whitespace + newline.
            trailing_ws = src[m.end() : end]
            eol = "\n" if had_eol else ""
            out_parts.append(src[last : m.start()])
            out_parts.append(rewritten)
            out_parts.append(trailing_ws)
            out_parts.append(eol)
            last = end_after_eol
            changed = True

    out_parts.append(src[last:])
    return changed, "".join(out_parts)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="Don't write; just report")
    args = ap.parse_args()

    files_modified = 0
    syms_removed = 0

    for line in DEAD_LIST.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rel, _, rest = line.partition(":")
        dead = {s.strip() for s in rest.split(",") if s.strip()}
        path = Path(rel.strip())
        if not path.exists():
            print(f"  MISS {rel}")
            continue
        changed, new_src = strip_file(path, dead)
        if changed:
            syms_removed += len(dead)
            files_modified += 1
            if args.dry:
                print(f"  would modify {rel}  ({', '.join(sorted(dead))})")
            else:
                path.write_text(new_src, encoding="utf-8")
                print(f"  modified   {rel}  ({', '.join(sorted(dead))})")

    print(f"\nFiles modified: {files_modified}")
    print(f"Symbols removed: {syms_removed}")


if __name__ == "__main__":
    main()