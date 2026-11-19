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
