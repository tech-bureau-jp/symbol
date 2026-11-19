# shellcheck shell=bash
# Shared setup for the mijin build script tests.

MIJIN_DIR="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

# Create a minimal repository with the files the build helpers read, and point REPO_ROOT at it.
setup_repo() {
	REPO_ROOT="$BATS_TEST_TMPDIR/repo"
	export REPO_ROOT
	mkdir -p \
		"$REPO_ROOT/client/catapult/src/catapult/version" \
		"$REPO_ROOT/client/rest" \
		"$REPO_ROOT/jenkins/catapult/compilers/ubuntu-gcc" \
		"$REPO_ROOT/jenkins/docker"

	cat > "$REPO_ROOT/client/catapult/src/catapult/version/version_inc.h" <<-'EOF'
	#pragma once
	#define CATAPULT_VERSION_MAJOR 1
	#define CATAPULT_VERSION_MINOR 0
	#define CATAPULT_VERSION_REVISION 3
	#define CATAPULT_VERSION_BUILD 11
	EOF
	printf '{\n  "name": "catapult-api-rest",\n  "version": "2.5.2-mijin-100311"\n}\n' > "$REPO_ROOT/client/rest/package.json"
	printf 'c: gcc\ncpp: g++\nversion: 16\n' > "$REPO_ROOT/jenkins/catapult/compilers/gcc-latest.yaml"
	printf '[versions]\n\nubuntu = 26.04\nboost = 1.91.0\n' > "$REPO_ROOT/jenkins/catapult/versions.properties"
	printf 'FROM ubuntu:26.04\n' > "$REPO_ROOT/jenkins/catapult/compilers/ubuntu-gcc/Dockerfile"
	printf 'FROM ubuntu:26.04\n' > "$REPO_ROOT/jenkins/docker/ubuntu.DockerFile"

	git -C "$REPO_ROOT" init -q
	git -C "$REPO_ROOT" -c user.name=test -c user.email=test@example.invalid add -A
	git -C "$REPO_ROOT" -c user.name=test -c user.email=test@example.invalid commit -q -m init
}

# Replace uname so that `uname -m` prints the given machine name.
stub_uname() {
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	printf '#!/bin/sh\necho %s\n' "$1" > "$BATS_TEST_TMPDIR/bin/uname"
	chmod +x "$BATS_TEST_TMPDIR/bin/uname"
	PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

load_common() {
	# shellcheck source=../lib/common.sh
	source "$MIJIN_DIR/lib/common.sh"
}

load_steps() {
	load_common
	# shellcheck source=../lib/steps.sh
	source "$MIJIN_DIR/lib/steps.sh"
}

# Put the docker stub first on PATH with empty state.
setup_stub_docker() {
	STUB_DIR="$BATS_TEST_TMPDIR/stub"
	DOCKER_LOG="$STUB_DIR/log"
	export STUB_DIR DOCKER_LOG
	mkdir -p "$STUB_DIR" "$BATS_TEST_TMPDIR/bin"
	: > "$DOCKER_LOG"
	ln -sf "$MIJIN_DIR/tests/stub/docker" "$BATS_TEST_TMPDIR/bin/docker"
	PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

stub_local_image() { echo "$1 ${2:--}" >> "$STUB_DIR/local"; }
stub_hub_image() { echo "$1 ${2:--}" >> "$STUB_DIR/hub"; }
stub_run_output() { printf '%s\t%s\n' "$1" "$2" >> "$STUB_DIR/run"; }

# Replace gen() with the names the upstream generator prints (checked against the real generator for gcc 16).
stub_gen() {
	gen() {
		local suffix
		[ "$ARCH" = amd64 ] && suffix=skylake || suffix=arm64
		local layer=$2
		local -A tags=([os]=preimage1 [boost]=preimage2 [deps]=preimage3 [test]=)
		case "$*" in
			*--base-name-only*--ignore-architecture*) echo "techbureauhd/catapult-server-compiler:ubuntu-gcc-16" ;;
			*--base-name-only*) echo "techbureauhd/catapult-server-compiler:ubuntu-gcc-16-$suffix" ;;
			*--name-only*)
				local tag=${tags[$layer]}
				echo "techbureauhd/catapult-server-build-base:ubuntu-gcc-16${tag:+-$tag}-$suffix"
				;;
			*) printf 'FROM previous\nRUN build %s for %s\n' "$layer" "$ARCH" ;;
		esac
	}
}

# True when the docker log has a line containing the given text.
docker_called() { grep -qF -- "$1" "$DOCKER_LOG"; }
