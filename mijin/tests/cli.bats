#!/usr/bin/env bats

setup() {
	load helper
	setup_repo
	stub_uname aarch64
	# shellcheck source=../build.sh
	source "$MIJIN_DIR/build.sh"
	CALLS="$BATS_TEST_TMPDIR/calls"
	: > "$CALLS"
	for step in setup compiler testbase base server rest push manifest; do
		eval "step_$step() { echo \"$step REBUILD=\$REBUILD ARCH=\$ARCH\" >> \"$CALLS\"; }"
	done
}

@test "--help lists all subcommands" {
	run "$MIJIN_DIR/build.sh" --help
	[ "$status" -eq 0 ]
	for name in setup compiler testbase base server rest push manifest all --rebuild; do
		[[ "$output" == *"$name"* ]]
	done
}

@test "unknown subcommand exits non-zero with usage" {
	run "$MIJIN_DIR/build.sh" deploy
	[ "$status" -ne 0 ]
	[[ "$output" == *"Usage"* ]]
}

@test "missing subcommand exits non-zero with usage" {
	run "$MIJIN_DIR/build.sh"
	[ "$status" -ne 0 ]
	[[ "$output" == *"Usage"* ]]
}

@test "single subcommand runs only that step with the detected arch" {
	run main base
	[ "$status" -eq 0 ]
	[ "$(cat "$CALLS")" = "base REBUILD=0 ARCH=arm64" ]
}

@test "all runs steps in order and stops on failure" {
	step_base() { echo "base" >> "$CALLS"; fail "base broke"; }
	run main all
	[ "$status" -ne 0 ]
	[ "$(cut -d' ' -f1 "$CALLS" | paste -sd' ')" = "compiler testbase base" ]
}

@test "all runs compiler through push but not setup or manifest" {
	run main all
	[ "$status" -eq 0 ]
	[ "$(cut -d' ' -f1 "$CALLS" | paste -sd' ')" = "compiler testbase base server rest push" ]
}

@test "--rebuild sets REBUILD=1 for the step" {
	run main --rebuild base
	[ "$status" -eq 0 ]
	[ "$(cat "$CALLS")" = "base REBUILD=1 ARCH=arm64" ]
}

@test "main runs from the repository root" {
	cd /
	step_base() { pwd >> "$CALLS"; }
	run main base
	[ "$(cat "$CALLS")" = "$(cd "$MIJIN_DIR/.." && pwd)" ]
}
