# TODO

- [x] Optimize the adapter to use as much new Bun features as possible (latest version is 1.4)
      - `Bun.file`/`Bun.write`/`Bun.fileURLToPath` in place of `node:fs` / `node:url`
      - SSE (`text/event-stream`) responses clear Bun's idle timeout via `server.timeout(req, 0)`
      - added `test/fixtures/basic` + `test/integration.test.ts` (`bun run test:integration`)

- [x] Compile the whole app to a single standalone executable (`bun build --compile`)
      - output is `build/server` (binary) + `build/client` + `build/prerendered`
      - no rolldown, no `node_modules`, no loose JS/TS on the server
      - entrypoint templates ship as raw `.ts`, compiled straight into the binary
      - assets located via `dirname(process.execPath)` (override: `ASSETS_DIR`); the
        binary runs from any cwd
      - static serving moved into the `fetch` handler: compiled Bun rejects
        `BunFile` / `{ dir }` route values, so `routes` can't be used
      - manual weak `ETag` + `Cache-Control` (immutable for hashed assets), 304s
      - options: `name`, `target` (cross-compile), `bytecode`, `minify`,
        `sourcemap`, `precompress` (now actually negotiates `.br`/`.gz`)
      - instrumentation prepended to the compile entrypoint (no post-build entry
        to rewrite in a binary)
