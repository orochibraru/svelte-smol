#!/usr/bin/env bun

/**
 * Point every `examples/*` app at a given release of this package and refresh
 * its lockfile. Run by the release workflow right after `semantic-release`
 * publishes, so the examples always reference the latest published version.
 *
 *   bun run scripts/bump-examples.ts 1.7.0
 */

import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PKG = "@orochibraru/svelte-smol";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
	console.error(
		`usage: bun run scripts/bump-examples.ts <version>\n  got: ${version ?? "(nothing)"}`,
	);
	process.exit(1);
}
const range = `^${version}`;

const examplesDir = new URL("../examples/", import.meta.url);
const entries = await readdir(examplesDir, { withFileTypes: true });

let bumped = 0;
for (const entry of entries) {
	if (!entry.isDirectory()) continue;

	const dir = new URL(`${entry.name}/`, examplesDir);
	const manifest = Bun.file(new URL("package.json", dir));
	if (!(await manifest.exists())) continue;

	const pkg = await manifest.json();
	let hit = false;
	for (const field of ["dependencies", "devDependencies"] as const) {
		const current = pkg[field]?.[PKG];
		if (current !== undefined && current !== range) {
			pkg[field][PKG] = range;
			hit = true;
		}
	}

	if (!hit) {
		console.log(`  ${entry.name}: already ${range}`);
		continue;
	}

	await Bun.write(manifest, `${JSON.stringify(pkg, null, "\t")}\n`);
	console.log(`  ${entry.name}: ${PKG} -> ${range}`);

	// Refresh bun.lock without a full install. The freshly published version's
	// manifest can take a moment to propagate, so retry before giving up.
	const cwd = fileURLToPath(dir);
	let locked = false;
	for (let attempt = 1; attempt <= 5 && !locked; attempt++) {
		const proc = Bun.spawnSync(["bun", "install", "--lockfile-only"], {
			cwd,
			stdout: "inherit",
			stderr: "inherit",
		});
		locked = proc.success;
		if (!locked && attempt < 5) await Bun.sleep(attempt * 3000);
	}
	if (!locked) {
		console.error(`  ${entry.name}: could not refresh bun.lock for ${range}`);
		process.exit(1);
	}

	bumped++;
}

console.log(
	bumped ? `bumped ${bumped} example(s) to ${range}` : "nothing to do",
);
