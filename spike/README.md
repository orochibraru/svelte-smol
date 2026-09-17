# spike: SvelteKit SSR in a Rust binary, no Bun, no Node

A working proof that a SvelteKit app can be served by a **12 MB Rust binary**
with no JS runtime shipped at all — QuickJS-ng is linked in as a library.

Not a product, not wired into the adapter. It answers one question: is there a
way off the 60 MB Bun binary?

## Results

Measured on the `examples/compiled-app` example, darwin/arm64, sequential
requests over HTTP, both binaries built from the same app:

| runtime        | binary  | req/s | cold start | RSS           |
| -------------- | ------- | ----- | ---------- | ------------- |
| rust + QuickJS | 12.3 MB | 1,504 | 48 ms      | 12 MB → 34 MB |
| bun (JSC)      | 59.6 MB | 7,244 | 54 ms      | 22 MB         |

4.8× smaller, same cold start, 4.8× less SSR throughput. RSS is after a few
requests → after 1,000 (LLRT's default 20 MB GC threshold lets it grow).

Verified working, all against the binary `build.sh` produces:

- `/` and `/test` (a `+page.server.ts` load): HTML **md5-identical** to Bun's.
- Hashed `/_app/immutable/…` assets, 404 through kit's handler.
- Hydration in a real browser, zero console errors.
- **Streaming SSR**: a kit page whose `load` returns an unawaited promise sends
  3,710 bytes at t=0 (first byte 1.9 ms) and the 75-byte deferred-data chunk
  exactly 1.5 s later — the same timeline and chunk shape as Bun (3,712 + 76).
- **Binary request bodies**: a 64 KB `/dev/urandom` POST round-trips through
  `Request.arrayBuffer()` md5-identical.
- `GET /_sqlite`: real SQLite rows via a Rust binding (see below).

## How

Nothing is transpiled. TS→Rust is not possible — user code is arbitrary TS and
kit's runtime is JS. What gets replaced is the *runtime*, not the language:

1. A bundler flattens kit's server output plus `handler.js` into one 0.32 MB
   ESM file exposing `globalThis.__handle(method, url, headers, body)`.
2. `include_str!` bakes that into the Rust binary.
3. Rust owns HTTP (hyper), static files and routing. QuickJS only maps a
   Request to a Response. `llrt_core` supplies `fetch`, `Response`,
   `ReadableStream`, `crypto` and `FormData` — the exact Web API surface kit's
   server output needs (it imports no `node:` builtins at all, which is the
   only reason any of this works).

Bodies cross the boundary without copying through strings: the request body
goes in as a `Uint8Array` (a valid `BodyInit`), and the response comes back as
`{status, headers, reader}` where `reader` is `res.body.getReader()`. Rust
sends the head as soon as it exists and pumps chunks from a spawned task into a
hyper `StreamBody` through a channel, so kit's streamed `load` promises reach
the client as they resolve. Every JS value stays inside the context closure;
only plain Rust types cross the channels.

## Run it

```bash
./build.sh                          # the bundled example app
./build.sh ~/Dev/my-app             # any SvelteKit project
./build.sh ~/Dev/my-app --no-build  # reuse its existing .svelte-kit output
```

It prints the exact run command when it finishes, e.g.

```bash
cd ~/Dev/my-app && ASSETS_DIR=.svelte-kit/output PORT=3000 \
  /path/to/spike/target/release/sveltekit-quickjs
```

The app's adapter does not matter: the build consumes
`.svelte-kit/output/server`, which Vite writes whatever the adapter is, and
serves assets from `.svelte-kit/output/{client,prerendered}` for the same
reason. `ASSETS_DIR` is how the binary finds them; `PORT` defaults to 3000 and
a busy port exits with a message naming it.

The entry names its imports `SERVER` and `MANIFEST`, and `build.sh` swaps in
the chosen app's paths — the same token trick the adapter uses on its own
templates (see `../index.ts`). The generated `.entry.js` is gitignored.

Needs `cargo`, `cmake` (zlib-ng/brotli build deps), `node` and `bun`.

### Pointing it at a real app

This is where the binding bill comes due, and it comes due loudly. Building
`examples/native-addon` (it uses `sharp`) succeeds — 106 modules, 0.57 MB —
and then dies at startup:

```text
SyntaxError: Could not find export 'spawnSync' in module 'child_process'
```

LLRT's `child_process` shim is too thin for sharp's loader. That is the honest
shape of the answer for most real apps: the bundle builds, and the first
missing host capability stops it before the first request. Each one is a
binding (see below), not a bug to fix in the spike.

`build.sh` uses `bun build` as the bundler because it is already here. Nothing
Bun-specific reaches the output: `npx esbuild handler.js --bundle --format=esm
--platform=node --outfile=bundle.js` was verified to produce a bundle that
serves byte-identical responses from the same binary.

`llrt_core` is built from source, vendored into the gitignored `vendor/`. The
only published crate (0.8.1-beta) has no `Response.body` — every reader came
back `null`, which made streaming impossible. The v0.9.0-beta tag has it, but
its build script needs `bundle/js` (an esbuild of LLRT's own TS shims) that a
plain git dependency can't produce, so the script clones the tag once and runs
`node build.mjs` to generate it.

To reproduce the streaming measurement, drop this route into the example app,
rebuild, and compare first-byte to total time with `curl -N`:

```ts
// src/routes/stream/+page.server.ts — an unawaited promise streams in kit 2
export const load = () => ({
  fast: "now",
  slow: new Promise<string>((r) => setTimeout(() => r("later"), 1500)),
});
```

```svelte
<!-- src/routes/stream/+page.svelte -->
<script lang="ts">
  let { data } = $props();
</script>

<p>{data.fast}</p>
{#await data.slow}<p>loading</p>{:then v}<p>{v}</p>{/await}
```

## Missing Bun APIs: bindings, not a transpiler

A transpiler cannot reach what is missing here, because none of it is syntax.
`bun:sqlite` is not JS awaiting translation — it is a binding to a C library.
The gap is host capability, so the fix is a **binding layer**: a Rust crate
wired to a JS global. That is all LLRT itself is.

`GET /_sqlite` in this spike proves the pattern end to end — real SQLite rows,
queried from JS, served from the binary:

```json
[{"id":1,"name":"Ada"},{"id":2,"name":"Linus"},{"id":3,"name":"Grace"}]
```

Cost: ~45 lines of Rust (`init_sqlite` + `sqlite_query` in `src/main.rs`), one
`cargo add rusqlite`, and 1.7 MB of binary. Postgres is the same shape with
`tokio-postgres`, websockets with `tokio-tungstenite`.

### Lifting Bun's own crates

Bun 1.4 is a Rust cargo workspace (~90 crates, 67% Rust, MIT), and it is split
deliberately: `src/sql` (the Postgres/MySQL wire protocol) has **no JSC
dependency at all** — the engine glue is isolated in `src/sql_jsc`. So
`bun_sql` is liftable onto QuickJS in principle.

The catch is the build chain, not the code: `bun_sql` pulls `bun_boringssl_sys`
and `bun_cares_sys`, native `-sys` crates driven by Bun's own TypeScript build
scripts. That is days of porting against `cargo add tokio-postgres` for the
same capability. Worth it only to inherit Bun's exact `Bun.sql` semantics.

## What it does not do

- **No Bun APIs out of the box** — each one costs a binding (see above). The
  `new-sveltekit-app` stack (better-auth + Drizzle + bun-sql) does not run on
  this today.
- No websockets.
- Single JS context on a single thread.
- LLRT is a subset runtime: no `node:http`, partial `fs`/`stream`.
- Request bodies are buffered before the call into JS (responses stream).
- One app per binary: the server bundle is baked in at compile time, so a
  different app means another `./build.sh`.

## Why not Node as the base

Node is worse than Bun for this, not better: the `node` binary is **139.8 MB**
(v26.9.0, darwin/arm64) against Bun's ~60 MB compiled output, and Node SEA also
needs a CJS bundle plus a `postject` injection step and has no cross-compile.
Node's only edge is as the *bundler* host, which is already interchangeable.
