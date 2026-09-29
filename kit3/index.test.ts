import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Builder } from "@sveltejs/kit";
import type { BuildConfig, BunPlugin, PluginBuilder } from "bun";
import adapter from "./index";

test("returns a SvelteKit adapter with supported features", () => {
	const result = adapter();
	expect(result.name).toBe("@orochibraru/svelte-smol");
	expect(result.supports?.read?.({ config: {}, route: { id: "/" } })).toBe(
		true,
	);
	expect(result.supports?.instrumentation?.()).toBe(true);
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

function write(file: string, content = "x") {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

type Fake = {
	client?: string[];
	pages?: Array<[string, string]>;
	prerendered?: string[];
	redirects?: Array<[string, string]>;
	serverAssets?: string[];
	instrumentation?: boolean;
	sideEffectChunk?: boolean;
};

function fakeBuilder(fake: Fake = {}) {
	const kit = join(scratch, ".svelte-kit");
	const output = join(kit, "output");
	const server = join(output, "server");
	mkdirSync(server, { recursive: true });

	for (const file of fake.client ?? []) write(join(output, "client", file));
	for (const [, file] of fake.pages ?? []) {
		write(join(output, "prerendered/pages", file));
	}
	for (const file of fake.prerendered ?? []) {
		write(join(output, "prerendered", file));
	}
	if (fake.sideEffectChunk) {
		write(join(server, "chunks/events.js"), 'import "./a.js";\nexport {};\n');
		write(join(server, "chunks/real.js"), "export const a = 1;\n");
	}

	const calls = { compress: [] as string[], warn: [] as string[], logs: 0 };
	const copyInto = (dest: string, files: string[]) => {
		for (const file of files) write(join(dest, file));
		return files;
	};

	const builder = {
		calls,
		config: {
			appDir: "_app",
			outDir: kit,
			paths: { base: "", origin: undefined },
		},
		routes: [{ prerender: false }, { prerender: true }],
		prerendered: {
			pages: new Map(
				(fake.pages ?? []).map(([path, file]) => [path, { file }]),
			),
			redirects: new Map(
				(fake.redirects ?? []).map(([src, location]) => [
					src,
					{ status: 308, location },
				]),
			),
		},
		log: {
			minor() {},
			error: () => calls.logs++,
			warn: (message: string) => calls.warn.push(message),
			info: () => calls.logs++,
		},
		getServerDirectory: () => server,
		getBuildDirectory: (name: string) => join(kit, name),
		generateServerInstance() {},
		findServerAssets: () => fake.serverAssets ?? [],
		hasServerInstrumentationFile: () => fake.instrumentation ?? false,
		writeClient: (dest: string) => copyInto(dest, fake.client ?? []),
		writePrerendered: (dest: string) =>
			copyInto(dest, [
				...(fake.pages ?? []).map(([, file]) => file),
				...(fake.prerendered ?? []),
			]),
		compress: async (dir: string) => {
			calls.compress.push(dir);
			for (const file of fake.client ?? []) {
				if (dir.endsWith("client")) write(join(dir, `${file}.br`));
			}
		},
	};
	return builder as unknown as Builder & { calls: typeof calls };
}

const out = () => join(scratch, "build");
const call = (i: number) => buildSpy.mock.calls[i][0] as BuildConfig;
const routes = (i = 0) =>
	Object.entries(call(i).files ?? {}).find(([file]) =>
		file.endsWith("routes.ts"),
	)?.[1] as string;

test("compiles an embedded server and a healthcheck binary by default", async () => {
	const builder = fakeBuilder({
		client: ["robots.txt", ".hidden", ".well-known/security.txt"],
		pages: [["/about", "about.html"]],
		prerendered: ["pages/extra.html", "dependencies/x.json", "data/y.json"],
		redirects: [["/old", "/new"]],
		serverAssets: ["robots.txt"],
	});
	await adapter({ out: out(), precompress: true }).adapt(builder);

	expect(builder.calls.warn[0]).toContain("precompress is ignored");
	expect(buildSpy).toHaveBeenCalledTimes(2);
	expect(call(0).compile).toEqual({ outfile: "server" });
	expect(call(0).sourcemap).toBe("none");
	expect(call(1).compile).toEqual({ outfile: "healthcheck" });

	const source = routes();
	expect(source).toContain("with { type: 'file' }");
	expect(source).toContain('client_asset("robots.txt"');
	expect(source).toContain('client_asset(".well-known/security.txt"');
	expect(source).not.toContain('".hidden"');
	expect(source).toContain('prerendered_page("/about"');
	expect(source).toContain('prerendered_asset("extra.html"');
	expect(source).toContain('prerendered_redirect("/old", 308, "/new")');
	expect(source).toContain('server_asset("robots.txt", asset_0)');
});

test("cross-compiles both binaries for a target string or object", async () => {
	await adapter({
		out: out(),
		buildOptions: { compile: "bun-linux-x64" },
	}).adapt(fakeBuilder());
	expect(call(0).compile).toEqual({
		outfile: "server",
		target: "bun-linux-x64",
	});
	expect(call(1).compile).toEqual({
		outfile: "healthcheck",
		target: "bun-linux-x64",
	});

	buildSpy.mockClear();
	await adapter({
		out: out(),
		buildOptions: { compile: { target: "bun-linux-arm64", outfile: "app" } },
		healthcheck: { path: "/healthz" },
	}).adapt(fakeBuilder());
	expect(call(0).compile).toEqual({
		outfile: "app",
		target: "bun-linux-arm64",
	});
	expect(call(1).compile).toEqual({
		outfile: "healthcheck",
		target: "bun-linux-arm64",
	});
	const manifest = Object.entries(call(0).files ?? {}).find(([file]) =>
		file.endsWith("manifest.js"),
	)?.[1];
	expect(manifest).toContain('healthcheck_path = "/healthz"');
});

test("with compile: false, writes and precompresses assets next to index.js", async () => {
	const client = Array.from({ length: 70 }, (_, i) => `f${i}.txt`);
	const builder = fakeBuilder({
		client,
		pages: [["/about", "about.html"]],
		prerendered: ["extra.json"],
		serverAssets: ["f0.txt"],
		instrumentation: true,
	});
	await adapter({
		out: out(),
		precompress: true,
		healthcheck: false,
		buildOptions: { compile: false },
	}).adapt(builder);

	expect(buildSpy).toHaveBeenCalledTimes(1);
	expect(call(0).compile).toBe(false);
	expect(call(0).sourcemap).toBe("external");
	expect(call(0).entrypoints).toHaveLength(2); // index + start
	expect(builder.calls.compress).toHaveLength(2);

	const source = routes();
	expect(source).toContain('client_asset("f0.txt", undefined, {"hash"');
	expect(source).toContain('"br":true');
	expect(source).toContain('prerendered_page("/about", "about.html"');
	expect(source).toContain('prerendered_asset("extra.json"');
	expect(source).toContain('server_asset("f0.txt")');
});

test("prepends instrumentation to the compiled entrypoint", async () => {
	await adapter({ out: out() }).adapt(fakeBuilder({ instrumentation: true }));
	expect(call(0).entrypoints).toHaveLength(1);
	const index = Object.entries(call(0).files ?? {}).find(([file]) =>
		file.endsWith("templates/index.ts"),
	)?.[1];
	expect(index).toContain("instrumentation.server.js");
	expect(index).toContain("start.ts");
});

test("the plugin resolves virtual modules and dedupes side-effect chunks", async () => {
	await adapter({ out: out() }).adapt(fakeBuilder({ sideEffectChunk: true }));

	type Cb = (args: Record<string, string>) => unknown;
	const resolvers: Cb[] = [];
	const loaders: Cb[] = [];
	const plugin = call(0).plugins?.[0] as BunPlugin;
	plugin.setup({
		onResolve: (_: unknown, cb: Cb) => resolvers.push(cb),
		onLoad: (_: unknown, cb: Cb) => loaders.push(cb),
	} as unknown as PluginBuilder);

	const [virtual, sideEffect] = resolvers as [Cb, Cb];
	expect(virtual({ path: "ROUTES" })).toEqual({
		path: expect.stringContaining("routes.ts"),
	});

	const chunks = join(scratch, ".svelte-kit/output/server/chunks");
	const resolved = sideEffect({
		resolveDir: chunks,
		path: "./events.js",
		importer: "a.js",
	}) as { path: string; namespace: string };
	expect(resolved.namespace).toBe("svelte-smol-side-effect");
	expect(sideEffect({ resolveDir: chunks, path: "./real.js" })).toBeUndefined();

	const loaded = (loaders[0] as Cb)({ path: resolved.path }) as {
		contents: string;
	};
	expect(loaded.contents).toContain('import "./a.js"');
	expect(loaded.contents).toContain("Symbol.for('svelte-smol:");
});

test("rejects asset paths Bun would treat as route patterns", async () => {
	await expect(
		adapter({ out: out() }).adapt(fakeBuilder({ client: ["a*.txt"] })),
	).rejects.toThrow(/wildcards/);
	await expect(
		adapter({ out: out() }).adapt(fakeBuilder({ client: [":id.txt"] })),
	).rejects.toThrow(/parameter/);
});

test("throws on a missing prerendered page or server asset", async () => {
	const missingPage = fakeBuilder();
	(missingPage.prerendered.pages as Map<string, { file: string }>).set("/x", {
		file: "x.html",
	});
	await expect(adapter({ out: out() }).adapt(missingPage)).rejects.toThrow(
		/prerendered page x.html/,
	);
	await expect(
		adapter({ out: out() }).adapt(fakeBuilder({ serverAssets: ["nope"] })),
	).rejects.toThrow(/server asset nope/);
});

test("reports `bun build` logs and throws when it fails", async () => {
	buildSpy.mockResolvedValue({
		success: false,
		logs: [
			{ level: "error", message: "boom" },
			{ level: "warning", message: "hmm" },
			{ level: "info" },
		],
		outputs: [],
	} as unknown as Awaited<ReturnType<typeof Bun.build>>);

	const builder = fakeBuilder();
	await expect(adapter({ out: out() }).adapt(builder)).rejects.toThrow(
		/bun build/,
	);
	expect(builder.calls.logs).toBe(2);
	expect(builder.calls.warn).toEqual(["hmm"]);
});
