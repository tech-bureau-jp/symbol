# shellcheck shell=bash
# Helpers shared by the mijin build steps: output, architecture, versions, tag names and input hashes.
# Paths are read relative to $REPO_ROOT; gen() expects the current directory to be $REPO_ROOT.

# Print a command prefixed with "▶ " on stderr, then run it and return its exit status.
log_run() {
	echo "▶ $*" >&2
	"$@"
}

ok() {
	echo "✓ $*"
}

fail() {
	echo "✗ $*" >&2
	exit 1
}

# Print the Docker architecture of this machine (amd64 or arm64).
detect_arch() {
	local machine
	machine=$(uname -m)
	case "$machine" in
		x86_64) echo amd64 ;;
		aarch64 | arm64) echo arm64 ;;
		*) fail "unsupported architecture: $machine (only x86_64 and aarch64 are supported)" ;;
	esac
}

# Print the architecture label used in rest tags (x86 or arm).
arch_label() {
	case "$1" in
		amd64) echo x86 ;;
		arm64) echo arm ;;
		*) fail "unknown architecture: $1" ;;
	esac
}

gcc_version() {
	python3 -c 'import sys, yaml; print(yaml.safe_load(open(sys.argv[1]))["version"])' \
		"$REPO_ROOT/jenkins/catapult/compilers/gcc-latest.yaml"
}

ubuntu_version() {
	sed -n 's/^ubuntu[[:space:]]*=[[:space:]]*//p' "$REPO_ROOT/jenkins/catapult/versions.properties"
}

catapult_version() {
	local header="$REPO_ROOT/client/catapult/src/catapult/version/version_inc.h"
	local part parts=()
	for part in MAJOR MINOR REVISION BUILD; do
		parts+=("$(sed -n "s/^#define CATAPULT_VERSION_${part}[[:space:]]*//p" "$header")")
	done
	local IFS=.
	echo "${parts[*]}"
}

rest_version() {
	python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' "$REPO_ROOT/client/rest/package.json"
}

# Rest version without the "-mijin" marker (2.5.2-mijin-100311 -> 2.5.2-100311).
rest_tag_base() {
	local version
	version=$(rest_version)
	echo "${version/-mijin/}"
}

rest_tag() {
	echo "mijin-$(arch_label "$1")-$(rest_tag_base)"
}

rest_manifest_tag() {
	echo "mijin-$(rest_tag_base)"
}

server_tag() {
	case "$1" in
		amd64) echo "gcc-mijin-$(catapult_version)" ;;
		arm64) echo "gcc-mijin-arm-$(catapult_version)" ;;
		*) fail "unknown architecture: $1" ;;
	esac
}

server_manifest_tag() {
	echo "mijin-$(catapult_version)"
}

# Run the upstream base image Dockerfile generator for $ARCH.
gen() {
	python3 jenkins/catapult/baseImageDockerfileGenerator.py \
		--compiler-configuration "jenkins/catapult/configurations/$ARCH/gcc-latest.yaml" \
		--operating-system ubuntu \
		--versions jenkins/catapult/versions.properties \
		"$@"
}

sha256() {
	sha256sum | cut -d' ' -f1
}

compiler_hash() {
	(cat "$REPO_ROOT/jenkins/catapult/compilers/ubuntu-gcc/Dockerfile"; gcc_version) | sha256
}

layer_hash() {
	gen --layer "$1" | sha256
}

testbase_hash() {
	sha256 < "$REPO_ROOT/jenkins/docker/ubuntu.DockerFile"
}

# Stop when tracked files have uncommitted changes (untracked files such as output/ are allowed).
require_clean_tree() {
	local changes
	changes=$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)
	[ -z "$changes" ] || fail "uncommitted changes in tracked files; commit them first:"$'\n'"$changes"
}
