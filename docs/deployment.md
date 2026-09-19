# Deployment

Ship the whole `build/` directory. With `serveAssets: false`, the executable
alone is enough — a proxy or CDN serves `client/` and `prerendered/`.

## Docker

The binary has no runtime dependencies beyond libc, so the final image doesn't
need Bun:

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

FROM debian:bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --system --create-home --uid 10001 app
WORKDIR /app
COPY --from=build --chown=app:app /app/build ./build
USER app
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=2s --retries=3 \
	CMD ["./build/healthcheck"]
CMD ["./build/server"]
```

`ca-certificates` is only needed if the app makes outbound HTTPS requests. Full
working examples live in
[`examples/`](https://github.com/orochibraru/svelte-smol/tree/main/examples).

## Cross-compilation

`target` accepts any Bun compile target, so you can build a Linux binary from a
Mac:

```js
adapter({ target: "bun-linux-x64-musl" }); // Alpine
```

Common targets: `bun-linux-x64`, `bun-linux-arm64`, `bun-linux-x64-musl`,
`bun-darwin-arm64`, `bun-windows-x64`. Add `-modern` or `-baseline` to pick a
SIMD level. Bun downloads the matching runtime the first time a target is used.

## Static assets

With `serveAssets` on (the default), the executable serves:

- **Prerendered pages** from `prerendered/`. The other trailing-slash form of a
  prerendered path gets a `308` to the canonical one.
- **Client assets** from `client/`. Files under `_app/immutable/` are cached for
  a year (`immutable`); everything else revalidates via a weak `ETag`.

Turn on `precompress` to emit `.br` and `.gz` siblings at build time; they're
served with the matching `Content-Encoding` when the browser accepts it.

To keep assets elsewhere on disk, point `ASSETS_DIR` at the directory holding
`client/` and `prerendered/`.

## Signals

`SIGTERM` and `SIGINT` trigger a graceful shutdown — see
[`SHUTDOWN_TIMEOUT`](env.md#requests).
