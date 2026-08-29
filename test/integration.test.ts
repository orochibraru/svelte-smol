import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
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

	server = Bun.spawn(["bun", "./build/index.js"], {
		cwd: fixture,
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
	test("emits the Bun entrypoint templates", () => {
		expect(existsSync(`${buildDir}/index.js`)).toBe(true);
		expect(existsSync(`${buildDir}/handler.js`)).toBe(true);
		expect(existsSync(`${buildDir}/env.js`)).toBe(true);
	});

	test("bundles the server with Bun, not rolldown", async () => {
		const serverBundle = await Bun.file(`${buildDir}/server/index.js`).text();
		expect(serverBundle.startsWith("// @bun")).toBe(true);
		expect(existsSync(`${buildDir}/server/manifest.js`)).toBe(true);
		expect(existsSync(`${buildDir}/server/index.js.map`)).toBe(true);
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

	test("static asset served from an exact route", async () => {
		const res = await fetch(`http://localhost:${port}/robots.txt`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/plain");
	});

	test("immutable directory route sends a weak ETag and honors 304", async () => {
		const glob = new Bun.Glob("**/*.js");
		const [asset] = await Array.fromAsync(
			glob.scan({ cwd: `${buildDir}/client/_app/immutable` }),
		);
		const path = `/_app/immutable/${asset}`;

		const first = await fetch(`http://localhost:${port}${path}`);
		expect(first.status).toBe(200);
		const etag = first.headers.get("etag");
		expect(etag).toMatch(/^W\//);

		const revalidated = await fetch(`http://localhost:${port}${path}`, {
			headers: { "if-none-match": etag as string },
		});
		expect(revalidated.status).toBe(304);
	});

	test("unmatched path falls through to SSR (404, not a dir-route 404)", async () => {
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

	test("SSE response outlives the idle timeout", async () => {
		const res = await fetch(`http://localhost:${port}/sse-slow`);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		// Two events 6s apart, server running with IDLE_TIMEOUT=2: the second
		// only arrives because the adapter cleared the idle timeout here.
		const body = await res.text();
		expect(body).toBe("data: 0\n\ndata: 1\n\n");
	}, 20_000);
});
