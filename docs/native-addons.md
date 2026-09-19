# Native Addons

`bun build --compile` bundles every dependency into the binary, but a native
(`.node`) addon — `sharp`, `better-sqlite3`, `sqlite3` — can't be embedded that
way. Set `compile: false` to emit a plain bundle instead:

```typescript
adapter({ compile: false });
```

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

## What goes in `node_modules`

Pure-JS dependencies are still bundled into `index.js`. A native addon's
`require` stays in the output and resolves from `node_modules` at runtime,
looked up from `index.js`'s own location — the working directory doesn't matter.
A production install is enough:

```bash
bun install --production
```

## Docker

The runtime image now needs Bun and `node_modules` built for its libc:

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --ignore-scripts
COPY . .
RUN bun run build
RUN rm -rf node_modules && bun install --production --ignore-scripts

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build --chown=bun:bun /app/build ./build
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/package.json ./package.json
USER bun
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=2s --retries=3 \
	CMD ["./build/healthcheck"]
CMD ["bun", "run", "./build/index.js"]
```

Everything else — env vars, the `healthcheck` binary, `serveAssets`,
instrumentation — works the same. `name`, `target` and `bytecode` only affect
compiled binaries (`target` still applies to `healthcheck`).
