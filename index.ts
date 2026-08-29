import type { Adapter, Builder } from "@sveltejs/kit";

export interface AdapterOptions {
	out?: string;
	/**
	 * Write pre-gzipped/pre-brotli'd `.gz`/`.br` sibling files alongside
	 * client assets and prerendered pages. Dead weight now that static
	 * serving goes through Bun 1.4's native `routes` (see
	 * `templates/handler.ts`): neither a `dir` route nor a bare `Bun.file()`
	 * route does Accept-Encoding content negotiation, nothing would ever
	 * pick these files up, they'd just become their own inert extra routes
	 * (`/foo.js.br` as a literal, separately-requestable path). Off by
	 * default for that reason; only turn on if something is added later that
	 * actually negotiates them.
	 * @default false
	 */
	precompress?: boolean;
	/**
	 *
	 * @default none
	 */
	envPrefix?: string;
	/**
	 * If enabled, the adapter will serve static assets.
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

const templates = Bun.fileURLToPath(new URL("./templates", import.meta.url));

export default function adapter(options: AdapterOptions = {}): Adapter {
	const {
		out = "build",
		precompress = false,
		envPrefix = "",
		serveAssets = true,
		serveOptions = {},
	} = options;

	return {
		async adapt(builder: Builder) {
			const tmp = builder.getBuildDirectory("adapter-bun");

			builder.rimraf(out);
			builder.rimraf(tmp);
			builder.mkdirp(tmp);

			builder.log.minor("Copying assets");
			builder.writeClient(`${out}/client${builder.config.kit.paths.base}`);
			builder.writePrerendered(
				`${out}/prerendered${builder.config.kit.paths.base}`,
			);

			if (precompress) {
				builder.log.minor("Compressing assets");
				await Promise.all([
					builder.compress(`${out}/client`),
					builder.compress(`${out}/prerendered`),
				]);
			}

			builder.log.minor("Building server");
			builder.writeServer(tmp);
			await Bun.write(
				`${tmp}/manifest.js`,
				[
					`export const manifest = ${builder.generateManifest({ relativePath: "./" })};`,
					`export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});`,
					`export const base = ${JSON.stringify(builder.config.kit.paths.base)};`,
				].join("\n\n"),
			);

			const hasInstrumentation =
				builder.hasServerInstrumentationFile?.() ?? false;

			// Bundle SvelteKit's server output with Bun's own bundler instead of
			// rolldown: drops the adapter's one runtime dependency. Only the app's
			// declared `dependencies` stay external (resolved from `node_modules`
			// at deploy time, à la `adapter-node`); everything else, `@sveltejs/kit`
			// included, is bundled in. `target: "bun"` keeps `node:*` external.
			const pkg = await Bun.file("package.json").json();
			await Bun.build({
				entrypoints: [
					`${tmp}/index.js`,
					`${tmp}/manifest.js`,
					...(hasInstrumentation ? [`${tmp}/instrumentation.server.js`] : []),
				],
				external: Object.keys(pkg.dependencies ?? {}),
				format: "esm",
				naming: { chunk: "chunks/[name]-[hash].[ext]" },
				outdir: `${out}/server`,
				sourcemap: "linked",
				splitting: true,
				target: "bun",
			});

			// Compile our own entrypoint templates fresh, rather than shipping a
			// pre-built `files/` dir the way upstream's published package does :
			// there's nothing to publish here, so building on every adapt() keeps
			// templates/*.ts as the one source of truth, no separate build step to
			// remember to run first.
			builder.log.minor("Building entrypoint");
			await Bun.build({
				entrypoints: [
					`${templates}/index.ts`,
					`${templates}/handler.ts`,
					`${templates}/env.ts`,
				],
				// These are virtual module specifiers, not real packages, resolved by
				// the string replacement below (builder.copy's `replace` does a raw
				// token swap over the compiled output), so Bun.build must leave them
				// unresolved rather than erroring on a missing module.
				external: ["ENV", "MANIFEST", "SERVER", "HANDLER"],
				format: "esm",
				minify: false,
				outdir: `${tmp}/files`,
				target: "bun",
			});

			builder.copy(`${tmp}/files`, out, {
				replace: {
					BUILD_OPTIONS: JSON.stringify({ serveAssets }),
					ENV: "./env.js",
					ENV_PREFIX: JSON.stringify(envPrefix),
					HANDLER: "./handler.js",
					MANIFEST: "./server/manifest.js",
					SERVE_OPTIONS: JSON.stringify(serveOptions),
					SERVER: "./server/index.js",
				},
			});

			if (hasInstrumentation) {
				builder.instrument?.({
					entrypoint: `${out}/index.js`,
					instrumentation: `${out}/server/instrumentation.server.js`,
					module: {
						exports: ["path", "host", "port", "server"],
					},
				});
			}
		},
		name: "homerun-svelte-adapter-bun",
		supports: {
			instrumentation: () => true,
			read: () => true,
		},
	};
}
