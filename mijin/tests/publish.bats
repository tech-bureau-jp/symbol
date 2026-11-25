#!/usr/bin/env bats

setup() {
	load helper
	setup_repo
	setup_stub_docker
	load_steps
	stub_gen
	export ARCH=arm64
	DOCKER_NAMESPACE=techbureauhd
	cd "$REPO_ROOT"
}

# Every image this machine pushes, for the given arch.
arch_refs() {
	local ARCH=$1
	gen --layer os --base-name-only
	testbase_hub_ref "$ARCH"
	for layer in os boost deps test; do gen --layer "$layer" --name-only; done
	server_ref "$ARCH"
	rest_ref "$ARCH"
}

# Every image this machine pushes, present locally; server and rest built from HEAD.
stub_pushable() {
	local head ref
	head=$(git -C "$REPO_ROOT" rev-parse HEAD)
	for ref in $(arch_refs arm64); do stub_local_image "$ref" - - "$head"; done
}

@test "push pushes only arch-specific tags" {
	stub_pushable
	run step_push
	[ "$status" -eq 0 ]
	docker_called "push techbureauhd/catapult-server-compiler:ubuntu-gcc-16-arm64"
	docker_called "push techbureauhd/catapult-server-test-base:ubuntu-arm64"
	docker_called "push techbureauhd/catapult-server-build-base:ubuntu-gcc-16-arm64"
	docker_called "push techbureauhd/catapult-server:gcc-mijin-arm-1.0.3.11"
	docker_called "push techbureauhd/catapult-rest:mijin-arm-2.5.2-100311"
	! grep -qx "push techbureauhd/catapult-server-compiler:ubuntu-gcc-16" "$DOCKER_LOG"
	! grep -qx "push techbureauhd/catapult-server-test-base:ubuntu" "$DOCKER_LOG"
	[ "$(grep -c '^push ' "$DOCKER_LOG")" -eq 8 ]
}

@test "push reports docker login hint on failure" {
	stub_pushable
	export STUB_FAIL_PUSH=1
	run step_push
	[ "$status" -ne 0 ]
	[[ "$output" == *"docker login"* ]]
}

@test "manifest stops and names the missing tag" {
	for ref in $(arch_refs amd64) $(arch_refs arm64); do
		[ "$ref" = techbureauhd/catapult-server:gcc-mijin-arm-1.0.3.11 ] || stub_hub_image "$ref"
	done
	run step_manifest
	[ "$status" -ne 0 ]
	[[ "$output" == *"techbureauhd/catapult-server:gcc-mijin-arm-1.0.3.11"* ]]
	! docker_called "imagetools create"
}

@test "manifest combines both arches for each image" {
	for ref in $(arch_refs amd64) $(arch_refs arm64); do stub_hub_image "$ref"; done
	run step_manifest
	[ "$status" -eq 0 ]
	docker_called "imagetools create -t techbureauhd/catapult-server:mijin-1.0.3.11 techbureauhd/catapult-server:gcc-mijin-1.0.3.11 techbureauhd/catapult-server:gcc-mijin-arm-1.0.3.11"
	docker_called "imagetools create -t techbureauhd/catapult-rest:mijin-2.5.2-100311 techbureauhd/catapult-rest:mijin-x86-2.5.2-100311 techbureauhd/catapult-rest:mijin-arm-2.5.2-100311"
	docker_called "imagetools create -t techbureauhd/catapult-server-compiler:ubuntu-gcc-16 techbureauhd/catapult-server-compiler:ubuntu-gcc-16-skylake techbureauhd/catapult-server-compiler:ubuntu-gcc-16-arm64"
	docker_called "imagetools create -t techbureauhd/catapult-server-test-base:ubuntu techbureauhd/catapult-server-test-base:ubuntu-amd64 techbureauhd/catapult-server-test-base:ubuntu-arm64"
}

@test "push refuses a server image built from another commit" {
	stub_pushable
	stub_local_image "$(server_ref arm64)" - - 0000000
	run step_push
	[ "$status" -ne 0 ]
	[[ "$output" == *"catapult-server:gcc-mijin-arm-1.0.3.11"* ]]
	! grep -q '^push ' "$DOCKER_LOG"
}

@test "push pushes nothing when listing the images fails" {
	stub_pushable
	export STUB_GEN_FAIL=deps
	run step_push
	[ "$status" -ne 0 ]
	! grep -q '^push ' "$DOCKER_LOG"
}
