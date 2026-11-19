# shellcheck shell=bash
# Build steps for mijin/build.sh. Requires lib/common.sh, $REPO_ROOT as the current directory,
# $ARCH (amd64 or arm64) and $DOCKER_NAMESPACE.

# Print the mijin.input-hash label of a local image (empty when the label is missing); fail if the image is absent.
image_input_hash() {
	local value
	value=$(docker image inspect -f '{{index .Config.Labels "mijin.input-hash"}}' "$1") || return 1
	[ "$value" = '<no value>' ] && value=""
	echo "$value"
}

require_input_hash() {
	local ref=$1 expected=$2 actual
	actual=$(image_input_hash "$ref") || fail "$ref: image not found"
	[ "$actual" = "$expected" ] \
		|| fail "$ref: input hash is '${actual:-missing}', expected '$expected' (built from different inputs). Re-run with --rebuild to build it again."
}

# Make <local_ref> available with the expected input hash: use the local image, else pull <hub_ref>, else run <build_fn>.
# With REBUILD=1, always run <build_fn>. <build_fn> must label the image with mijin.input-hash=<expected_hash>.
ensure_image() {
	local local_ref=$1 hub_ref=$2 expected=$3 build_fn=$4

	if [ "${REBUILD:-0}" != 1 ]; then
		if docker image inspect "$local_ref" > /dev/null 2>&1; then
			require_input_hash "$local_ref" "$expected"
			ok "$local_ref (local)"
			return
		fi

		if docker buildx imagetools inspect "$hub_ref" > /dev/null 2>&1; then
			log_run docker pull "$hub_ref" || fail "$hub_ref: pull failed"
			if [ "$hub_ref" != "$local_ref" ]; then
				log_run docker tag "$hub_ref" "$local_ref" || fail "$local_ref: tag failed"
			fi
			require_input_hash "$local_ref" "$expected"
			ok "$local_ref (pulled)"
			return
		fi
	fi

	"$build_fn" || fail "$local_ref: build failed"
	require_input_hash "$local_ref" "$expected"
	ok "$local_ref (built)"
}

require_arch() {
	local actual
	actual=$(docker image inspect -f '{{.Architecture}}' "$1") || fail "$1: image not found"
	[ "$actual" = "$ARCH" ] || fail "$1: architecture is '$actual', expected '$ARCH'"
}

testbase_ref() { echo "$DOCKER_NAMESPACE/catapult-server-test-base:ubuntu"; }
testbase_hub_ref() { echo "$DOCKER_NAMESPACE/catapult-server-test-base:ubuntu-$1"; }

# Compiler image (gcc version from gcc-latest.yaml), tagged without and with the architecture.
step_compiler() {
	local gcc local_ref hub_ref hash actual
	gcc=$(gcc_version)
	local_ref=$(gen --layer os --base-name-only --ignore-architecture)
	hub_ref=$(gen --layer os --base-name-only)
	hash=$(compiler_hash)

	# shellcheck disable=SC2329 # called indirectly by ensure_image
	build_compiler() {
		log_run docker build --build-arg "COMPILER_VERSION=$gcc" --label "mijin.input-hash=$hash" \
			-t "$local_ref" -t "$hub_ref" jenkins/catapult/compilers/ubuntu-gcc
	}
	ensure_image "$local_ref" "$hub_ref" "$hash" build_compiler

	actual=$(docker run --rm "$local_ref" gcc -dumpversion) || fail "$local_ref: cannot run gcc"
	[ "$actual" = "$gcc" ] || fail "$local_ref: gcc -dumpversion is '$actual', expected '$gcc'"
	require_arch "$local_ref"
	ok "compiler: gcc $gcc, $ARCH"
}

