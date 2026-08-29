import { fileURLToPath } from "node:url";
import type { Adapter, Builder } from "@sveltejs/kit";

export interface AdapterOptions {
	/**
	 * Output directory. Holds the compiled executable plus the `client/` and
	 * `prerendered/` folders it serves.
	 * @default "build"
	 */
	out?: string;
	/**
	 * Filename of the compiled executable, written into `out`. Ignored when
	 * {@link AdapterOptions.compile | `compile`} is `false` (the server bundle
	 * is always `index.js` then).
	 * @default "server"
	 */
	name?: string;
	/**
	 * Compile the server to a single standalone executable with
	 * `bun build --compile`. Turn this off to emit a plain `build/index.js`
	 * bundle instead, run with `bun run build/index.js`. Pure-JS dependencies
	 * are still bundled in; a native (`.node`) addon can't be, so it resolves
	 * from `node_modules` at runtime — which a `bun` process can do and a
	 * compiled binary can't. This is the only way to ship `sharp`, `sqlite3`
	 * and the like. The `healthcheck` binary is still compiled either way.
	 * @default true
	 */
	compile?: boolean;
	/**
	 * Cross-compilation target for `bun build --compile`, e.g.
	 * `"bun-linux-x64"`, `"bun-linux-arm64-musl"`, `"bun-darwin-arm64"`,
	 * `"bun-windows-x64"` (optional `-modern` / `-baseline` SIMD suffix, and
	 * `-musl` for Alpine). Bun downloads the matching runtime on first use.
	 * @default the host platform
	 */
	target?: Bun.Build.CompileTarget;
	/**
	 * Emit a V8 bytecode cache into the executable for faster cold starts, at
	 * the cost of a larger binary.
	 * @default false
	 */
	bytecode?: boolean;
	/**
	 * Minify the bundled server code before embedding it.
	 * @default false
	 */
	minify?: boolean;
	/**
	 * Embed a source map so server stack traces point at original code.
	 * @default false
	 */
	sourcemap?: boolean;
	/**
	 * Pre-compress client assets and prerendered pages to `.gz` / `.br`
	 * siblings. The handler serves them with the matching `Content-Encoding`
	 * when the request's `Accept-Encoding` allows.
	 * @default false
	 */
	precompress?: boolean;
	/**
	 * Compile a second tiny executable, `healthcheck`, alongside the server
	 * and expose a matching `GET` endpoint. The binary probes that endpoint
	 * over loopback (or the Unix socket) and exits `0` when healthy, `1`
	 * otherwise — ready to drop into a Docker `HEALTHCHECK`. Pass an object
	 * to change the endpoint path.
	 * @default true
	 */
	healthcheck?: boolean | { path?: string };
	/**
	 * Prefix for this adapter's own runtime env vars (`PORT`, `HOST`,
	 * `ORIGIN`, ...).
	 * @default ""
	 */
	envPrefix?: string;
	/**
	 * Serve the app's static assets and prerendered pages from the
	 * executable. The `client/` and `prerendered/` folders must sit next to
	 * the binary (or point `ASSETS_DIR` at their parent). Turn off when a
	 * reverse proxy or CDN serves them instead.
	 * @default true
	 */
	serveAssets?: boolean;
	/**
	 * Extra options merged into the `Bun.serve()` call (`tls`, `reusePort`,
	 * `maxConnections`, a custom `error` handler, ...). Applied *before* this
	 * adapter's own required fields (`idleTimeout`, `maxRequestBodySize`,
	 * `fetch`, `hostname`/`port`/`unix`, `websocket`), so it can't be used to
	 * override request handling, only to add to it. Use the existing env vars
	 * (`IDLE_TIMEOUT`, `BODY_SIZE_LIMIT`, `HOST`/`PORT`, `SOCKET_PATH`,
	 * `SHUTDOWN_TIMEOUT`) to change those instead.
	 * @default {}
	 */
	serveOptions?: Record<string, unknown>;
}

// `node:url`, not `Bun.fileURLToPath`: this module is loaded at config-parse
// time by Node-based tooling too (svelte-check, the Svelte language server,
// `svelte-kit sync`), where `Bun` is undefined. Everything that actually needs
// the Bun runtime lives inside `adapt()`.
const templates = fileURLToPath(new URL("./templates", import.meta.url));

/**
 * SvelteKit adapter that compiles the app into a single standalone executable
 * with `bun build --compile`.
 *
 * `adapt()` writes the SvelteKit server and this package's entrypoint templates
 * into a temp directory, then compiles them — `@sveltejs/kit` and every other
 * pure-JS dependency bundled in — into one binary. The build must run under the
 * Bun runtime (`bun --bun vite build`, or a `bunfig.toml` with `[run] bun =
 * true`); loading the config alone works under Node too.
 *
 * With {@link AdapterOptions.compile | `compile: false`} it emits a plain
 * `build/index.js` bundle instead (run with `bun`), the only way to ship a
 * native (`.node`) addon.
 *
 * Output, all written to {@link AdapterOptions.out | `out`}:
 *
 * ```text
 * build/
 * ├── server        the executable (rename with `name`)
 * ├── client/       static assets, served by the executable
 * └── prerendered/  prerendered pages, served by the executable
 * ```
 *
 * The executable resolves `client/` and `prerendered/` from its own location
 * (`dirname(process.execPath)`, overridable with the `ASSETS_DIR` env var), so
 * it can run from any working directory. Deploy the whole `out` directory, or
 * just the binary when {@link AdapterOptions.serveAssets | `serveAssets`} is
 * off and a proxy/CDN serves the assets.
 *
 * Runtime configuration (`HOST`, `PORT`, `ORIGIN`, `BODY_SIZE_LIMIT`, …) is
 * read from environment variables, optionally namespaced by
 * {@link AdapterOptions.envPrefix | `envPrefix`}.
 *
 * @param options - see {@link AdapterOptions}
 * @returns the configured SvelteKit {@link Adapter}
 *
 * @example
 * ```js
 * // svelte.config.js
 * import adapter from "@orochibraru/svelte-smol";
 *
 * export default {
 *   kit: {
 *     adapter: adapter({
 *       // cross-compile for an Alpine container from any host
 *       target: "bun-linux-x64-musl",
 *       bytecode: true,
 *     }),
 *   },
 * };
 * ```
 *
 * @see {@link https://bun.com/docs/bundler/executables | Bun — Single-file executables}
 */
