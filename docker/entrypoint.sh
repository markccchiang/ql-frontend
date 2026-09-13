#!/bin/bash
# The container's two processes: ql-backend on loopback, and nginx in front of
# it on 8080. When either one exits the other is stopped and the container
# exits with its status, so a restart policy sees one failure rather than half
# an application still answering.
#
# Arguments are passed on to ql-backend (`docker run ql-app --max-sessions 8`).
# QL_ALLOWED_ORIGINS lists the browser origins it accepts, space-separated; "*"
# accepts any, for a deployment whose own proxy already checks.
set -euo pipefail

read -r -a origins <<< "${QL_ALLOWED_ORIGINS:-}"
args=(--host 127.0.0.1 --port 9111)
for origin in "${origins[@]}"; do
    if [ "$origin" = "*" ]; then
        args+=(--any-origin)
    else
        args+=(--allow-origin "$origin")
    fi
done

/usr/local/bin/ql-backend "${args[@]}" "$@" &
backend=$!
nginx -c /etc/ql-frontend/nginx.conf -e stderr -g "daemon off;" &
proxy=$!

# A stop that was asked for (docker stop, Ctrl-C) is a clean exit, not the
# signal's 143; only a process that died on its own reports a failure.
stopping=0
trap 'stopping=1; kill -TERM "$backend" "$proxy" 2>/dev/null || true' TERM INT

set +e
wait -n "$backend" "$proxy"
status=$?
kill -TERM "$backend" "$proxy" 2>/dev/null
wait
[ "$stopping" = 1 ] && exit 0
exit "$status"
