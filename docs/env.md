# Environment Variables

Runtime settings are read from the environment when the executable starts —
nothing is baked in at build time.

## Listening

| Variable      | Default   | Description                                       |
| ------------- | --------- | ------------------------------------------------- |
| `HOST`        | `0.0.0.0` | Listen address.                                   |
| `PORT`        | `3000`    | Listen port.                                      |
| `SOCKET_PATH` | —         | Listen on a Unix socket instead of `HOST`/`PORT`. |

## Requests

| Variable           | Default | Description                                                           |
| ------------------ | ------- | --------------------------------------------------------------------- |
| `BODY_SIZE_LIMIT`  | `512K`  | Max request body size. Accepts `K`/`M`/`G` suffixes.                  |
| `IDLE_TIMEOUT`     | `10`    | Socket idle timeout in seconds. Server-Sent Events responses opt out. |
| `SHUTDOWN_TIMEOUT` | `30`    | Seconds to wait for in-flight requests on `SIGINT`/`SIGTERM`.         |

On shutdown the server emits `sveltekit:shutdown` on `process`, stops accepting
connections and waits up to `SHUTDOWN_TIMEOUT` before forcing. A second signal
forces an immediate exit.

## Assets

| Variable     | Default | Description                                                                                 |
| ------------ | ------- | ------------------------------------------------------------------------------------------- |
| `ASSETS_DIR` | —       | Parent directory of `client/` and `prerendered/` (absolute, or relative to the executable). |

## Proxy

See [Reverse proxy](reverse-proxy.md) for when to set these.

| Variable          | Default | Description                                                         |
| ----------------- | ------- | ------------------------------------------------------------------- |
| `ORIGIN`          | —       | Absolute origin used to build request URLs, e.g. `https://my.site`. |
| `PROTOCOL_HEADER` | —       | Header carrying the forwarded protocol (e.g. `x-forwarded-proto`).  |
| `HOST_HEADER`     | —       | Header carrying the forwarded host (e.g. `x-forwarded-host`).       |
| `PORT_HEADER`     | —       | Header carrying the forwarded port.                                 |
| `ADDRESS_HEADER`  | —       | Header carrying the client address (e.g. `x-forwarded-for`).        |
| `XFF_DEPTH`       | `1`     | Trusted-proxy depth when `ADDRESS_HEADER=x-forwarded-for`.          |

## Health check

| Variable              | Default    | Description                                                          |
| --------------------- | ---------- | -------------------------------------------------------------------- |
| `HEALTHCHECK_PATH`    | `/_health` | Path the `healthcheck` binary probes. Must match the adapter option. |
| `HEALTHCHECK_TIMEOUT` | `2000`     | `healthcheck` binary request timeout, in milliseconds.               |

## `envPrefix`

Set the `envPrefix` adapter option to namespace every variable above:

```typescript
adapter({ envPrefix: "MY_APP_" }); // reads MY_APP_PORT, MY_APP_HOST, …
```

With a prefix set, the server refuses to start if it sees a prefixed variable it
doesn't know (`MY_APP_PROT`, say) — a typo guard, and a hint to pick a prefix
that doesn't collide with your own variables.

Your app's own variables (`$env/dynamic/private` and friends) are never
prefixed; they're passed to SvelteKit as-is.
