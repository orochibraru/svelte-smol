# TODO

- [x] Optimize the adapter to use as much new Bun features as possible (latest version is 1.4)
      - server bundle now uses `Bun.build` instead of `rolldown` (adapter has zero runtime deps)
      - `Bun.file`/`Bun.write`/`Bun.fileURLToPath` in place of `node:fs` / `node:url`
      - SSE (`text/event-stream`) responses clear Bun's idle timeout via `server.timeout(req, 0)`
      - confirmed Bun 1.4 `dir` routes emit a weak ETag + honor `If-None-Match` (comment refreshed)
      - added `test/fixtures/basic` + `test/integration.test.ts` (`bun run test:integration`)
