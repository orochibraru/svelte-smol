# Architecture

## Repository layout

```text
index.ts          the adapter: options + adapt()
templates/        runtime entrypoints, compiled into the app
├── index.ts      Bun.serve() setup, graceful shutdown
├── handler.ts    static files, health endpoint, SvelteKit SSR
├── env.ts        env() lookup with envPrefix
└── healthcheck.ts  the healthcheck binary
internal.d.ts     types for the virtual modules templates import
examples/         compiled-app and native-addon (compile: false)
test/             integration tests (build + run the examples)
```

## What `adapt()` does

1. Writes client assets to `out/client/` and prerendered pages to
   `out/prerendered/` (compressing them if `precompress` is on).
2. Writes the SvelteKit server and a `manifest.js` into
   `.svelte-kit/adapter-bun/`.
3. Copies `templates/` next to it, swapping the placeholder tokens — `ENV`,
   `HANDLER`, `MANIFEST`, `SERVER` become relative imports; `ENV_PREFIX`,
   `BUILD_OPTIONS`, `SERVE_OPTIONS` become JSON literals.
4. Prepends `import "./server/instrumentation.server.js"` to the entrypoint if
   the app has one, so it loads before anything else.
5. Runs `Bun.build` on `templates/index.ts` — `compile` to a binary, or a plain
   `index.js` when `compile: false` — and compiles `healthcheck.ts` separately.

Templates ship as raw `.ts`; Bun transpiles them during the compile, so the
published package has no build step for them.

## Request flow

`handler.ts` answers, in order:

1. `GET` on the health path → JSON status.
2. A prerendered page or client asset, when `serveAssets` is on.
3. Everything else → `server.respond()`, with the URL rebuilt from `ORIGIN` or
   the forwarded headers and `getClientAddress()` wired to `ADDRESS_HEADER` or
   the socket.

`platform` is `{ request, server }` — the raw request and the `Bun.Server`.

## Finding assets at runtime

A compiled binary's `import.meta.dir` is virtual, so assets are located from
`dirname(process.execPath)`. A plain `index.js` uses `import.meta.dir` instead,
since `process.execPath` is the `bun` binary there. `ASSETS_DIR` overrides both.

## Loading under Node

`index.ts` only touches `Bun` inside `adapt()`. Tooling that loads
`svelte.config.js` under Node — `svelte-check`, the language server,
`svelte-kit sync` — works without Bun.
