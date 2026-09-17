# Svelte Smol Adapter

A [SvelteKit](https://svelte.dev/docs/kit) adapter that compiles your app into a
**single standalone executable** with `bun build --compile` — static assets and
prerendered pages embedded. No `node_modules`, no JS files, no asset folders to
ship: just one binary.

Built on the design of the official
[`@sveltejs/adapter-bun`](https://svelte.dev/docs/kit/adapter-bun) and
option-compatible with it. What smol changes: compiling is the **default**, and
it adds a `healthcheck` binary + endpoint.

## Install

```bash
bun add -d @orochibraru/svelte-smol
```

For SvelteKit 3 (prerelease), install from the `next` tag instead:

```bash
bun add -d @orochibraru/svelte-smol@next @sveltejs/kit@next
```

Requires Bun 1.4+.

## Usage

```js
// vite.config.js
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import adapter from "@orochibraru/svelte-smol";

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
```

The build runs under the Bun runtime:

```bash
bun run --bun vite build
```

## Output

```text
build/
├── server        # the executable, assets embedded
└── healthcheck   # tiny probe for Docker HEALTHCHECK
```

```bash
./build/server
```

### `buildOptions.compile: false`

A native (`.node`) addon like `sharp` can't be embedded in a binary. Set
`buildOptions: { compile: false }` to emit a plain bundle instead:

```text
build/
├── index.js       # the server entry, run with `bun`
├── server/        # split chunks
├── healthcheck    # still a compiled binary
├── client/
└── prerendered/
```

```bash
bun ./build/index.js
```

Pure-JS dependencies are still bundled. Native addons resolve from
`node_modules` at runtime, so ship a production install alongside.

## Options

```js
adapter({
  out: "build", // output directory
  precompress: false, // .br/.gz variants (compile: false only)
  envPrefix: "", // prefix for the runtime env vars below
  serverOptions: {}, // JSON-serializable Bun.serve() defaults; env vars win
  buildOptions: {
    compile: true, // true | "bun-linux-x64-musl" | { target, outfile, … } | false
    // also: sourcemap, minify, bytecode, banner, footer, drop, features,
    // optimizeImports, splitting
  },
  healthcheck: true, // or { path: "/healthz" }, or false
});
```

`compile` accepts any Bun compile target string (`"bun-linux-x64"`,
`"bun-linux-arm64-musl"`, `"bun-darwin-arm64"`, `"bun-windows-x64"`, …) to
cross-compile; the healthcheck binary uses the same target.

## Runtime environment variables

| Variable                  | Default   | Purpose                                                           |
| ------------------------- | --------- | ----------------------------------------------------------------- |
| `HOST`                    | `0.0.0.0` | Listen address                                                    |
| `PORT`                    | `3000`    | Listen port                                                       |
| `SOCKET_PATH`             | —         | Listen on a Unix socket instead of `HOST`/`PORT`                  |
| `REUSE_PORT`              | `false`   | `SO_REUSEPORT`                                                    |
| `IPV6_ONLY`               | `false`   | Disable dual-stack                                                |
| `CONNECTION_IDLE_TIMEOUT` | `10`      | Bun socket idle timeout in seconds, max 255 (SSE responses opt out) |
| `BODY_SIZE_LIMIT`         | `512K`    | Max request body (`K`/`M`/`G` suffixes, or `Infinity`)            |
| `SHUTDOWN_TIMEOUT`        | `30`      | Seconds to drain in-flight requests on `SIGINT`/`SIGTERM`         |
| `DEVELOPMENT`             | `false`   | Bun.serve development mode                                        |
| `PROTOCOL_HEADER`         | —         | Header carrying the forwarded protocol (e.g. `x-forwarded-proto`) |
| `HOST_HEADER`             | —         | Header carrying the forwarded host                                |
| `PORT_HEADER`             | —         | Header carrying the forwarded port                                |
| `ADDRESS_HEADER`          | —         | Header carrying the client address (e.g. `x-forwarded-for`)       |
| `XFF_DEPTH`               | `1`       | Trusted-proxy depth when `ADDRESS_HEADER=x-forwarded-for`         |
| `HEALTHCHECK_PATH`        | `/_health`| Endpoint the `healthcheck` binary probes                          |
| `HEALTHCHECK_TIMEOUT`     | `2000`    | `healthcheck` binary request timeout in ms                        |

Set `envPrefix` to namespace these (`envPrefix: "MY_APP_"` → `MY_APP_PORT`).
The public origin comes from SvelteKit's `paths.origin` config, or the request
headers above.

## Health check

With `healthcheck` enabled (the default) the server answers `GET /_health` with
`{ "status": "ok", "uptime": … }`, and the build also produces
`build/healthcheck`, which probes it over loopback (or the Unix socket) and
exits `0` when healthy, `1` otherwise:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD ["./build/healthcheck"]
```

It reads the same `HOST` / `PORT` / `SOCKET_PATH` as the server.

## Migrating from 1.x

| 1.x                          | now                                          |
| ---------------------------- | -------------------------------------------- |
| `compile: false`             | `buildOptions: { compile: false }`           |
| `target: "bun-linux-x64"`    | `buildOptions: { compile: "bun-linux-x64" }` |
| `name: "app"`                | `buildOptions: { compile: { outfile: "app" } }` |
| `bytecode`, `minify`, `sourcemap` | `buildOptions.*`                        |
| `serveOptions`               | `serverOptions` (JSON-serializable only)     |
| `serveAssets: false`         | removed — assets are embedded                |
| `IDLE_TIMEOUT`               | `CONNECTION_IDLE_TIMEOUT`                    |
| `ORIGIN`, `ASSETS_DIR`       | removed — use `paths.origin`; assets are embedded |

## Releases

Automated by [semantic-release](https://semantic-release.gitbook.io/) from
[Conventional Commits](https://www.conventionalcommits.org/):

- `fix:` / `perf:` → **patch**, `feat:` → **minor**, `feat!:` or a
  `BREAKING CHANGE:` footer → **major**
- `docs:` `refactor:` `test:` `chore:` `build:` `ci:` `style:` → **no release**
- `feat:` / `fix:` scoped to `ci`, `build`, `deps`, `dev`, `repo`, `test`,
  `example`, `release` → **no release** (they don't touch the published package)
