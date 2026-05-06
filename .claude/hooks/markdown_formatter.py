#!/usr/bin/env python3
"""Markdown formatter for Claude Code's PostToolUse hook.

Reads the hook payload from stdin, parses ``tool_input.file_path``, and
when the path ends in ``.md`` / ``.mdx`` rewrites the file in place to:

  * tag bare code fences with a heuristically-detected language
  * collapse runs of 3+ blank lines (only OUTSIDE fenced code blocks)
  * normalize trailing newlines to exactly one

The script is wired into ``.claude/settings.json`` under ``hooks.PostToolUse``
with the ``Edit|Write`` matcher; it expects ``$CLAUDE_PROJECT_DIR`` to be
set by Claude Code at invocation time, but does not read the variable
itself - the absolute ``file_path`` already comes through the JSON payload.
"""

import json
import re
import sys

# Pre-compile regexes once per interpreter start.
_FENCE_OPEN_RE = re.compile(r"^([ \t]{0,3})(```+|~~~+)([^\n]*)$")
_BLANK_RUN_RE = re.compile(r"\n{3,}")
_TRAILING_NL_RE = re.compile(r"(?:\r?\n)+\Z")

_PY_DEF_RE = re.compile(r"^\s*def\s+\w+\s*\(", re.M)
_PY_IMPORT_RE = re.compile(r"^\s*(import|from)\s+\w+", re.M)
_JS_FUNC_RE = re.compile(r"\b(function\s+\w+\s*\(|const\s+\w+\s*=)")
_JS_ARROW_RE = re.compile(r"=>|console\.(log|error)")
# Bash heuristic: require a shebang OR an unambiguous shell keyword
# (then/fi/do/done). Bare ``if``/``for``/``in`` is *not* enough since
# those keywords also appear in Python, JS, and Java.
_BASH_SHEBANG_RE = re.compile(r"^#!.*\b(bash|sh)\b", re.M)
_BASH_KEYWORD_RE = re.compile(r"\b(then|fi|do|done)\b")
_SQL_RE = re.compile(r"\b(SELECT|INSERT|UPDATE|DELETE|CREATE)\s+", re.I)
_JSON_START_RE = re.compile(r"^\s*[{\[]")


def detect_language(code: str) -> str:
    """Best-effort language detection from the body of an unlabeled fence."""
    s = code.strip()

    if _JSON_START_RE.match(s):
        try:
            json.loads(s)
            return "json"
        except (json.JSONDecodeError, ValueError):
            pass

    if _PY_DEF_RE.search(s) or _PY_IMPORT_RE.search(s):
        return "python"

    if _JS_FUNC_RE.search(s) or _JS_ARROW_RE.search(s):
        return "javascript"

    if _BASH_SHEBANG_RE.search(s) or _BASH_KEYWORD_RE.search(s):
        return "bash"

    if _SQL_RE.search(s):
        return "sql"

    return "text"


def _close_pattern(indent: str, marker: str) -> "re.Pattern[str]":
    """Build a closing-fence regex matching ``marker[0]`` repeated >= len(marker)."""
    return re.compile(
        rf"^{re.escape(indent)}{re.escape(marker[0])}{{{len(marker)},}}\s*$"
    )


def format_markdown(content: str) -> str:
    """Format markdown content, preserving code fence interiors verbatim.

    Walks the file line-by-line, tracking fence state. Inside a fence,
    every byte is preserved as-is (no language detection, no blank-line
    collapsing). Between fences (the "prose" stream), runs of 3+ blank
    lines collapse to 2.
    """
    lines = content.split("\n")
    out: list[str] = []
    prose_buf: list[str] = []

    def flush_prose() -> None:
        if not prose_buf:
            return
        chunk = _BLANK_RUN_RE.sub("\n\n", "\n".join(prose_buf))
        out.extend(chunk.split("\n"))
        prose_buf.clear()

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        m = _FENCE_OPEN_RE.match(line)
        if not m:
            prose_buf.append(line)
            i += 1
            continue

        indent, marker, info = m.group(1), m.group(2), m.group(3)
        close_re = _close_pattern(indent, marker)
        j = i + 1
        close_idx = -1
        while j < n:
            if close_re.match(lines[j]):
                close_idx = j
                break
            j += 1

        if close_idx == -1:
            # Unclosed fence: treat the rest of the file as prose to
            # avoid corrupting partial content.
            prose_buf.append(line)
            i += 1
            continue

        flush_prose()
        body_lines = lines[i + 1 : close_idx]
        if not info.strip():
            lang = detect_language("\n".join(body_lines))
            out.append(f"{indent}{marker}{lang}")
        else:
            out.append(line)
        out.extend(body_lines)
        out.append(lines[close_idx])
        i = close_idx + 1

    flush_prose()

    rebuilt = "\n".join(out)
    rebuilt = _TRAILING_NL_RE.sub("", rebuilt) + "\n"
    return rebuilt


def _run() -> int:
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"markdown_formatter: invalid stdin JSON: {e}", file=sys.stderr)
        return 1

    file_path = input_data.get("tool_input", {}).get("file_path", "")
    if not file_path.endswith((".md", ".mdx")):
        return 0

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        # File was removed/renamed between Edit and the hook running.
        # Treat as a no-op rather than surfacing a hook-error notification.
        return 0
    except OSError as e:
        print(f"markdown_formatter: cannot read {file_path}: {e}", file=sys.stderr)
        return 1

    formatted = format_markdown(content)

    if formatted != content:
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(formatted)
        except OSError as e:
            print(f"markdown_formatter: cannot write {file_path}: {e}", file=sys.stderr)
            return 1
        print(f"✓ Fixed markdown formatting in {file_path}")

    return 0


if __name__ == "__main__":
    sys.exit(_run())
