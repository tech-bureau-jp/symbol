#!/usr/bin/env bash
# shellcheck source-path=SCRIPTDIR
# Build the mijin catapult-server / catapult-rest Docker images on an Ubuntu 26.04 build VM (x86_64 or aarch64)
# and publish them to Docker Hub. Each step prints the commands it runs (▶) and checks its result (✓ / ✗).

MIJIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$MIJIN_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "$MIJIN_DIR/lib/common.sh"
# shellcheck source=lib/steps.sh
source "$MIJIN_DIR/lib/steps.sh"
# shellcheck source=build.env
source "$MIJIN_DIR/build.env"

ALL_STEPS=(compiler testbase base server rest push)

usage() {
	cat <<-'EOF'
	Usage: mijin/build.sh [--rebuild] <step>

	Steps (run on each build VM unless noted):
	  setup      install docker, git, python3 and python3-yaml; add the user to the docker group
	  compiler   compiler image (gcc from jenkins/catapult/compilers/gcc-latest.yaml)
	  testbase   test base image the release image is built on (jenkins/docker/ubuntu.DockerFile)
	  base       base image layers os, boost, deps and test
	  server     catapult-server release image (version from client/catapult)
	  rest       catapult-rest image (version from client/rest/package.json)
	  push       push this machine's images to Docker Hub (run 'docker login' first)
	  manifest   create the multi-arch tags; run once on one VM after both VMs have pushed
	  all        compiler, testbase, base, server, rest and push in order

	Options:
	  --rebuild  build compiler, testbase and base images even when they exist locally or on Docker Hub
	  -h, --help show this help
	EOF
}

main() {
	local step=""
	REBUILD=0
	while [ $# -gt 0 ]; do
		case "$1" in
			--rebuild) REBUILD=1 ;;
			-h | --help) usage; return 0 ;;
			-*) usage >&2; fail "unknown option: $1" ;;
			*) [ -z "$step" ] || { usage >&2; fail "only one step at a time"; }; step=$1 ;;
		esac
		shift
	done

	case "$step" in
		setup | compiler | testbase | base | server | rest | push | manifest | all) ;;
		"") usage >&2; fail "no step given" ;;
		*) usage >&2; fail "unknown step: $step" ;;
	esac

	cd "$REPO_ROOT"
	ARCH=$(detect_arch)
	export REBUILD ARCH

	if [ "$step" = all ]; then
		local each
		for each in "${ALL_STEPS[@]}"; do
			"step_$each"
		done
		ok "all steps completed on $ARCH"
	else
		"step_$step"
	fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	set -euo pipefail
	main "$@"
fi
