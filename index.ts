import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Adapter, Builder } from "@sveltejs/kit";
import type { BuildConfig, BunPlugin, Serve, Server } from "bun";

declare global {
	namespace App {
		interface Platform {
			/** The Bun HTTP server handling the request. */
			server: Server<undefined>;
		}
	}
}

export interface AdapterOptions {
	/**
	 * The directory to build the server to.
	 * @default "build"
	 */
	out?: string;
	/**
	 * Generate `.br` and `.gz` variants of client and prerendered assets during
	 * the build, negotiated per request (brotli preferred). Ignored when
	 * compiling, because embedded assets are imported by identity path.
	 * @default false
	 */
	precompress?: boolean;
	/**
	 * Prefix for this adapter's runtime env vars (`MY_APP_` → `MY_APP_PORT`).
	 * @default ""
	 */
	envPrefix?: string;
	/**
	 * Default options passed to `Bun.serve`. Environment variables take
	 * precedence. Must be JSON-serializable.
	 * @default {}
	 */
	serverOptions?: Pick<
		Serve.Options<never>,
		| "development"
		| "hostname"
		| "port"
		| "idleTimeout"
		| "maxRequestBodySize"
		| "reusePort"
		| "unix"
		| "ipv6Only"
	>;
	/**
	 * Bun build options. The entrypoint, output directory, top-level target and
	 * module format are reserved. `compile` defaults to `true`: the server is a
	 * single executable at `<out>/server` with client and prerendered assets
	 * embedded. Pass a target string (`"bun-linux-x64-musl"`) to cross-compile,
	 * or `false` to emit a plain `<out>/index.js` bundle run with `bun` — the
	 * only way to ship native (`.node`) addons.
	 * @default { compile: true }
	 */
	buildOptions?: Pick<
		BuildConfig,
		| "sourcemap"
		| "minify"
		| "bytecode"
		| "banner"
		| "footer"
		| "drop"
		| "features"
		| "optimizeImports"
		| "splitting"
		| "compile"
	>;
	/**
	 * Compile a tiny `healthcheck` executable next to the server and expose a
	 * matching `GET` endpoint. The binary exits `0` when the server answers,
	 * `1` otherwise — ready for a Docker `HEALTHCHECK`. Pass an object to
	 * change the endpoint path.
	 * @default true
	 */
	healthcheck?: boolean | { path?: string };
}

type AssetMeta = { hash: string; mtime: number; br?: boolean; gz?: boolean };
type File = { abs: string; rel: string };

// `node:url`, not `import.meta.dir`: this module is loaded at config-parse time
// by Node-based tooling too (svelte-check, `svelte-kit sync`).
const templates = fileURLToPath(new URL("./templates", import.meta.url));

const NOT_BUN =
	"svelte-smol requires running the SvelteKit build with Bun. Use `bun run --bun build`.";

function read_files_recursive(dir: string): File[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => {
			const abs = path.resolve(entry.parentPath, entry.name);
			return { abs, rel: posixify(path.relative(dir, abs)) };
		})
		.filter(({ rel }) =>
			rel.split("/").every((segment) => segment !== ".vite"),
		);
}

/** Dotfiles are not served, except the `.well-known` directory (like sirv). */
function is_dotfile(file: string) {
	return file
		.split("/")
		.some(
			(segment, i) =>
				segment.startsWith(".") && !(i === 0 && segment === ".well-known"),
		);
}

// bounds open file handles while every asset hashes concurrently
const MAX_OPEN_FILES = 64;
let open_files = 0;
const file_waiters: Array<() => void> = [];

async function hash_file(file: string) {
	if (open_files === MAX_OPEN_FILES) {
		await new Promise<void>((resolve) => file_waiters.push(resolve));
	}
	open_files++;
	try {
		const hasher = new Bun.CryptoHasher("blake2b256");
		for await (const chunk of Bun.file(file).stream()) {
			hasher.update(chunk);
		}
		return hasher.digest("hex").slice(0, 16);
	} finally {
		open_files--;
		file_waiters.shift()?.();
	}
}

/** Bun only generates ETags for in-memory static routes, so ship our own. */
async function asset_meta(file: string, precompress = false) {
	const meta: AssetMeta = {
		hash: await hash_file(file),
		mtime: Bun.file(file).lastModified,
	};
	if (precompress) {
		if (fs.existsSync(`${file}.br`)) meta.br = true;
		if (fs.existsSync(`${file}.gz`)) meta.gz = true;
	}
	return meta;
}

