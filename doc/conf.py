# Sphinx configuration for the qlservice user's guide.
#
# `npm run docs` builds it with doc/.venv if that exists and with whatever
# sphinx-build is on PATH otherwise; doc/requirements.txt is what the venv
# holds. The maths is rendered by MathJax, so nothing here needs a LaTeX
# installation.

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
# ".venv" matters: the docs virtualenv lives inside this source directory, and
# every Markdown file in site-packages is otherwise a page of this guide.
exclude_patterns = ["_build", ".venv", "Thumbs.db", ".DS_Store"]

# Read the Docs' theme, and alabaster when it is not installed — a guide that
# will not build is worse than one that builds in the wrong colours, and the
# fallback keeps `sphinx-build` from a bare system Python working.
try:
    import sphinx_rtd_theme  # noqa: F401

    html_theme = "sphinx_rtd_theme"
    html_theme_options = {
        "collapse_navigation": False,   # the maths pages are worth seeing at once
        "navigation_depth": 3,
        "sticky_navigation": True,
        "titles_only": False,
        "prev_next_buttons_location": "both",
        "style_external_links": True,
    }
except ImportError:
    html_theme = "alabaster"
    html_theme_options = {"description": "Pricing options and swaps against a live QuantLib graph", "fixed_sidebar": True, "page_width": "1040px"}

html_static_path = ["_static"]
html_css_files = ["custom.css"]
html_title = "qlservice user's guide"
html_short_title = "qlservice"

# Every page is Markdown; there is no reStructuredText in this tree.
source_suffix = {".md": "markdown"}
