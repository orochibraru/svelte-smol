# Svelte Smol Adapter

A [SvelteKit](https://svelte.dev/docs/kit) adapter that compiles your app into a
**single standalone executable** with `bun build --compile`. No `node_modules`,
no JS files to ship, just one binary plus its static assets.

## Install

```bash
bun add -d @orochibraru/svelte-smol
```

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

## SvelteKit 3

SvelteKit 3 (prerelease) is supported by the same package: the adapter detects
which SvelteKit is building the app. Pass it to the Vite plugin instead of
`svelte.config.js`:

```typescript
// vite.config.js
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import adapter from "@orochibraru/svelte-smol";

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
```

On SvelteKit 3 the assets are embedded in the executable and the options
change (`buildOptions`, `serverOptions`). Options meant for the other SvelteKit
version fail the build. See [SvelteKit 3](docs/sveltekit-3.md) for the options,
environment variables and the migration table. The rest of this README covers
SvelteKit 2.

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
| `ORIGIN`              | —          | Absolute origin used for request URL resolution                                                 |
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
