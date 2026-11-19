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

@test "compiler build passes COMPILER_VERSION from gcc-latest.yaml" {
	stub_run_output "gcc -dumpversion" 16
	run step_compiler
	[ "$status" -eq 0 ]
	docker_called "--build-arg COMPILER_VERSION=16"
	docker_called "-t techbureauhd/catapult-server-compiler:ubuntu-gcc-16 -t techbureauhd/catapult-server-compiler:ubuntu-gcc-16-arm64"
	docker_called "--label mijin.input-hash=$(compiler_hash)"
}

@test "compiler check fails when gcc -dumpversion differs" {
	stub_run_output "gcc -dumpversion" 15
	run step_compiler
	[ "$status" -ne 0 ]
	[[ "$output" == *"gcc"* ]]
}

@test "compiler check fails when the image architecture differs" {
	stub_run_output "gcc -dumpversion" 16
	export STUB_IMAGE_ARCH=amd64
	run step_compiler
	[ "$status" -ne 0 ]
	[[ "$output" == *"amd64"* ]]
}

@test "testbase is built from ubuntu.DockerFile with arch tag" {
	stub_run_output "os-release" 26.04
	run step_testbase
	[ "$status" -eq 0 ]
	docker_called "-f jenkins/docker/ubuntu.DockerFile --label mijin.input-hash=$(testbase_hash) -t techbureauhd/catapult-server-test-base:ubuntu -t techbureauhd/catapult-server-test-base:ubuntu-arm64 jenkins/docker"
}

@test "testbase check fails on ubuntu 24.04 image" {
	stub_run_output "os-release" 24.04
	run step_testbase
	[ "$status" -ne 0 ]
	[[ "$output" == *"24.04"* ]]
}

# The compiler image that the os layer is built FROM, present locally with the given layers.
stub_compiler() {
	stub_local_image "$(gen --layer os --base-name-only --ignore-architecture)" "$(compiler_hash)" "${1:-C1}"
}

@test "base builds layers in order os boost deps test" {
	stub_compiler
	run step_base
	[ "$status" -eq 0 ]
	grep 'buildx build' "$DOCKER_LOG" | grep -o 'ubuntu-gcc-16[a-z0-9-]*-arm64' > "$BATS_TEST_TMPDIR/order"
	[ "$(paste -sd' ' "$BATS_TEST_TMPDIR/order")" = "ubuntu-gcc-16-preimage1-arm64 ubuntu-gcc-16-preimage2-arm64 ubuntu-gcc-16-preimage3-arm64 ubuntu-gcc-16-arm64" ]
	docker_called "--label mijin.input-hash=$(layer_hash boost)"
}

@test "base stops at the first failing layer" {
	stub_compiler
	export STUB_FAIL_BUILD=preimage2
	run step_base
	[ "$status" -ne 0 ]
	docker_called "preimage1-arm64"
	! docker_called "preimage3-arm64"
}

@test "base reuses layers already on hub" {
	stub_compiler C1
	local layers=C1
	for layer in os boost deps test; do
		layers="$layers,L-$layer"
		stub_hub_image "$(gen --layer "$layer" --name-only)" "$(layer_hash "$layer")" "$layers"
	done
	run step_base
	[ "$status" -eq 0 ]
	! docker_called "buildx build"
	docker_called "pull techbureauhd/catapult-server-build-base:ubuntu-gcc-16-arm64"
}

@test "base fails when the compiler image is missing" {
	run step_base
	[ "$status" -ne 0 ]
	[[ "$output" == *"catapult-server-compiler:ubuntu-gcc-16"* ]]
	! docker_called "buildx build"
}

@test "base refuses a local layer not built on the current compiler" {
	stub_compiler C2
	stub_local_image "$(gen --layer os --name-only)" "$(layer_hash os)" "C1,L-os"
	run step_base
	[ "$status" -ne 0 ]
	[[ "$output" == *"--rebuild"* ]]
	[[ "$output" == *"catapult-server-compiler:ubuntu-gcc-16"* ]]
}
