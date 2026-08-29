import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Builder } from "@sveltejs/kit";
import adapter from "./index";

test("returns a SvelteKit adapter", () => {
	const result = adapter();
	expect(result.name).toBe("@orochibraru/svelte-smol");
	expect(typeof result.adapt).toBe("function");
});

test("reports supported features", () => {
	const result = adapter();
	expect(result.supports?.read?.({ config: {}, route: { id: "/" } })).toBe(
		true,
	);
	expect(result.supports?.instrumentation?.()).toBe(true);
});

test("accepts options without throwing", () => {
	expect(() =>
		adapter({ out: "dist", precompress: true, envPrefix: "MYAPP_" }),
	).not.toThrow();
});

// --- adapt() ------------------------------------------------------------------

let scratch: string;
let buildSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), "svelte-smol-"));
	buildSpy = spyOn(Bun, "build").mockResolvedValue({
		success: true,
		logs: [],
		outputs: [],
	} as unknown as Awaited<ReturnType<typeof Bun.build>>);
});

afterEach(() => {
	buildSpy.mockRestore();
	rmSync(scratch, { recursive: true, force: true });
});

function fakeBuilder(instrumentation = false) {
	const tmp = join(scratch, ".tmp");
	const calls = { compress: 0 };
	const builder = {
		calls,
		config: { kit: { paths: { base: "" } } },
		prerendered: { paths: [] as string[] },
		log: {
			minor() {},
			success() {},
			error() {},
			warn() {},
			info() {},
		},
		getBuildDirectory: () => tmp,
		rimraf: (path: string) => rmSync(path, { recursive: true, force: true }),
		mkdirp: (path: string) => mkdirSync(path, { recursive: true }),
		writeClient() {},
		writePrerendered() {},
		writeServer: (dir: string) => mkdirSync(dir, { recursive: true }),
		generateManifest: () => "{}",
		compress: async () => {
			calls.compress++;
		},
		copy: (_from: string, to: string) => {
			mkdirSync(to, { recursive: true });
			for (const file of [
				"index.ts",
				"handler.ts",
				"env.ts",
				"healthcheck.ts",
			]) {
				writeFileSync(join(to, file), "export {};\n");
			}
		},
		hasServerInstrumentationFile: () => instrumentation,
	};
	return builder as unknown as Builder & { calls: typeof calls };
}

const outfilesFrom = (spy: typeof buildSpy): string[] =>
	spy.mock.calls.map(
		(call: unknown[]) =>
			(call[0] as { compile: { outfile: string } }).compile.outfile,
	);

test("adapt() compiles the server and healthcheck binaries by default", async () => {
	await adapter({ out: join(scratch, "build") }).adapt(fakeBuilder());

	expect(buildSpy).toHaveBeenCalledTimes(2);
	const outfiles = outfilesFrom(buildSpy);
	expect(outfiles.some((f) => f.endsWith("/build/server"))).toBe(true);
	expect(outfiles.some((f) => f.endsWith("/build/healthcheck"))).toBe(true);
});

test("adapt() skips the healthcheck binary when disabled", async () => {
	await adapter({ out: join(scratch, "build"), healthcheck: false }).adapt(
		fakeBuilder(),
	);
	expect(buildSpy).toHaveBeenCalledTimes(1);
});

test("adapt() with { healthcheck: {} } still emits the healthcheck", async () => {
	await adapter({ out: join(scratch, "build"), healthcheck: {} }).adapt(
		fakeBuilder(),
	);
	expect(buildSpy).toHaveBeenCalledTimes(2);
});

test("adapt() threads precompress, target and instrumentation through", async () => {
	const builder = fakeBuilder(true);
	await adapter({
		out: join(scratch, "build"),
		precompress: true,
		target: "bun-linux-x64",
		healthcheck: { path: "/healthz" },
	}).adapt(builder);

	expect(builder.calls.compress).toBe(2);
	expect(
		(buildSpy.mock.calls[0][0] as { compile: { target?: string } }).compile
			.target,
	).toBe("bun-linux-x64");

	const entry = await Bun.file(join(scratch, ".tmp", "index.ts")).text();
	expect(entry).toStartWith('import "./server/instrumentation.server.js";');
});

test("adapt() throws when `bun build --compile` fails", async () => {
	buildSpy.mockResolvedValue({
		success: false,
		logs: ["boom"],
		outputs: [],
	} as unknown as Awaited<ReturnType<typeof Bun.build>>);

	await expect(
		adapter({ out: join(scratch, "build") }).adapt(fakeBuilder()),
	).rejects.toThrow(/bun build --compile/);
});
