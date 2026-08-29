import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/basic", import.meta.url));
const buildDir = `${fixture}/build`;
const port = 3100 + Math.floor(Math.random() * 800);

let server: Bun.Subprocess | undefined;

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

beforeAll(async () => {
	await Bun.$`rm -rf ${buildDir} ${fixture}/.svelte-kit`.quiet();

	const build = Bun.spawnSync(["bunx", "--bun", "vite", "build"], {
		cwd: fixture,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (!build.success) {
		throw new Error(`vite build failed:\n${build.stderr.toString()}`);
	}

	// Run the compiled binary from an unrelated cwd: it must locate its
	// client/ and prerendered/ folders from its own path, not process.cwd().
	server = Bun.spawn([`${buildDir}/server`], {
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
	test("emits a single self-contained executable, no loose JS/TS", () => {
		const stat = statSync(`${buildDir}/server`);
		expect(stat.isFile()).toBe(true);
		expect(stat.mode & 0o111).toBeGreaterThan(0); // executable bit
		expect(stat.size).toBeGreaterThan(10_000_000); // Bun runtime is embedded

		expect(existsSync(`${buildDir}/index.js`)).toBe(false);
		expect(existsSync(`${buildDir}/index.ts`)).toBe(false);
		expect(existsSync(`${buildDir}/handler.ts`)).toBe(false);
	});

	test("emits a healthcheck executable", () => {
		const stat = statSync(`${buildDir}/healthcheck`);
		expect(stat.isFile()).toBe(true);
		expect(stat.mode & 0o111).toBeGreaterThan(0);
	});

	test("no rolldown anywhere in the dependency tree of the built server", async () => {
		const pkg = await Bun.file(
			new URL("../package.json", import.meta.url),
		).json();
		expect(pkg.dependencies ?? {}).toEqual({});
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