function validate_file_paths(files: string[]) {
	for (const file of files) {
		if (file.includes("*")) {
			throw new Error(
				`Cannot build with ${JSON.stringify(file)} because Bun treats literal \`*\` characters in route paths as wildcards. Rename the file or route to remove the \`*\` character.`,
			);
		}
		// a leading ':' would need percent-encoding, but browsers request the colon raw
		if (file.split("/").some((segment) => segment.startsWith(":"))) {
			throw new Error(
				`Cannot build with ${JSON.stringify(file)} because Bun treats a route segment starting with \`:\` as a parameter. Rename the file or route so no segment starts with \`:\`.`,
			);
		}
	}
}

/**
 * SvelteKit adapter for Bun, based on `@sveltejs/adapter-bun`, that compiles
 * the app into a single standalone executable by default and adds a
 * `healthcheck` binary.
 *
 * The build must run under the Bun runtime (`bun --bun vite build`, or a
 * `bunfig.toml` with `[run] bun = true`); loading the config works under Node.
 *
 * @example
 * ```js
 * // vite.config.js
 * import { sveltekit } from "@sveltejs/kit/vite";
 * import { defineConfig } from "vite";
 * import adapter from "@orochibraru/svelte-smol";
 *
 * export default defineConfig({
 *   plugins: [
 *     sveltekit({
 *       adapter: adapter({ buildOptions: { compile: "bun-linux-x64-musl" } }),
 *     }),
 *   ],
 * });
 * ```
 */
export default function adapter(options: AdapterOptions = {}): Adapter {
	const {
		out = "build",
		envPrefix = "",
		precompress = false,
		serverOptions = {},
		healthcheck = true,
	} = options;
	const buildOptions = { compile: true, ...options.buildOptions };
	const embed = !!buildOptions.compile;
	const healthcheck_path =
		healthcheck === false
			? false
			: ((healthcheck === true ? undefined : healthcheck.path) ?? "/_health");

	return {
		name: "@orochibraru/svelte-smol",
		async adapt(builder) {
			if (typeof Bun === "undefined") throw new Error(NOT_BUN);

			fs.rmSync(out, { recursive: true, force: true });

			builder.log.minor("Building server");

			if (precompress && embed) {
				builder.log.warn(
					"precompress is ignored when compiling: embedded assets are imported by identity path",
				);
			}

			const server = builder.getServerDirectory();
			const index_file = path.resolve(templates, "index.ts");
			const routes_file = path.resolve(templates, "routes.ts");
			const manifest_file = path.resolve(server, "manifest.js");
			const server_options_file = path.resolve(templates, "options.ts");

			const tmp = builder.getBuildDirectory("bun-tmp");
			fs.mkdirSync(tmp, { recursive: true });
			builder.generateServerInstance(`${tmp}/server.js`);

			const virtual_files: Record<string, string> = {
				[manifest_file]: [
					`export const app_dir = ${JSON.stringify(builder.config.appDir)};`,
					`export const base = ${JSON.stringify(builder.config.paths.base || "/")};`,
					`export const embed = ${JSON.stringify(embed)};`,
					`export const env_prefix = ${JSON.stringify(envPrefix)};`,
					`export const origin = ${JSON.stringify(builder.config.paths.origin) ?? "undefined"};`,
					`export const healthcheck_path = ${JSON.stringify(healthcheck_path)};`,
				].join("\n"),
				[server_options_file]: `export default ${JSON.stringify(serverOptions)};`,
				[routes_file]: await create_routes({
					builder,
					out,
					embed,
					precompress: precompress && !embed,
				}),
			};

			const entrypoints = [index_file];

			if (builder.hasServerInstrumentationFile()) {
				const start_file = path.resolve(templates, "start.ts"); // virtual only
				virtual_files[start_file] = await Bun.file(index_file).text();
				virtual_files[index_file] = [
					`import ${JSON.stringify(`${server}/instrumentation.server.js`)};`,
					`await import(${JSON.stringify(start_file)});`,
				].join("\n");

				// as a split chunk, start.js would resolve assets from server/chunks/ instead of the output root
				if (!embed) entrypoints.push(start_file);
			}

			// Side-effect-only chunks (e.g. Svelte's events.js) compile to identical
			// stubs whose content hashes collide on one output path, failing the build
			// with "Multiple files share the same output path" (oven-sh/bun#37576).
			// Resolving a distinct identity per importer keeps every copy unique;
			// delete this once the Bun fix ships.
			const side_effect_sources = new Map<string, string>();
			for (const { abs } of read_files_recursive(`${server}/chunks`)) {
				const source = fs.readFileSync(abs, "utf8");
				if (/^import\s+["'][^"']+["'];\s*export\s*\{\s*\};?\s*$/.test(source)) {
					side_effect_sources.set(abs, source);
				}
			}

			// only the stubs above, because a hook that matches without resolving sends
			// Bun back to the filesystem, where the virtual entrypoints do not exist
			const side_effect_filter = new RegExp(
				`/(?:${[...side_effect_sources.keys()]
					.map((file) =>
						path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
					)
					.join("|")})$`,
			);

			const adapter_plugin: BunPlugin = {
				name: "svelte-smol",
				setup(build) {
					const virtual: Record<string, string> = {
						SERVER: `${tmp}/server.js`,
						MANIFEST: manifest_file,
						ROUTES: routes_file,
						SERVER_OPTIONS: server_options_file,
					};
					build.onResolve(
						{ filter: /^(SERVER|MANIFEST|ROUTES|SERVER_OPTIONS)$/ },
						(args) => ({ path: virtual[args.path] as string }),
					);

					if (side_effect_sources.size === 0) return;

					build.onResolve({ filter: side_effect_filter }, (args) => {
						const file = path.resolve(args.resolveDir, args.path);
						if (!side_effect_sources.has(file))
							return virtual_files[file] ? { path: file } : undefined;
						// The `?` suffix keeps dirname(path) inside chunks/ — Bun resolves the
						// synthetic module's relative imports against that, ignoring onLoad's resolveDir.
						return {
							path: `${file}?${Bun.hash(args.importer).toString(16)}`,
							namespace: "svelte-smol-side-effect",
						};
					});
					build.onLoad(
						{ filter: /.*/, namespace: "svelte-smol-side-effect" },
						(args) => ({
							loader: "js",
							contents: `${side_effect_sources.get(args.path.slice(0, args.path.indexOf("?")))}\nSymbol.for('svelte-smol:${Bun.hash(args.path).toString(16)}');`,
						}),
					);
				},
			};

			const compile = (outfile: string) =>
				embed
					? {
							outfile,
							...(typeof buildOptions.compile === "string"
								? { target: buildOptions.compile }
								: {}),
							...(typeof buildOptions.compile === "object"
								? buildOptions.compile
								: {}),
						}
					: false;

			await bun_build(builder, {
				...buildOptions,
				splitting: buildOptions.splitting ?? true,
				sourcemap: buildOptions.sourcemap ?? (embed ? "none" : "external"),
				entrypoints,
				target: "bun",
				format: "esm",
				naming: {
					entry: "[name].[ext]",
					chunk: "server/chunks/[name]-[hash].[ext]",
					asset: "server/assets/[name]-[hash].[ext]",
				},
				plugins: [adapter_plugin],
				conditions: ["bun", "node"],
				files: virtual_files,
				outdir: out,
				compile: compile("server"),
			} as BuildConfig);

			if (healthcheck_path) {
				builder.log.minor("Compiling healthcheck");
				const { compile: c } = buildOptions;
				const target = typeof c === "object" ? c.target : c;
				await bun_build(builder, {
					entrypoints: [path.resolve(templates, "healthcheck.ts")],
					target: "bun",
					format: "esm",
					minify: true,
					plugins: [adapter_plugin],
					files: virtual_files,
					outdir: out,
					compile: {
						outfile: "healthcheck",
						...(typeof target === "string" ? { target } : {}),
					},
				} as BuildConfig);
			}
		},

		supports: {
			read: () => true,
			instrumentation: () => true,
		},
	};
}

