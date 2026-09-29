# Svelte Smol Adapter

A [SvelteKit](https://svelte.dev/docs/kit) adapter that compiles your app into a
**single standalone executable** with `bun build --compile`. No `node_modules`,
no JS files to ship, just one binary plus its static assets.

## Install

```bash
bun add -d @orochibraru/svelte-smol
```

Every merge to `main` ships as `@orochibraru/svelte-smol@canary`; stable
releases go out under `latest`.

## Usage

```typescript
// svelte.config.js
import adapter from "@orochibraru/svelte-smol";

export default {
  kit: {
    adapter: adapter(),
  },
};
```

The compile step runs under the Bun runtime, so build with:

```bash
bun run vite build
```

## SvelteKit 2 and SvelteKit 3

One package supports both. There is no flag to set: at build time the adapter
checks which SvelteKit is running the build and uses the matching
implementation. Upgrading SvelteKit is enough to switch.

|                     | SvelteKit 2                             | SvelteKit 3 (prerelease)                       |
| ------------------- | --------------------------------------- | ---------------------------------------------- |
| Adapter config      | `svelte.config.js`                      | `vite.config.js`, passed to `sveltekit()`      |
| Static assets       | `client/` and `prerendered/` beside it  | embedded in the executable                     |
| Build options       | top level (`compile`, `target`, …)      | under `buildOptions`                           |
| `Bun.serve` options | `serveOptions`                          | `serverOptions` (JSON-serializable only)       |
| Public origin       | `ORIGIN` env var                        | `ORIGIN` env var, else `paths.origin`          |

The rest of this README covers SvelteKit 2. For SvelteKit 3's options,
environment variables and output, see [SvelteKit 3](docs/sveltekit-3.md).

### Upgrading to SvelteKit 3

1. Install SvelteKit 3: `bun add -d @sveltejs/kit@next`.
2. Move the adapter from `svelte.config.js` into the Vite plugin:

   ```typescript
   // vite.config.js
   import { sveltekit } from "@sveltejs/kit/vite";
   import { defineConfig } from "vite";
   import adapter from "@orochibraru/svelte-smol";

   export default defineConfig({
     plugins: [sveltekit({ adapter: adapter() })],
   });
   ```

3. Rename your options and env vars:

   | SvelteKit 2                       | SvelteKit 3                                      |
   | --------------------------------- | ------------------------------------------------ |
   | `compile: false`                  | `buildOptions: { compile: false }`               |
   | `target: "bun-linux-x64"`         | `buildOptions: { compile: "bun-linux-x64" }`     |
   | `name: "app"`                     | `buildOptions: { compile: { outfile: "app" } }`  |
   | `bytecode`, `minify`, `sourcemap` | `buildOptions.*`                                 |
   | `serveOptions`                    | `serverOptions` (JSON-serializable only)         |
   | `serveAssets: false`              | removed, assets are embedded                     |
   | `IDLE_TIMEOUT`                    | `CONNECTION_IDLE_TIMEOUT`                        |
   | `ASSETS_DIR`                      | removed, assets are embedded                     |

4. Deploy the `build/server` executable on its own: it no longer needs the
   `client/` and `prerendered/` folders next to it.

`out`, `healthcheck` and `envPrefix` work the same on both. `precompress` too,
except that SvelteKit 3 ignores it when compiling, since it has no asset files
to serve. Options that belong to the other SvelteKit version fail the build instead of
being ignored:

```text
svelte-smol: compile not supported with SvelteKit 3. See https://github.com/orochibraru/svelte-smol/blob/main/docs/sveltekit-3.md for the option mapping.
```

Going back to SvelteKit 2 is the same steps in reverse.

SvelteKit 2 support will be deprecated once SvelteKit 3 is stable, and removed
in the next major version of this package.

## Output

```text
build/
├── server        # the compiled executable
├── client/       # static assets, served by the executable
└── prerendered/  # prerendered pages, served by the executable
```

Deploy the whole `build/` directory (or just `server` if a proxy/CDN serves the
assets, see `serveAssets`). The executable locates `client/` and `prerendered/`
relative to its own path, so it can be run from any working directory:

```bash
./build/server
```

### `compile: false`

`bun build --compile` bundles every dependency into the binary, and a native
(`.node`) addon like `sharp` or `better-sqlite3` can't be bundled that way. Set
`compile: false` to emit a plain bundle instead:

```text
build/
├── index.js       # the server bundle, run with `bun`
├── healthcheck    # still a compiled binary
├── client/
└── prerendered/
```

```bash
bun run ./build/index.js
```

Pure-JS dependencies are still bundled into `index.js`. A native addon can't be,
so its `require` stays in the output and resolves from `node_modules` at runtime
(looked up from `index.js`'s own location, so the working directory doesn't
matter). Ship `node_modules` for those — a production install is enough, since
everything that got bundled needn't be there.

Everything else — env vars, the `healthcheck` binary, `serveAssets`,
instrumentation — works the same.

## Options

```typescript
adapter({
  out: "build", // output directory
  name: "server", // executable filename within `out`
  compile: true, // false → emit build/index.js (run with `bun`) instead of a binary
  target: undefined, // cross-compile target, e.g. "bun-linux-x64"
  bytecode: false, // embed a V8 bytecode cache (faster cold start, bigger binary)
  minify: false, // minify the bundled server code
  sourcemap: false, // embed a source map for server stack traces
  precompress: false, // emit + serve .gz / .br sibling files
  healthcheck: true, // also compile `build/healthcheck` + expose GET /_health
  envPrefix: "", // prefix for the runtime env vars below
  serveAssets: true, // serve client/ and prerendered/ from the binary
  serveOptions: {}, // extra Bun.serve() options (tls, reusePort, …)
});
```

### Cross-compilation

`target` accepts any Bun compile target, e.g. `"bun-linux-x64"`,
`"bun-linux-arm64-musl"` (Alpine), `"bun-darwin-arm64"`, `"bun-windows-x64"`,
with optional `-modern` / `-baseline` SIMD suffixes. Bun downloads the matching
runtime the first time you use a target.

## Runtime environment variables

| Variable              | Default    | Purpose                                                                                         |
| --------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `HOST`                | `0.0.0.0`  | Listen address                                                                                  |
| `PORT`                | `3000`     | Listen port                                                                                     |
| `SOCKET_PATH`         | —          | Listen on a Unix socket instead of `HOST`/`PORT`                                                |
| `ASSETS_DIR`          | —          | Override where `client/` and `prerendered/` are looked up (absolute, or relative to the binary) |
| `ORIGIN`              | —          | Public origin, read at runtime (Kit 2 and 3; on Kit 3 it overrides `paths.origin`)              |
| `PROTOCOL_HEADER`     | —          | Header carrying the forwarded protocol (e.g. `x-forwarded-proto`)                               |
| `HOST_HEADER`         | —          | Header carrying the forwarded host                                                              |
| `PORT_HEADER`         | —          | Header carrying the forwarded port                                                              |
| `ADDRESS_HEADER`      | —          | Header carrying the client address (e.g. `x-forwarded-for`)                                     |
| `XFF_DEPTH`           | `1`        | Trusted-proxy depth when `ADDRESS_HEADER=x-forwarded-for`                                       |
| `BODY_SIZE_LIMIT`     | `512K`     | Max request body size (`K`/`M`/`G` suffixes allowed)                                            |
| `IDLE_TIMEOUT`        | `10`       | Bun socket idle timeout in seconds (SSE responses opt out)                                      |
| `SHUTDOWN_TIMEOUT`    | `30`       | Seconds to wait for in-flight requests on `SIGINT`/`SIGTERM`                                    |
| `HEALTHCHECK_PATH`    | `/_health` | Endpoint the `healthcheck` binary probes (must match the `healthcheck` option)                  |
| `HEALTHCHECK_TIMEOUT` | `2000`     | `healthcheck` binary request timeout in ms                                                      |

Set `envPrefix` to namespace these (`envPrefix: "MY_APP_"` → `MY_APP_PORT`).

## Health check

With `healthcheck` enabled (the default) the build also produces
`build/healthcheck` — a tiny executable that requests `GET /_health` over
loopback (or the Unix socket) and exits `0` when the server answers `200`,
`1` otherwise. `GET /_health` returns `{ "status": "ok", uptime, rss, pid,
timestamp }`. Drop it straight into Docker:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD ["./build/healthcheck"]
```

It reads the same `HOST` / `PORT` / `SOCKET_PATH` as the server, so no extra
wiring is needed.

## Notes

- The SvelteKit server code is JavaScript emitted by Vite; `--compile` embeds it
  in the binary, so nothing but the executable ships. Native (`.node`) modules in
  your dependencies are the one thing that can't be bundled this way.
- WebSockets, `read()` from `$app/server`, prerendering, and server
  instrumentation are all supported.

## Releases

Automated by [releaser](https://github.com/orochibraru/releaser) from
[Conventional Commits](https://www.conventionalcommits.org/):

- `fix:` `perf:` `revert:` `feat:` `docs:` `refactor:`, and breaking changes
  (`feat!:` or a `BREAKING CHANGE:` footer) → **patch**
- `test:` `chore:` `build:` `ci:` `style:` → **no release**
- Pushes that don't touch the published package (`index.ts`, `kit2/`, `kit3/`,
  `package.json`, `tsconfig*.json`) don't run a release at all
- Every release is published from `main` to npm `latest`, for both SvelteKit
  versions