# Test base image that the release image is built on (Ubuntu version from versions.properties).
step_testbase() {
	local ubuntu local_ref hub_ref hash actual
	ubuntu=$(ubuntu_version)
	local_ref=$(testbase_ref)
	hub_ref=$(testbase_hub_ref "$ARCH")
	hash=$(testbase_hash)

	# shellcheck disable=SC2329 # called indirectly by ensure_image
	build_testbase() {
		log_run docker build -f jenkins/docker/ubuntu.DockerFile --label "mijin.input-hash=$hash" \
			-t "$local_ref" -t "$hub_ref" jenkins/docker
	}
	ensure_image "$local_ref" "$hub_ref" "$hash" build_testbase

	# shellcheck disable=SC2016 # expanded inside the container
	actual=$(docker run --rm "$local_ref" sh -c '. /etc/os-release && echo "$VERSION_ID"') || fail "$local_ref: cannot run"
	[ "$actual" = "$ubuntu" ] || fail "$local_ref: Ubuntu $actual, expected $ubuntu"
	require_arch "$local_ref"
	ok "testbase: Ubuntu $ubuntu, $ARCH"
}

BASE_LAYERS=(os boost deps test)

# Base image layers, built in order from the Dockerfiles printed by the upstream generator.
step_base() {
	local layer ref hash dockerfile
	for layer in "${BASE_LAYERS[@]}"; do
		ref=$(gen --layer "$layer" --name-only)
		dockerfile=$(mktemp)
		gen --layer "$layer" > "$dockerfile"
		hash=$(sha256 < "$dockerfile")

		# shellcheck disable=SC2329 # called indirectly by ensure_image
		build_layer() {
			log_run docker buildx build --load --label "mijin.input-hash=$hash" -t "$ref" - < "$dockerfile"
		}
		ensure_image "$ref" "$ref" "$hash" build_layer
		rm -f "$dockerfile"
	done

	for layer in "${BASE_LAYERS[@]}"; do
		require_arch "$(gen --layer "$layer" --name-only)"
	done
	ok "base: ${BASE_LAYERS[*]}, $ARCH"
}

server_ref() { echo "$DOCKER_NAMESPACE/catapult-server:$(server_tag "$1")"; }
rest_ref() { echo "$DOCKER_NAMESPACE/catapult-rest:$(rest_tag "$1")"; }

# catapult-server release image, built by the upstream runDockerBuild.py and labelled with the source commit.
step_server() {
	require_clean_tree
	local version label ref commit output
	version=$(catapult_version)
	label=$(server_tag "$ARCH")
	ref=$(server_ref "$ARCH")
	commit=$(git -C "$REPO_ROOT" rev-parse HEAD)

	log_run python3 jenkins/catapult/runDockerBuild.py \
		--compiler-configuration "jenkins/catapult/configurations/$ARCH/gcc-latest.yaml" \
		--build-configuration jenkins/catapult/configurations/release-mijin.yaml \
		--operating-system ubuntu \
		--user "$(id -u):$(id -g)" \
		--source-path ./ \
		--destination-image-label "$label" || fail "$ref: build failed"
	printf 'FROM %s\n' "$ref" | log_run docker build --label "mijin.git-commit=$commit" -t "$ref" - \
		|| fail "$ref: labelling failed"

	# The server prints its version before it fails to load the (missing) configuration.
	output=$(docker run --rm --entrypoint /usr/catapult/bin/catapult.server "$ref" /nonexistent 2>&1) || true
	[[ "$output" == *"catapult version: $version"* ]] \
		|| fail "$ref: expected 'catapult version: $version', got: $(head -n 3 <<< "$output")"
	require_arch "$ref"
	ok "server: $ref ($version, $ARCH)"
}

# catapult-rest image from client/rest/prod/Dockerfile.
step_rest() {
	require_clean_tree
	local version ref commit node package
	version=$(rest_version)
	ref=$(rest_ref "$ARCH")
	commit=$(git -C "$REPO_ROOT" rev-parse HEAD)

	log_run docker build -f client/rest/prod/Dockerfile --label "mijin.git-commit=$commit" -t "$ref" client/rest \
		|| fail "$ref: build failed"

	node=$(docker run --rm "$ref" node --version) || fail "$ref: cannot run node"
	[[ "$node" == v24.* ]] || fail "$ref: node is $node, expected v24.x"
	package=$(docker run --rm "$ref" node -p "require('/app/package.json').version") || fail "$ref: cannot read package.json"
	[ "$package" = "$version" ] || fail "$ref: package version is '$package', expected '$version'"
	require_arch "$ref"
	ok "rest: $ref (node $node, $ARCH)"
}
