import { $ } from "bun";

type Bump = "patch" | "minor" | "major";

const arg = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (
	!arg ||
	(!["patch", "minor", "major"].includes(arg) && !/^\d+\.\d+\.\d+/.test(arg))
) {
	console.error("Usage: bun run release <patch|minor|major|x.y.z> [--dry-run]");
	process.exit(1);
}

const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
if (branch !== "main") {
	console.error(`Releases run from main, currently on ${branch}.`);
	process.exit(1);
}

if ((await $`git status --porcelain`.text()).trim()) {
	console.error("Working tree is dirty. Commit or discard changes first.");
	process.exit(1);
}

await $`git fetch --tags`;

console.log("Validating...");
await $`bun run lint`;
await $`bun run typecheck`;
await $`bun test`;
await $`bun run build`;

const pkg = await Bun.file("package.json").json();
const current: string = pkg.version;
const next = /^\d/.test(arg) ? arg : bump(current, arg as Bump);
const tag = `v${next}`;

const previousTag = (
	await $`git describe --tags --abbrev=0`.nothrow().text()
).trim();
const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
const log = (await $`git log ${range} --pretty=format:- %s (%h)`.text()).trim();
const notes = log || "- No changes recorded.";

const date = new Date().toISOString().slice(0, 10);
const entry = `## ${tag} - ${date}\n\n${notes}\n`;
const changelogFile = Bun.file("CHANGELOG.md");
const existing = (await changelogFile.exists())
	? await changelogFile.text()
	: "# Changelog\n";
const [header, ...rest] = existing.split("\n## ");
const updated = `${header.trimEnd()}\n\n${entry}${rest.length ? `\n## ${rest.join("\n## ")}` : ""}`;

console.log(`\n${current} -> ${next}\n\n${entry}`);

if (dryRun) {
	console.log("Dry run, nothing written.");
	process.exit(0);
}

pkg.version = next;
await Bun.write("package.json", `${JSON.stringify(pkg, null, "\t")}\n`);
await Bun.write("CHANGELOG.md", updated);

await $`git add package.json CHANGELOG.md`;
await $`git commit -m ${`chore(release): ${tag}`}`;
await $`git tag -a ${tag} -m ${tag}`;

console.log(`\nTagged ${tag}. Review, then: git push --follow-tags`);

function bump(version: string, kind: Bump): string {
	const [major, minor, patch] = version.split(".").map(Number);
	if (kind === "major") return `${major + 1}.0.0`;
	if (kind === "minor") return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}
