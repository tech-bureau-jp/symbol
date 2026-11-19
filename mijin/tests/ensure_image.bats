#!/usr/bin/env bats

setup() {
	load helper
	setup_repo
	setup_stub_docker
	load_steps
	ARCH=arm64
	BUILT_MARK="$BATS_TEST_TMPDIR/built"
}

build_a() {
	touch "$BUILT_MARK"
	docker build --label mijin.input-hash=H -t a:1 -t a:1-arm64 .
}

@test "ensure_image uses a local image whose hash matches" {
	stub_local_image a:1 H
	run ensure_image a:1 a:1-arm64 H build_a
	[ "$status" -eq 0 ]
	[[ "$output" == *"✓ a:1 (local)"* ]]
	! docker_called pull
	[ ! -e "$BUILT_MARK" ]
}

@test "ensure_image refuses an image whose hash label is missing" {
	stub_local_image a:1
	run ensure_image a:1 a:1-arm64 H build_a
	[ "$status" -ne 0 ]
	[[ "$output" == *"--rebuild"* ]]
	[ ! -e "$BUILT_MARK" ]
}

@test "ensure_image refuses an image whose hash differs" {
	stub_local_image a:1 X
	run ensure_image a:1 a:1-arm64 H build_a
	[ "$status" -ne 0 ]
	[[ "$output" == *"--rebuild"* ]]
}

@test "ensure_image pulls from hub and retags" {
	stub_hub_image a:1-arm64 H
	run ensure_image a:1 a:1-arm64 H build_a
	[ "$status" -eq 0 ]
	docker_called "pull a:1-arm64"
	docker_called "tag a:1-arm64 a:1"
	[[ "$output" == *"(pulled)"* ]]
	[ ! -e "$BUILT_MARK" ]
}

@test "ensure_image refuses a pulled image whose hash differs" {
	stub_hub_image a:1-arm64 OLD
	run ensure_image a:1 a:1-arm64 H build_a
	[ "$status" -ne 0 ]
	[[ "$output" == *"--rebuild"* ]]
}

@test "ensure_image builds when neither local nor hub has it" {
	run ensure_image a:1 a:1-arm64 H build_a
	[ "$status" -eq 0 ]
	[ -e "$BUILT_MARK" ]
	[[ "$output" == *"(built)"* ]]
}

@test "ensure_image rebuilds when REBUILD=1 even if local matches" {
	stub_local_image a:1 H
	REBUILD=1
	run ensure_image a:1 a:1-arm64 H build_a
	[ "$status" -eq 0 ]
	[ -e "$BUILT_MARK" ]
}

@test "ensure_image fails when the build does not set the expected hash" {
	build_without_label() { docker build -t a:1 .; }
	run ensure_image a:1 a:1-arm64 H build_without_label
	[ "$status" -ne 0 ]
}