async function bun_build(builder: Builder, config: BuildConfig) {
	const result = await Bun.build({ ...config, throw: false });
	if (!result.success) {
		for (const log of result.logs) {
			// BuildMessage properties are not enumerable, so console.error(log) prints `{}`
			const message = log.message ?? String(log);
			if (log.level === "error") builder.log.error(message);
			else if (log.level === "warning") builder.log.warn(message);
			else builder.log.info(message);
		}
		throw new AggregateError(result.logs, "`bun build` failed");
	}
}

type Entries = {
	imports: string[];
	entries: string[];
	server_assets: string[];
};

async function get_embed_entries(
	builder: Builder,
	server_assets: string[],
): Promise<Entries> {
	const built_files = `${builder.config.outDir}/output`;

	const cl_files = read_files_recursive(`${built_files}/client`).filter(
		({ rel }) => !is_dotfile(rel),
	);
	const pr_pages = read_files_recursive(`${built_files}/prerendered/pages`);
	const pr_deps = read_files_recursive(
		`${built_files}/prerendered/dependencies`,
	);
	const pr_data = read_files_recursive(`${built_files}/prerendered/data`);

	const assets = [...cl_files, ...pr_pages, ...pr_deps, ...pr_data];
	validate_file_paths(assets.map(({ rel }) => rel));

	// keyed by identity: client and prerendered trees can contain the same relative path
	const asset_index = new Map(assets.map((file, i) => [file, i]));
	const imports = assets.map(
		({ abs }, i) =>
			`import asset_${i} from ${JSON.stringify(abs)} with { type: 'file' };`,
	);

	const entry = async (file: File, helper: string, url = file.rel) =>
		`...${helper}(${JSON.stringify(url)}, asset_${asset_index.get(file)}, ${JSON.stringify(await asset_meta(file.abs))})`;

	const page_files = new Map(pr_pages.map((file) => [file.rel, file]));
	const page_rels = new Set(
		[...builder.prerendered.pages].map(([, { file }]) => file),
	);

	const entries = await Promise.all([
		...cl_files.map((file) => entry(file, "client_asset")),
		...[...builder.prerendered.pages].map(([pathname, { file }]) => {
			const page = page_files.get(file);
			if (page === undefined)
				throw new Error(
					`Could not find prerendered page ${file} for route ${pathname}`,
				);
			return entry(page, "prerendered_page", pathname);
		}),
		...pr_pages
			.filter(({ rel }) => !page_rels.has(rel))
			.map((file) => entry(file, "prerendered_asset")),
		...[...pr_deps, ...pr_data].map((file) => entry(file, "prerendered_asset")),
	]);

	const index_by_rel = new Map(
		assets.map(({ rel }, i) => [rel, i] as const).reverse(),
	);

	return {
		imports,
		entries,
		server_assets: server_assets.map((file) => {
			const idx = index_by_rel.get(file);
			if (idx === undefined)
				throw new Error(`Could not find server asset ${file}`);
			return `[${JSON.stringify(file)}, server_asset(${JSON.stringify(file)}, asset_${idx})]`;
		}),
	};
}

