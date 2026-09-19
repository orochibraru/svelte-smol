/**
 * semantic-release `analyzeCommits` step that only counts commits touching the
 * published package. CI, docs, example and script changes never ship to npm,
 * so they must not trigger a release, whatever their commit type.
 *
 * Wraps `@semantic-release/commit-analyzer`, which still decides the bump
 * (and applies `releaseRules`) from the commits that remain.
 */

import { execFileSync } from "node:child_process";
import { analyzeCommits as analyze } from "@semantic-release/commit-analyzer";

// Everything that ends up in `dist/` (see the `build` script) plus the
// manifest npm publishes alongside it.
const PACKAGE_PATHS = [
	"index.ts",
	"templates",
	"package.json",
	"tsconfig.json",
	"tsconfig.build.json",
];

export function touchesPackage(hash, cwd) {
	return (
		execFileSync(
			"git",
			[
				"diff-tree",
				"--no-commit-id",
				"--name-only",
				"-r",
				hash,
				"--",
				...PACKAGE_PATHS,
			],
			{ cwd, encoding: "utf8" },
		).trim() !== ""
	);
}

export function analyzeCommits(pluginConfig, context) {
	const commits = context.commits.filter((commit) =>
		touchesPackage(commit.hash, context.cwd),
	);
	context.logger.log(
		`${commits.length} of ${context.commits.length} commits touch the published package`,
	);
	return analyze(pluginConfig, { ...context, commits });
}
