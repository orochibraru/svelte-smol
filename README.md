# Svelte Smol Adapter

> [!WARNING]
> **Deprecated.** SvelteKit 3 has an official Bun adapter,
> [`@sveltejs/adapter-bun`](https://svelte.dev/docs/kit/adapter-bun), which
> also compiles the app into a single executable. Migrate to it, see
> [Migrating to `@sveltejs/adapter-bun`](#migrating-to-sveltejsadapter-bun).
> This package only gets SvelteKit 2 fixes until the repository is archived.

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

## Migrating to `@sveltejs/adapter-bun`

The official adapter needs SvelteKit 3 and Bun 1.4 or newer. These steps work
from svelte-smol on either SvelteKit version.

1. Swap the packages:

   ```bash
   bun remove @orochibraru/svelte-smol
   bun add -d @sveltejs/kit@^3 @sveltejs/adapter-bun
   ```

2. Configure the adapter in the Vite plugin, and remove `adapter` from
   `svelte.config.js` if you were on SvelteKit 2:

   ```typescript
   // vite.config.js
   import adapter from "@sveltejs/adapter-bun";
   import { sveltekit } from "@sveltejs/kit/vite";
   import { defineConfig } from "vite";

   export default defineConfig({
     plugins: [
       sveltekit({ adapter: adapter({ buildOptions: { compile: true } }) }),
     ],
   });
   ```

   Compiling is opt-in. Without `buildOptions.compile`, the build is a
   Vite-built `build/index.js` run with `bun ./build`, and the app's production
   `dependencies` are not bundled into it: ship a production `node_modules`
   next to it. That is also the mode for native (`.node`) addons, as
   `compile: false` was here.

3. Build under the Bun runtime: `bun run --bun vite build`.

4. Rename your options:

   | svelte-smol, SvelteKit 2          | svelte-smol, SvelteKit 3                        | `@sveltejs/adapter-bun`                   |
   | --------------------------------- | ----------------------------------------------- | ----------------------------------------- |
   | `compile: true` (default)         | `buildOptions: { compile: true }` (default)     | `buildOptions: { compile: true }`         |
   | `compile: false`                  | `buildOptions: { compile: false }`              | leave `buildOptions.compile` unset        |
   | `target: "bun-linux-x64"`         | `buildOptions: { compile: "bun-linux-x64" }`    | same as svelte-smol on SvelteKit 3        |
   | `name: "app"`                     | `buildOptions: { compile: { outfile: "app" } }` | same as svelte-smol on SvelteKit 3        |
   | `bytecode`, `minify`, `sourcemap` | `buildOptions.*`                                | `buildOptions.*`                          |
   | `serveOptions`                    | `serverOptions`                                 | `serverOptions` (JSON-serializable only)  |
   | `serveAssets: false`              | removed                                         | removed, assets are always served         |
   | n/a                               | `buildOptions.splitting`                        | removed                                   |
   | `healthcheck`                     | `healthcheck`                                   | removed, see step 6                       |

   `out`, `precompress` and `envPrefix` keep their meaning. `precompress` is
   still ignored when compiling.

5. Update your environment:
   - `IDLE_TIMEOUT` becomes `CONNECTION_IDLE_TIMEOUT` (max `255`).
   - `ASSETS_DIR`, `HEALTHCHECK_PATH` and `HEALTHCHECK_TIMEOUT` are gone.
   - `ORIGIN` is gone. The public origin comes from `paths.origin` in the
     SvelteKit config, fixed at build time, else from the request and the
     forwarded headers, assuming `https` unless `PROTOCOL_HEADER` says
     otherwise. An app served over plain HTTP with neither set fails the CSRF
     check on every form action: set `paths.origin`, or set
     `PROTOCOL_HEADER=x-forwarded-proto` behind a proxy that sends it.
   - With `envPrefix`, the server refuses to start when it sees a prefixed
     variable it doesn't know. Delete leftovers like `MY_APP_ORIGIN` or
     `MY_APP_HEALTHCHECK_TIMEOUT`.

6. Replace the health check. The endpoint is a regular route:

   ```typescript
   // src/routes/_health/+server.ts
   export const prerender = false;

   export const GET = () =>
     Response.json(
       { status: "ok" },
       { headers: { "cache-control": "no-store" } },
     );
   ```

   The probe is a script you compile yourself, so it still runs in an image
   without `curl`:

   ```typescript
   // healthcheck.ts
   const port = process.env.PORT ?? "3000";

   try {
     const response = await fetch(`http://127.0.0.1:${port}/_health`, {
       signal: AbortSignal.timeout(2000),
     });
     process.exit(response.ok ? 0 : 1);
   } catch {
     process.exit(1);
   }
   ```

   ```dockerfile
   RUN bun build --compile --minify ./healthcheck.ts --outfile build/healthcheck
   HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
     CMD ["./build/healthcheck"]
   ```

   Pass the same `--target` as `buildOptions.compile` when cross-compiling.

One behaviour has no replacement: a compiled executable answers a `Range`
request on an embedded asset with `200` and the whole file, so a `<video>`
downloads everything before it can seek. Serve large media from a CDN or the
proxy, or don't compile.

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
