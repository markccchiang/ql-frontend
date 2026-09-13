#!/bin/sh
# Builds the guide in both languages out of one source tree:
#
#     doc/_build/html/          English
#     doc/_build/html/zh-tw/    Traditional Chinese (zh_TW)
#
# English stays at the root because that is where the app's `guide` button
# points, and because an untranslated string falls back to English anyway —
# the two builds are the same pages, not two documents.
set -e
SPHINX=doc/.venv/bin/sphinx-build
[ -x "$SPHINX" ] || SPHINX=sphinx-build

"$SPHINX" -b html doc doc/_build/html "$@"
"$SPHINX" -b html -D language=zh_TW -D html_title="ql-frontend 使用說明" \
    doc doc/_build/html/zh-tw "$@"
