# Sphinx configuration for the qlservice user's guide.
#
# Built with the Homebrew sphinx-build (7.4.7) and myst-parser, which are the
# only two things this needs; the theme is Sphinx's own alabaster and the maths
# is rendered by MathJax, so `make html` works from a clean checkout without a
# virtualenv of its own.

project = "qlservice"
author = "ql-frontend"
copyright = "2026, ql-frontend"
release = "M8"

extensions = [
    "myst_parser",
    "sphinx.ext.mathjax",
]

myst_enable_extensions = [
    "dollarmath",   # $x$ and $$x$$, which is how the maths pages are written
    "deflist",
    "colon_fence",
]
myst_heading_anchors = 3

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

html_theme = "alabaster"
html_static_path = []
html_title = "qlservice user's guide"
html_theme_options = {
    "description": "Pricing options and swaps against a live QuantLib graph",
    "fixed_sidebar": True,
    "page_width": "1040px",
    "sidebar_width": "240px",
}

# Every page is Markdown; there is no reStructuredText in this tree.
source_suffix = {".md": "markdown"}
