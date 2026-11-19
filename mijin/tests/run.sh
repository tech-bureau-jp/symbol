#!/usr/bin/env bash
# Run shellcheck and the bats tests for the mijin build scripts inside an Ubuntu 26.04 container,
# so that they run with the same bash and tools as the build VMs.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE=mijin-build-test:ubuntu-26.04

docker build -q -t "$IMAGE" - > /dev/null <<'EOF'
FROM ubuntu:26.04
RUN apt-get update -qq \
	&& apt-get install -y -qq bats shellcheck git python3 python3-yaml > /dev/null \
	&& rm -rf /var/lib/apt/lists/*
EOF

docker run --rm -v "$REPO_ROOT:/w:ro" -w /w "$IMAGE" bash -c '
	set -euo pipefail
	files=()
	for f in mijin/build.sh mijin/lib/*.sh mijin/tests/run.sh mijin/tests/stub/docker; do
		[ -f "$f" ] && files+=("$f")
	done
	shellcheck -x "${files[@]}"
	echo "shellcheck: ok (${#files[@]} files)"
	bats mijin/tests
'