async function get_no_embed_entries(
	builder: Builder,
	server_assets: string[],
	out: string,
	precompress: boolean,
): Promise<Entries> {
	const client_files = builder
		.writeClient(`${out}/client`)
		.filter((file) => !is_dotfile(file));
	const prerendered_files = builder.writePrerendered(`${out}/prerendered`);
	validate_file_paths([...client_files, ...prerendered_files]);

	if (precompress) {
		await Promise.all([
			builder.compress(`${out}/client`),
			builder.compress(`${out}/prerendered`),
		]);
	}

	const entry = async (
		helper: string,
		url: string,
		dir: string,
		filename?: string,
	) =>
		`...${helper}(${JSON.stringify(url)}, ${JSON.stringify(filename)}, ${JSON.stringify(await asset_meta(`${out}/${dir}/${filename ?? url}`, precompress))})`;

	const pages = [...builder.prerendered.pages];
	const page_files = new Set(pages.map(([, { file }]) => file));

	return {
		imports: [],
		entries: await Promise.all([
			...client_files.map((file) => entry("client_asset", file, "client")),
			...pages.map(([pathname, { file }]) =>
				entry("prerendered_page", pathname, "prerendered", file),
			),
			...prerendered_files
				.filter((file) => !page_files.has(file))
				.map((file) => entry("prerendered_asset", file, "prerendered")),
		]),
		server_assets: server_assets.map(
			(file) =>
				`[${JSON.stringify(file)}, server_asset(${JSON.stringify(file)})]`,
		),
	};
}

async function create_routes({
	builder,
	out,
	embed,
	precompress,
}: {
	builder: Builder;
	out: string;
	embed: boolean;
	precompress: boolean;
}) {
	validate_file_paths([
		...builder.prerendered.pages.keys(),
		...builder.prerendered.redirects.keys(),
	]);

	const server_assets = builder.findServerAssets(
		builder.routes.filter((route) => route.prerender !== true),
	);

	const { imports, entries, ...rest } = embed
		? await get_embed_entries(builder, server_assets)
		: await get_no_embed_entries(builder, server_assets, out, precompress);

	const redirects = [...builder.prerendered.redirects].map(
		([src, { status, location }]) =>
			`...prerendered_redirect(${JSON.stringify(src)}, ${status}, ${JSON.stringify(location)})`,
	);

	return [
		`import { client_asset, prerendered_asset, prerendered_page, prerendered_redirect, server_asset } from './routes-util.ts';`,
		...imports,
		// reversed because Object.fromEntries keeps the last duplicate: the first generated
		// entry for a path must win so exact files beat aliases, like sirv's lookup order
		`export const routes = Object.fromEntries([${[...entries, ...redirects].join(",\n")}].reverse());`,
		`export const server_assets = new Map([${rest.server_assets.join(",\n")}]);`,
	].join("\n");
}

function posixify(p: string) {
	return p.replace(/\\/g, "/");
}
