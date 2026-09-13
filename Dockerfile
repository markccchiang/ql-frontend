# syntax=docker/dockerfile:1
#
# ql-backend and ql-frontend in one image, on Debian 13 (trixie).
#
# From this directory:
#
#     docker build -t ql-app .
#     docker run --rm -p 127.0.0.1:8080:8080 ql-app
#
# The build clones ql-backend from GitHub at QL_BACKEND_REF (main by default),
# submodules and all, so it needs neither a checkout of it nor credentials.
#
# To build a local ql-backend checkout instead, unpushed changes included (its
# submodules initialised with `git submodule update --init --recursive`):
#
#     docker build --build-context ql-backend=/path/to/ql-backend -t ql-app .
#
# and open http://localhost:8080. nginx serves the app and the user's guide on
# 8080 and passes /ws/ through to ql-backend, which stays on loopback inside the
# container: the arrangement its own refusal message asks for, rather than a
# pricing engine with no authentication listening on a routable address.
#
# The stages, in the order the build cache is most likely to keep them:
#
#     protobuf   Protobuf with its CMake package config, which Debian's does not ship
#     quantlib   QuantLib built with QL_ENABLE_SESSIONS and without OpenMP (INSTALL.md)
#     backend    the ql-backend daemon, linked statically against both
#     frontend   the Vite bundle
#     guide      the Sphinx user's guide, English and Traditional Chinese
#     (final)    nginx, tini and the two artefacts

ARG DEBIAN_RELEASE=trixie
ARG QL_BACKEND_REPO=https://github.com/markccchiang/ql-backend.git
ARG QL_BACKEND_REF=main

# ql-backend's source: a clone, with uWebSockets and ql-protobuf (proto/) as
# its submodules. --build-context ql-backend=... replaces this stage outright.
FROM scratch AS ql-backend
ARG QL_BACKEND_REPO
ARG QL_BACKEND_REF
ADD ${QL_BACKEND_REPO}#${QL_BACKEND_REF} /

