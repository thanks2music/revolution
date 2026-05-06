#!/usr/bin/env python3
"""Unit tests for markdown_formatter.

Run from the project root with:

    python3 -m unittest .claude/hooks/test_markdown_formatter.py

The script lives next to the hook so it is portable across worktrees and
does not require pytest. It uses only the stdlib.
"""

import importlib.util
import os
import sys
import textwrap
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SPEC = importlib.util.spec_from_file_location(
    "markdown_formatter", _HERE / "markdown_formatter.py"
)
assert _SPEC and _SPEC.loader
markdown_formatter = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(markdown_formatter)

format_markdown = markdown_formatter.format_markdown
detect_language = markdown_formatter.detect_language


class DetectLanguageTests(unittest.TestCase):
    def test_json_object(self):
        self.assertEqual(detect_language('{"a": 1}'), "json")

    def test_python_via_def(self):
        self.assertEqual(detect_language("def foo():\n    return 1"), "python")

    def test_python_via_import(self):
        self.assertEqual(detect_language("import os\nprint(os.getcwd())"), "python")

    def test_javascript_arrow(self):
        self.assertEqual(detect_language("const f = () => 1"), "javascript")

    def test_bash_with_shebang(self):
        self.assertEqual(detect_language("#!/usr/bin/env bash\necho hi"), "bash")

    def test_bash_keyword(self):
        self.assertEqual(detect_language("if true; then echo ok; fi"), "bash")

    def test_python_with_if_not_misdetected_as_bash(self):
        # `if`/`for`/`in` alone are NOT enough to tag bash anymore
        # (regression test for claude[bot] CB3).
        snippet = "if x > 0:\n    pass\nfor i in items:\n    pass"
        self.assertEqual(detect_language(snippet), "text")

    def test_sql(self):
        self.assertEqual(detect_language("SELECT * FROM users WHERE id = 1"), "sql")

    def test_unknown_falls_back_to_text(self):
        self.assertEqual(detect_language("Hello world"), "text")


class FormatMarkdownTests(unittest.TestCase):
    def test_blank_lines_inside_fence_are_preserved(self):
        # Regression test for Copilot CL2 / claude[bot] CB1.
        src = textwrap.dedent(
            """\
            # Title

            ```python
            def a():
                pass



            def b():
                pass
            ```

            After.
            """
        )
        out = format_markdown(src)
        # The triple-blank run inside the fence MUST survive.
        self.assertIn("    pass\n\n\n\ndef b()", out)

    def test_blank_lines_outside_fence_collapse(self):
        src = "para A\n\n\n\npara B\n"
        out = format_markdown(src)
        self.assertEqual(out, "para A\n\npara B\n")

    def test_bare_fence_gets_language_tag(self):
        src = "```\nconsole.log('hi')\n```\n"
        out = format_markdown(src)
        self.assertIn("```javascript\n", out)

    def test_already_labelled_fence_unchanged(self):
        # Regression test for claude[bot] CB9 scenario 3.
        src = "```rust\nfn main() {}\n```\n"
        out = format_markdown(src)
        self.assertIn("```rust\n", out)
        self.assertNotIn("```text\n", out)

    def test_no_op_when_already_clean(self):
        # Regression test for claude[bot] CB9 scenario 4.
        src = "```python\nprint('ok')\n```\n"
        self.assertEqual(format_markdown(src), src)

    def test_multiple_fences_each_get_tagged(self):
        src = "```\nconsole.log(1)\n```\n\n```\nprint(2)\n```\n"
        out = format_markdown(src)
        self.assertIn("```javascript\n", out)
        self.assertIn("```text\n", out)

    def test_unclosed_fence_does_not_corrupt(self):
        src = "intro\n\n```\nstray content with no closer\n"
        out = format_markdown(src)
        # The opener stays as-is; we don't crash and don't fabricate a closer.
        self.assertIn("```\n", out)
        self.assertIn("stray content", out)

    def test_trailing_newlines_normalize_to_one(self):
        # Multiple trailing newlines collapse, but trailing spaces on the
        # last line are NOT touched (Copilot CL3: rstrip would have eaten them).
        src = "Line\n\n\n"
        self.assertEqual(format_markdown(src), "Line\n")


if __name__ == "__main__":
    # Allow ``python3 .claude/hooks/test_markdown_formatter.py`` to work.
    unittest.main(verbosity=2)
