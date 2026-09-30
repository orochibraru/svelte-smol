import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/kit3", import.meta.url));
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
	{
		label: "kit 3, compiled binary",
		compile: true,
		argv: [`${buildDir}/server`],
	},
	{
		label: "kit 3, index.js bundle",
		compile: false,
		argv: ["bun", `${buildDir}/index.js`],
	},
] as const;

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

			// Run from an unrelated cwd: the server must locate its assets from its
			// own path (or the embedded copies), not process.cwd().
			server = Bun.spawn([...mode.argv], {
				cwd: tmpdir(),
				env: {
					...process.env,
					PORT: String(port),
					// plain HTTP: without ORIGIN, the handler would assume https
					ORIGIN: `http://localhost:${port}`,
					CONNECTION_IDLE_TIMEOUT: "2",
				},
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
					// split chunks, not a compiled binary
					expect(statSync(`${buildDir}/server`).isDirectory()).toBe(true);
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

			test("writes client assets and prerendered pages, unless embedded", () => {
				expect(existsSync(`${buildDir}/client/robots.txt`)).toBe(!mode.compile);
				expect(existsSync(`${buildDir}/prerendered/about.html`)).toBe(
					!mode.compile,
				);
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

			test("immutable asset gets an immutable Cache-Control, an ETag, and 304s", async () => {
				const glob = new Bun.Glob("**/*.js");
				const [asset] = await Array.fromAsync(
					glob.scan({
						cwd: `${fixture}/.svelte-kit/output/client/_app/immutable`,
					}),
				);
				const path = `/_app/immutable/${asset}`;

				const first = await fetch(`http://localhost:${port}${path}`, {
					headers: { "accept-encoding": "identity" },
				});
				expect(first.status).toBe(200);
				expect(first.headers.get("cache-control")).toContain("immutable");
				const etag = first.headers.get("etag");
				expect(etag).toMatch(/^"[0-9a-f]+"$/);

				const revalidated = await fetch(`http://localhost:${port}${path}`, {
					headers: {
						"accept-encoding": "identity",
						"if-none-match": etag as string,
					},
				});
				expect(revalidated.status).toBe(304);
			});

			describe("range requests", () => {
				// test/fixtures/kit3/static/range.txt
				const content = "0123456789abcdefghijklmnopqrstuvwxyz";
				const size = content.length;
				const ranged = (range: string, headers: Record<string, string> = {}) =>
					fetch(`http://localhost:${port}/range.txt`, {
						headers: { range, ...headers },
					});

				// the validators of the representation ranges apply to
				const identity = () =>
					fetch(`http://localhost:${port}/range.txt`, {
						headers: { "accept-encoding": "identity" },
					});

				test("no Range: 200 advertising Accept-Ranges", async () => {
					const res = await identity();
					expect(res.status).toBe(200);
					expect(res.headers.get("accept-ranges")).toBe("bytes");
					expect(await res.text()).toBe(content);
				});

				test.each([
					["bytes=0-9", "0123456789", "bytes 0-9/36"],
					["bytes=10-", "abcdefghijklmnopqrstuvwxyz", "bytes 10-35/36"],
					["bytes=-5", "vwxyz", "bytes 31-35/36"],
					["bytes=30-999", "uvwxyz", "bytes 30-35/36"],
				])(
					"%s: 206 with exactly those bytes",
					async (range, body, content_range) => {
						const res = await ranged(range);
						expect(res.status).toBe(206);
						expect(res.headers.get("content-range")).toBe(content_range);
						expect(res.headers.get("content-length")).toBe(String(body.length));
						expect(res.headers.get("content-type")).toContain("text/plain");
						expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
						expect(res.headers.get("last-modified")).not.toBeNull();
						expect(await res.text()).toBe(body);
					},
				);

				test.each(["bytes=36-", "bytes=100-200", "bytes=-0"])(
					"%s: 416 with the size",
					async (range) => {
						const res = await ranged(range);
						expect(res.status).toBe(416);
						expect(res.headers.get("content-range")).toBe(`bytes */${size}`);
						expect(await res.text()).toBe("");
					},
				);

				test.each(["bytes=0-1,4-5", "bytes=abc", "items=0-9"])(
					"%s: ignored, 200 with the full body",
					async (range) => {
						const res = await ranged(range);
						expect(res.status).toBe(200);
						expect(res.headers.get("content-range")).toBeNull();
						expect(await res.text()).toBe(content);
					},
				);

				test("If-Range serves the range only while the validator matches", async () => {
					const full = await identity();
					const etag = full.headers.get("etag") as string;
					const last_modified = full.headers.get("last-modified") as string;

					const match = await ranged("bytes=0-9", { "if-range": etag });
					expect(match.status).toBe(206);
					expect(await match.text()).toBe("0123456789");

					const dated = await ranged("bytes=0-9", {
						"if-range": last_modified,
					});
					expect(dated.status).toBe(206);

					for (const stale of [
						'"nope"',
						`W/${etag}`,
						new Date(0).toUTCString(),
					]) {
						const res = await ranged("bytes=0-9", { "if-range": stale });
						expect(res.status).toBe(200);
						expect(await res.text()).toBe(content);
					}
				});

				test("a fresh conditional request 304s before any range logic", async () => {
					const full = await identity();
					const res = await ranged("bytes=0-9", {
						"if-none-match": full.headers.get("etag") as string,
					});
					expect(res.status).toBe(304);
				});

				test("immutable asset keeps its headers on 206 and is never served compressed", async () => {
					const glob = new Bun.Glob("**/*.js");
					const [asset] = await Array.fromAsync(
						glob.scan({
							cwd: `${fixture}/.svelte-kit/output/client/_app/immutable`,
						}),
					);
					const url = `http://localhost:${port}/_app/immutable/${asset}`;
					const headers = { "accept-encoding": "br, gzip" };

					const whole = await fetch(url, { headers, decompress: false });
					// precompressed variants only exist on disk, next to the index.js bundle
					expect(whole.headers.get("content-encoding")).toBe(
						mode.compile ? null : "br",
					);

					const res = await fetch(url, {
						headers: { ...headers, range: "bytes=0-9" },
						decompress: false,
					});
					expect(res.status).toBe(206);
					expect(res.headers.get("content-encoding")).toBeNull();
					expect(res.headers.get("cache-control")).toContain("immutable");
					expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
					expect(res.headers.get("vary")).toBe(
						mode.compile ? null : "accept-encoding",
					);
					const source = await Bun.file(
						`${fixture}/.svelte-kit/output/client/_app/immutable/${asset}`,
					).text();
					expect(await res.text()).toBe(source.slice(0, 10));
				});
			});

			test("same-origin form action over plain HTTP passes the CSRF check", async () => {
				const res = await fetch(`http://localhost:${port}/form`, {
					method: "POST",
					headers: {
						origin: `http://localhost:${port}`,
						"content-type": "application/x-www-form-urlencoded",
					},
					body: "",
					redirect: "manual",
				});
				expect(res.status).toBe(200);
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
				// Two events 6s apart, server running with CONNECTION_IDLE_TIMEOUT=2: the second
				// only arrives because the adapter cleared the idle timeout here.
				const body = await res.text();
				expect(body).toBe("data: 0\n\ndata: 1\n\n");
			}, 20_000);
		});
	});
}