# ---------------------------------------------------------------------------
FROM debian:${DEBIAN_RELEASE}-slim AS toolchain
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build git ca-certificates libboost-dev \
 && rm -rf /var/lib/apt/lists/*
# Empty means one job per CPU. A QuantLib translation unit can take a gigabyte
# to compile, so a Docker VM short of memory wants a smaller number here.
ARG BUILD_JOBS=

# ---------------------------------------------------------------------------
FROM toolchain AS protobuf
# The release ql-backend is developed against. The generated code and the
# library it links have to come from the same one, and both come from here.
ARG PROTOBUF_VERSION=34.0
ADD https://github.com/protocolbuffers/protobuf.git#v${PROTOBUF_VERSION} /src/protobuf
# Abseil is fetched at the version this release pins and installed beside it,
# where find_package(Protobuf CONFIG) looks for it. C++17 to match ql-backend:
# abseil's string_view is a different type under a different standard.
RUN cmake -S /src/protobuf -B /build/protobuf -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/protobuf \
        -DCMAKE_CXX_STANDARD=17 \
        -Dprotobuf_BUILD_TESTS=OFF \
        -Dprotobuf_FORCE_FETCH_DEPENDENCIES=ON \
 && cmake --build /build/protobuf --parallel ${BUILD_JOBS:-$(nproc)} \
 && cmake --install /build/protobuf \
 && rm -rf /build/protobuf

# ---------------------------------------------------------------------------
FROM toolchain AS quantlib
# ql-backend's third_party/QuantLib pin.
ARG QUANTLIB_VERSION=1.43
ADD https://github.com/lballabio/QuantLib.git#v${QUANTLIB_VERSION} /src/QuantLib
# Sessions on and OpenMP off are the two settings ql-backend cannot be correct
# without (INSTALL.md, "Why sessions matter"). Static, so the daemon carries
# its QuantLib rather than depending on a library the final image would need.
RUN cmake -S /src/QuantLib -B /build/QuantLib -G Ninja -Wno-dev \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/quantlib \
        -DBUILD_SHARED_LIBS=OFF \
        -DQL_ENABLE_SESSIONS=ON \
        -DQL_ENABLE_OPENMP=OFF \
        -DQL_BUILD_EXAMPLES=OFF \
        -DQL_BUILD_TEST_SUITE=OFF \
        -DQL_BUILD_BENCHMARK=OFF \
 && cmake --build /build/QuantLib --parallel ${BUILD_JOBS:-$(nproc)} \
 && cmake --install /build/QuantLib \
 && rm -rf /build/QuantLib

# ---------------------------------------------------------------------------
FROM toolchain AS backend
COPY --from=protobuf /opt/protobuf /opt/protobuf
COPY --from=quantlib /opt/quantlib /opt/quantlib
# What the build reads, and nothing else: not a local build tree, not the docs.
COPY --from=ql-backend CMakeLists.txt /src/ql-backend/CMakeLists.txt
COPY --from=ql-backend src /src/ql-backend/src
COPY --from=ql-backend proto /src/ql-backend/proto
COPY --from=ql-backend third_party/uWebSockets /src/ql-backend/third_party/uWebSockets
# An empty uWebSockets configures cleanly and only skips the daemon (INSTALL.md),
# so it is caught here with the command that fixes it.
RUN test -f /src/ql-backend/third_party/uWebSockets/uSockets/src/libusockets.h \
 || { echo "ql-backend/third_party/uWebSockets is empty: run git submodule update --init --recursive there" >&2; exit 1; }
RUN cmake -S /src/ql-backend -B /build/ql-backend -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_PREFIX_PATH="/opt/quantlib;/opt/protobuf" \
 && cmake --build /build/ql-backend --target ql-backend --parallel ${BUILD_JOBS:-$(nproc)} \
 && strip /build/ql-backend/ql-backend

# ---------------------------------------------------------------------------
FROM node:22-${DEBIAN_RELEASE}-slim AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
# No install scripts: `prepare` would generate the bindings before the schema is
# copied in and set up git hooks in a tree with no git. `npm run build` below
# generates the bindings itself.
RUN npm ci --ignore-scripts
COPY . .
# A path, so the page dials the host it was served from; see src/protocol/socketUrl.ts.
ARG VITE_WS_URL=/ws/
RUN test -f proto/quantlib/v2/envelope.proto \
 || { echo "proto/ is empty: run git submodule update --init here" >&2; exit 1; }
RUN VITE_WS_URL="$VITE_WS_URL" npm run build

# ---------------------------------------------------------------------------
FROM python:3.13-slim-${DEBIAN_RELEASE} AS guide
WORKDIR /src
COPY doc/requirements.txt doc/requirements.txt
RUN pip install --no-cache-dir -r doc/requirements.txt
COPY doc doc
RUN sh doc/build.sh -q

# ---------------------------------------------------------------------------
FROM debian:${DEBIAN_RELEASE}-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx tini curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --no-create-home --shell /usr/sbin/nologin ql

COPY --from=backend /build/ql-backend/ql-backend /usr/local/bin/ql-backend
COPY --from=frontend /src/dist /srv/ql-frontend
# Where the status bar's Guide button looks for it (VITE_DOCS_URL's default).
COPY --from=guide /src/doc/_build/html /srv/ql-frontend/doc/_build/html
COPY docker/nginx.conf /etc/ql-frontend/nginx.conf
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/ql-entrypoint

# The browser origins ql-backend accepts, space-separated. The defaults cover
# `-p 8080:8080` reached as localhost or 127.0.0.1; publish another port or
# serve it under another name and this has to say so, or the page is refused
# (and the status bar says "running, but refusing this page").
ENV QL_ALLOWED_ORIGINS="http://localhost:8080 http://127.0.0.1:8080"

USER ql
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD curl -fsS http://127.0.0.1:8080/ws/healthz >/dev/null || exit 1
# tini reaps and forwards signals; the entrypoint runs the two processes, and
# any arguments to `docker run` are passed on to ql-backend.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/ql-entrypoint"]
