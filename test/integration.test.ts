import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/basic", import.meta.url));
const buildDir = `${fixture}/build`;

async function waitForReady(url: string, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await fetch(url);
			return;
		} catch {
			await Bun.sleep(100);
		}
	}
	throw new Error(`server at ${url} never came up`);
}

const modes = [
	{ label: "compiled binary", compile: true, argv: [`${buildDir}/server`] },
	{
		label: "index.js bundle",
		compile: false,
		argv: ["bun", `${buildDir}/index.js`],
	},
] as const;

test("the published package has no runtime dependencies", async () => {
	const pkg = await Bun.file(
		new URL("../package.json", import.meta.url),
	).json();
	expect(pkg.dependencies ?? {}).toEqual({});
});

test("`bun run build` emits Node-loadable JS that Node-based consumers import", async () => {
	const root = fileURLToPath(new URL("..", import.meta.url));
	const build = Bun.spawnSync(["bun", "run", "build"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (!build.success) {
		throw new Error(`build failed:\n${build.stderr.toString()}`);
	}

	const pkg = await Bun.file(`${root}/package.json`).json();
	const entry = `${root}/${pkg.exports["."].default}`;
	expect(existsSync(entry)).toBe(true);
	expect(existsSync(`${root}/${pkg.exports["."].types}`)).toBe(true);
	// the entry templates must sit next to the emitted entry, not just at the
	// package root, so `new URL("./templates", import.meta.url)` resolves them
	expect(existsSync(`${root}/dist/templates/handler.ts`)).toBe(true);

	// load it the way a Node-based SvelteKit config would
	const node = Bun.spawnSync(
		[
			"node",
			"--input-type=module",
			"-e",
			`import(${JSON.stringify(entry)}).then(m => { if (typeof m.default !== "function") process.exit(1); })`,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if (!node.success) {
		throw new Error(
			`node could not import the built entry:\n${node.stderr.toString()}`,
		);
	}
});

for (const mode of modes) {
	describe(mode.label, () => {
		const port = 3100 + Math.floor(Math.random() * 800);
		let server: Bun.Subprocess | undefined;

		beforeAll(async () => {
			await Bun.$`rm -rf ${buildDir} ${fixture}/.svelte-kit`.quiet();

			const build = Bun.spawnSync(["bunx", "--bun", "vite", "build"], {
				cwd: fixture,
				env: {
					...process.env,
					SMOL_COMPILE: String(mode.compile),
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			if (!build.success) {
				throw new Error(`vite build failed:\n${build.stderr.toString()}`);
			}

			// Run from an unrelated cwd: the server must locate its client/ and
			// prerendered/ folders from its own path, not process.cwd().
			server = Bun.spawn([...mode.argv], {
				cwd: tmpdir(),
				env: { ...process.env, PORT: String(port), IDLE_TIMEOUT: "2" },
				stdout: "pipe",
				stderr: "pipe",
			});
			await waitForReady(`http://localhost:${port}/`);
		}, 120_000);

		afterAll(() => {
			server?.kill();
		});

		describe("build output", () => {
			test("emits the expected server artifact and nothing loose", () => {
				if (mode.compile) {
					const stat = statSync(`${buildDir}/server`);
					expect(stat.isFile()).toBe(true);
					expect(stat.mode & 0o111).toBeGreaterThan(0); // executable bit
					expect(stat.size).toBeGreaterThan(10_000_000); // Bun runtime embedded
					expect(existsSync(`${buildDir}/index.js`)).toBe(false);
				} else {
					const stat = statSync(`${buildDir}/index.js`);
					expect(stat.isFile()).toBe(true);
					expect(stat.size).toBeLessThan(10_000_000); // no runtime embedded
					expect(existsSync(`${buildDir}/server`)).toBe(false);
				}
				expect(existsSync(`${buildDir}/index.ts`)).toBe(false);
				expect(existsSync(`${buildDir}/handler.ts`)).toBe(false);
			});

			test("emits a healthcheck executable either way", () => {
				const stat = statSync(`${buildDir}/healthcheck`);
				expect(stat.isFile()).toBe(true);
				expect(stat.mode & 0o111).toBeGreaterThan(0);
				expect(stat.size).toBeGreaterThan(10_000_000);
			});

			test("writes client assets and prerendered pages", () => {
				expect(existsSync(`${buildDir}/client/robots.txt`)).toBe(true);
				expect(existsSync(`${buildDir}/prerendered/about.html`)).toBe(true);
			});
		});

		describe("runtime", () => {
			test("server-rendered route", async () => {
				const res = await fetch(`http://localhost:${port}/`);
				expect(res.status).toBe(200);
				expect(await res.text()).toContain("home");
			});

			test("api route", async () => {
				const res = await fetch(`http://localhost:${port}/api`);
				expect(res.status).toBe(200);
				expect(await res.json()).toEqual({ ok: true, runtime: "bun" });
			});

			test("prerendered page", async () => {
				const res = await fetch(`http://localhost:${port}/about`);
				expect(res.status).toBe(200);
				expect(res.headers.get("content-type")).toContain("text/html");
			});

			test("static asset served by the handler", async () => {
				const res = await fetch(`http://localhost:${port}/robots.txt`);
				expect(res.status).toBe(200);
				expect(res.headers.get("content-type")).toContain("text/plain");
			});

			test("immutable asset gets an immutable Cache-Control, a weak ETag, and 304s", async () => {
				const glob = new Bun.Glob("**/*.js");
				const [asset] = await Array.fromAsync(
					glob.scan({ cwd: `${buildDir}/client/_app/immutable` }),
				);
				const path = `/_app/immutable/${asset}`;

				const first = await fetch(`http://localhost:${port}${path}`);
				expect(first.status).toBe(200);
				expect(first.headers.get("cache-control")).toContain("immutable");
				const etag = first.headers.get("etag");
				expect(etag).toMatch(/^W\//);

				const revalidated = await fetch(`http://localhost:${port}${path}`, {
					headers: { "if-none-match": etag as string },
				});
				expect(revalidated.status).toBe(304);
			});

			test("unmatched path falls through to SSR", async () => {
				const res = await fetch(`http://localhost:${port}/does-not-exist`);
				expect(res.status).toBe(404);
			});

			test("trailing-slash form of a prerendered page redirects", async () => {
				const res = await fetch(`http://localhost:${port}/about/`, {
					redirect: "manual",
				});
				expect(res.status).toBe(308);
				expect(res.headers.get("location")).toBe("/about");
			});

			test("health endpoint reports ok", async () => {
				const res = await fetch(`http://localhost:${port}/_health`);
				expect(res.status).toBe(200);
				expect(res.headers.get("cache-control")).toBe("no-store");
				const body = (await res.json()) as { status: string; uptime: number };
				expect(body.status).toBe("ok");
				expect(typeof body.uptime).toBe("number");
			});

			test("healthcheck binary exits 0 when the server is up, 1 when it isn't", () => {
				const ok = Bun.spawnSync([`${buildDir}/healthcheck`], {
					env: { ...process.env, PORT: String(port) },
				});
				expect(ok.exitCode).toBe(0);

				const down = Bun.spawnSync([`${buildDir}/healthcheck`], {
					env: {
						...process.env,
						PORT: String(port + 1),
						HEALTHCHECK_TIMEOUT: "1000",
					},
				});
				expect(down.exitCode).toBe(1);
			});

			test("SSE response outlives the idle timeout", async () => {
				const res = await fetch(`http://localhost:${port}/sse-slow`);
				expect(res.headers.get("content-type")).toBe("text/event-stream");
				// Two events 6s apart, server running with IDLE_TIMEOUT=2: the second
				// only arrives because the adapter cleared the idle timeout here.
				const body = await res.text();
				expect(body).toBe("data: 0\n\ndata: 1\n\n");
			}, 20_000);
		});
	});
}
