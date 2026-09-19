# Adapter Options

```typescript
adapter({
  out: "build",
  name: "server",
  compile: true,
  target: undefined,
  bytecode: false,
  minify: false,
  sourcemap: false,
  precompress: false,
  healthcheck: true,
  envPrefix: "",
  serveAssets: true,
  serveOptions: {},
});
```

| Option         | Default       | Description                                                                                                   |
| -------------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `out`          | `"build"`     | Output directory. Holds the executable plus `client/` and `prerendered/`.                                     |
| `name`         | `"server"`    | Executable filename inside `out`. Ignored with `compile: false` (the bundle is always `index.js`).            |
| `compile`      | `true`        | `false` emits a plain `index.js` bundle run with `bun` — see [Native addons](native-addons.md).               |
| `target`       | host platform | Cross-compile target, e.g. `"bun-linux-x64"`. See [Deployment](deployment.md#cross-compilation).              |
| `bytecode`     | `false`       | Embed a V8 bytecode cache: faster cold start, bigger binary.                                                  |
| `minify`       | `false`       | Minify the bundled server code.                                                                               |
| `sourcemap`    | `false`       | Embed a source map so server stack traces point at original code.                                             |
| `precompress`  | `false`       | Emit `.br` / `.gz` siblings for assets and prerendered pages, served when `Accept-Encoding` allows.           |
| `healthcheck`  | `true`        | Compile the `healthcheck` binary and expose `GET /_health`. Pass `{ path: "/healthz" }` to move the endpoint. |
| `envPrefix`    | `""`          | Namespace for the runtime env vars — see [Environment variables](env.md#envprefix).                           |
| `serveAssets`  | `true`        | Serve `client/` and `prerendered/` from the executable. Turn off when a proxy/CDN serves them.                |
| `serveOptions` | `{}`          | Extra `Bun.serve()` options (`tls`, `reusePort`, `maxConnections`, `error`, …).                               |

## `serveOptions`

These are merged in _before_ the adapter's own fields (`fetch`, `idleTimeout`,
`maxRequestBodySize`, `hostname`/`port`/`unix`, `websocket`), so they can add to
the server but not override request handling. Use the matching env vars
(`IDLE_TIMEOUT`, `BODY_SIZE_LIMIT`, `HOST`/`PORT`, `SOCKET_PATH`) for those.

```typescript
adapter({
  serveOptions: {
    tls: { cert: Bun.file("cert.pem"), key: Bun.file("key.pem") },
  },
});
```
