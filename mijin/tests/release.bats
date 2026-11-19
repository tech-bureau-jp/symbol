#!/usr/bin/env bats

setup() {
	load helper
	setup_repo
	setup_stub_docker
	load_steps
	export ARCH=arm64
	DOCKER_NAMESPACE=techbureauhd
	cd "$REPO_ROOT"

	# runDockerBuild.py produces techbureauhd/catapult-server:<label>; other python3 calls run for real.
	python3() {
		if [[ "${1:-}" == *runDockerBuild.py ]]; then
			echo "python3 $*" >> "$DOCKER_LOG"
			local label=${*: -1}
			stub_local_image "techbureauhd/catapult-server:$label"
		else
			command python3 "$@"
		fi
	}
}

@test "require_clean_tree ignores untracked files" {
	mkdir output
	touch output/binary gcc-mijin-arm-1.0.3.11.cid
	run require_clean_tree
	[ "$status" -eq 0 ]
}

@test "require_clean_tree refuses modified tracked file" {
	echo '' >> client/rest/package.json
	run require_clean_tree
	[ "$status" -ne 0 ]
	[[ "$output" == *"client/rest/package.json"* ]]
}

@test "server passes release-mijin and server_tag" {
	stub_run_output "catapult.server" "catapult version: 1.0.3.11"
	run step_server
	[ "$status" -eq 0 ]
	docker_called "--build-configuration jenkins/catapult/configurations/release-mijin.yaml"
	docker_called "--compiler-configuration jenkins/catapult/configurations/arm64/gcc-latest.yaml"
	docker_called "--destination-image-label gcc-mijin-arm-1.0.3.11"
	docker_called "--label mijin.git-commit=$(git rev-parse HEAD) -t techbureauhd/catapult-server:gcc-mijin-arm-1.0.3.11"
}

@test "server check fails when version line differs" {
	stub_run_output "catapult.server" "catapult version: 1.0.3.9"
	run step_server
	[ "$status" -ne 0 ]
	[[ "$output" == *"1.0.3.11"* ]]
}

@test "server refuses to build with uncommitted changes" {
	echo '' >> client/rest/package.json
	run step_server
	[ "$status" -ne 0 ]
	! docker_called "runDockerBuild.py"
}

@test "rest image tag follows plan 1" {
	export ARCH=amd64
	stub_run_output "node --version" "v24.22.3"
	stub_run_output "package.json" "2.5.2-mijin-100311"
	run step_rest
	[ "$status" -eq 0 ]
	docker_called "build -f client/rest/prod/Dockerfile --label mijin.git-commit=$(git rev-parse HEAD) -t techbureauhd/catapult-rest:mijin-x86-2.5.2-100311 client/rest"
}

@test "rest check fails on node 20" {
	stub_run_output "node --version" "v20.19.5"
	stub_run_output "package.json" "2.5.2-mijin-100311"
	run step_rest
	[ "$status" -ne 0 ]
	[[ "$output" == *"node"* ]]
}

@test "rest check fails when the package version differs" {
	stub_run_output "node --version" "v24.22.3"
	stub_run_output "package.json" "2.5.2-mijin"
	run step_rest
	[ "$status" -ne 0 ]
	[[ "$output" == *"2.5.2-mijin-100311"* ]]
}
