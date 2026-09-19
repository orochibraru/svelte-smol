# Health Check

With `healthcheck` on (the default) the build produces a second, tiny executable
— `build/healthcheck` — and the server answers `GET /_health`:

```typescripton
{
  "status": "ok",
  "uptime": 42,
  "rss": 51249152,
  "pid": 1,
  "timestamp": "2026-09-19T10:00:00.000Z"
}
```

The binary requests that endpoint and exits `0` on a `200` with `status: "ok"`,
`1` otherwise. It reads the same `HOST`, `PORT` and `SOCKET_PATH` as the server
(a wildcard `HOST` is probed over `127.0.0.1`), so it needs no extra wiring.

## Docker

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD ["./build/healthcheck"]
```

Or in Compose:

```yaml
healthcheck:
  test: ["CMD", "/app/build/healthcheck"]
  interval: 30s
  timeout: 3s
  retries: 3
  start_period: 2s
```

## Changing the path

```typescript
adapter({ healthcheck: { path: "/healthz" } });
```

The binary picks up the new path automatically. `HEALTHCHECK_PATH` overrides it
at runtime, and `HEALTHCHECK_TIMEOUT` (ms, default `2000`) bounds the request.

## Disabling it

`healthcheck: false` skips the binary and the endpoint, freeing `/_health` for
your own route.