export default function adapter(options: AdapterOptions = {}): Adapter {
	const {
		out = "build",
		name = "server",
		compile = true,
		target,
		bytecode = false,
		minify = false,
		sourcemap = false,
		precompress = false,
		healthcheck = true,
		envPrefix = "",
		serveAssets = true,
		serveOptions = {},
	} = options;

	const healthcheckConfig =
		healthcheck === false
			? false
			: {
					path:
						(healthcheck === true ? undefined : healthcheck.path) ?? "/_health",
				};

	return {
		name: "@orochibraru/svelte-smol",
		supports: {
			instrumentation: () => true,
			read: () => true,
		},
		async adapt(builder: Builder) {
			const { base } = builder.config.kit.paths;
			const tmp = builder.getBuildDirectory("adapter-bun");

			builder.rimraf(out);
			builder.rimraf(tmp);
			builder.mkdirp(`${out}/`);
			builder.mkdirp(tmp);

			builder.log.minor("Copying assets");
			builder.writeClient(`${out}/client${base}`);
			builder.writePrerendered(`${out}/prerendered${base}`);

			if (precompress) {
				builder.log.minor("Compressing assets");
				await Promise.all([
					builder.compress(`${out}/client`),
					builder.compress(`${out}/prerendered`),
				]);
			}

			builder.log.minor("Building server");
			builder.writeServer(`${tmp}/server`);
			await Bun.write(
				`${tmp}/server/manifest.js`,
				[
					`export const manifest = ${builder.generateManifest({ relativePath: "./" })};`,
					`export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});`,
					`export const base = ${JSON.stringify(base)};`,
				].join("\n\n"),
			);

			// Entry templates ship as raw `.ts` — `bun build --compile` runs them
			// straight through. The virtual specifiers (`ENV`, `MANIFEST`,
			// `SERVER`, `HANDLER`) and the `ENV_PREFIX` / `BUILD_OPTIONS` /
			// `SERVE_OPTIONS` tokens are resolved by this raw word-boundary token
			// swap over the copied source.
			builder.log.minor("Copying entrypoint");
			builder.copy(templates, tmp, {
				replace: {
					BUILD_OPTIONS: JSON.stringify({
						serveAssets,
						precompress,
						healthcheck: healthcheckConfig,
						compiled: compile,
					}),
					ENV: "./env.ts",
					ENV_PREFIX: JSON.stringify(envPrefix),
					HANDLER: "./handler.ts",
					MANIFEST: "./server/manifest.js",
					SERVE_OPTIONS: JSON.stringify(serveOptions),
					SERVER: "./server/index.js",
				},
			});

			const entry = `${tmp}/index.ts`;
			if (builder.hasServerInstrumentationFile?.()) {
				// Instrumentation (OpenTelemetry &c.) has to load before anything
				// else in the bundle. A compiled binary has no post-build
				// entrypoint to rewrite, so prepend the import to the compile
				// entrypoint instead.
				await Bun.write(
					entry,
					`import "./server/instrumentation.server.js";\n${await Bun.file(entry).text()}`,
				);
			}

			const check = (
				result: Awaited<ReturnType<typeof Bun.build>>,
				label: string,
			) => {
				if (!result.success) {
					for (const message of result.logs) {
						builder.log.error(String(message));
					}
					throw new Error(`\`bun build\` failed for ${label}`);
				}
			};

			const compileBinary = async (entrypoint: string, outName: string) => {
				builder.log.minor(
					target ? `Compiling ${outName} (${target})` : `Compiling ${outName}`,
				);
				check(
					await Bun.build({
						entrypoints: [entrypoint],
						target: "bun",
						minify,
						bytecode,
						sourcemap: sourcemap ? "linked" : "none",
						compile: {
							outfile: `${out}/${outName}`,
							...(target ? { target } : {}),
						},
					}),
					outName,
				);
				builder.log.success(`Compiled ${out}/${outName}`);
			};

			const bundleServer = async (entrypoint: string) => {
				builder.log.minor("Bundling index.js");
				// Same bundle as the compiled binary, just emitted as a file. Every
				// pure-JS dependency is inlined; a native (`.node`) addon can't be,
				// so its `require` stays in the output and resolves from
				// `node_modules` at runtime — which is exactly what a plain `bun`
				// process (unlike a compiled binary) can do. Ship `node_modules`
				// for those; anything fully bundled needn't be installed.
				check(
					await Bun.build({
						entrypoints: [entrypoint],
						target: "bun",
						format: "esm",
						minify,
						sourcemap: sourcemap ? "linked" : "none",
						outdir: out,
						naming: "index.js",
					}),
					"index.js",
				);
				builder.log.success(`Bundled ${out}/index.js`);
			};

			if (compile) {
				await compileBinary(entry, name);
			} else {
				await bundleServer(entry);
			}
			if (healthcheckConfig) {
				await compileBinary(`${tmp}/healthcheck.ts`, "healthcheck");
			}
		},
	};
}
