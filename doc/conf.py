# Sphinx configuration for the qlservice user's guide.
#
# `npm run docs` builds it with doc/.venv if that exists and with whatever
# sphinx-build is on PATH otherwise; doc/requirements.txt is what the venv
# holds. The maths is rendered by MathJax, so nothing here needs a LaTeX
# installation.

project = "ql-frontend"
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

# Translations. gettext_compact=False keeps one catalogue per page, so
# coverage is per page rather than per directory and `sphinx-intl stat` says
# which page has fallen behind. Untranslated strings fall back to English,
# which is the property that makes a partial translation honest rather than
# broken.
locale_dirs = ["locale/"]
gettext_compact = False
gettext_uuid = True
language = "en"

templates_path = ["_templates"]
# ".venv" matters: the docs virtualenv lives inside this source directory, and
# every Markdown file in site-packages is otherwise a page of this guide.
# The repository's own documents live beside the guide but are not pages of it:
# the developer's map, the design record, the test page and the short interface
# guide. Excluded so Sphinx neither builds them as orphans nor extracts them into
# the translation catalogues.
exclude_patterns = ["_build", ".venv", "Thumbs.db", ".DS_Store", "DEVELOPING.md", "PLAN.md", "TESTING.md", "UI.md"]

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
html_title = "ql-frontend"
html_short_title = "ql-frontend"

# Every page is Markdown; there is no reStructuredText in this tree.
source_suffix = {".md": "markdown"}
