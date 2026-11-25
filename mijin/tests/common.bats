#!/usr/bin/env bats

setup() {
	load helper
	setup_repo
	load_common
}

@test "detect_arch maps x86_64 to amd64" {
	stub_uname x86_64
	run detect_arch
	[ "$status" -eq 0 ]
	[ "$output" = amd64 ]
}

@test "detect_arch maps aarch64 to arm64" {
	stub_uname aarch64
	run detect_arch
	[ "$status" -eq 0 ]
	[ "$output" = arm64 ]
}

@test "detect_arch rejects armv7l" {
	stub_uname armv7l
	run detect_arch
	[ "$status" -ne 0 ]
	[[ "$output" == *"armv7l"* ]]
}

@test "arch_label maps arches to rest tag labels" {
	[ "$(arch_label amd64)" = x86 ]
	[ "$(arch_label arm64)" = arm ]
}

@test "catapult_version reads version_inc.h" {
	run catapult_version
	[ "$output" = 1.0.3.11 ]
}

@test "rest_version reads package.json" {
	run rest_version
	[ "$output" = 2.5.2-mijin-100311 ]
}

@test "rest tags follow plan 1" {
	[ "$(rest_tag_base)" = 2.5.2-100311 ]
	[ "$(rest_tag amd64)" = mijin-x86-2.5.2-100311 ]
	[ "$(rest_tag arm64)" = mijin-arm-2.5.2-100311 ]
	[ "$(rest_manifest_tag)" = mijin-2.5.2-100311 ]
}

@test "server tags" {
	[ "$(server_tag amd64)" = gcc-mijin-1.0.3.11 ]
	[ "$(server_tag arm64)" = gcc-mijin-arm-1.0.3.11 ]
	[ "$(server_manifest_tag)" = mijin-1.0.3.11 ]
}

@test "gcc_version and ubuntu_version" {
	[ "$(gcc_version)" = 16 ]
	[ "$(ubuntu_version)" = 26.04 ]
}

@test "compiler_hash matches manual definition" {
	expected=$( (cat "$REPO_ROOT/jenkins/catapult/compilers/ubuntu-gcc/Dockerfile"; echo 16) | sha256sum | cut -d' ' -f1)
	[ "$(compiler_hash)" = "$expected" ]
}

@test "testbase_hash is the sha256 of ubuntu.DockerFile" {
	expected=$(sha256sum < "$REPO_ROOT/jenkins/docker/ubuntu.DockerFile" | cut -d' ' -f1)
	[ "$(testbase_hash)" = "$expected" ]
}

@test "layer_hash is the sha256 of the generated Dockerfile" {
	gen() { printf 'FROM x\nRUN layer %s\n' "$2"; }
	expected=$(printf 'FROM x\nRUN layer boost\n' | sha256sum | cut -d' ' -f1)
	[ "$(layer_hash boost)" = "$expected" ]
}

@test "gen passes the per-arch compiler configuration" {
	ARCH=arm64
	python3() { echo "$*"; }
	run gen --layer os --name-only
	[[ "$output" == *"--compiler-configuration jenkins/catapult/configurations/arm64/gcc-latest.yaml"* ]]
	[[ "$output" == *"--operating-system ubuntu --versions jenkins/catapult/versions.properties --layer os --name-only"* ]]
}

@test "log_run prints the command before running it" {
	run log_run echo hi
	[ "$status" -eq 0 ]
	[ "${lines[0]}" = "▶ echo hi" ]
	[ "${lines[1]}" = hi ]
}

@test "log_run returns the command's exit status" {
	run log_run false
	[ "$status" -ne 0 ]
}

@test "fail prints a cross mark and exits non-zero" {
	run fail "something broke"
	[ "$status" -ne 0 ]
	[ "$output" = "✗ something broke" ]
}
